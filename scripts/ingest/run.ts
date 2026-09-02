import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Drug as DrugType, type Trial } from '../../src/schema/index.js';
import { makeContext, type IngestContext } from './context.js';
import type { DrugSpec } from './registry.js';
import { runFdaStage, type FdaStageResult } from './fda.js';
import { runDocsStage, type FetchedDoc } from './docs.js';
import { extractCandidates, resolveCandidates, type ResolveReport } from './codes.js';
import { studyToTrial, searchByIntervention, ctgovStudyUrl, studyMatchesDrug } from './ctgov.js';
import { applyRoles, extractLabelSection14 } from './roles.js';
import { mergeDrug, type Conflict } from './merge.js';

export const ALL_STEPS = ['fda', 'docs', 'codes', 'ctgov', 'merge'] as const;
export type Step = (typeof ALL_STEPS)[number];

export interface IngestOptions {
  spec: DrugSpec;
  steps?: Set<string>;
  rawDir?: string;
  drugsDir?: string;
  refresh?: boolean;
  maxLookups?: number;
  dryRun?: boolean;
  /** Clock for `lastIngestedAt`. Injectable so tests are deterministic. */
  now?: Date;
  /** Where progress notes go. Silent by default so tests stay quiet. */
  log?: (message: string) => void;
}

export interface IngestResult {
  drug: DrugType;
  outPath: string | null;
  written: boolean;
  fda: FdaStageResult;
  docs: FetchedDoc[];
  resolution: ResolveReport | null;
  /** Section 14 of the label, when it could be located. */
  foundLabelSection14: boolean;
  registeredTrialCount: number;
  conflicts: Conflict[];
  addedTrials: string[];
  updatedTrials: string[];
  droppedTrials: string[];
  warnings: string[];
}

export function defaultDrugsDir(): string {
  return join(process.cwd(), 'data', 'drugs');
}

function loadExisting(drugsDir: string, slug: string): DrugType | null {
  const path = join(drugsDir, `${slug}.json`);
  if (!existsSync(path)) return null;
  const parsed = Drug.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  return parsed.success ? parsed.data : null;
}

/**
 * Runs the ingestion pipeline and returns what happened.
 *
 * All decisions live here and all I/O paths are injectable, so the whole
 * pipeline can be exercised end to end against a pre-seeded cache with no
 * network. `cli.ts` wraps this with argument parsing and printing.
 */
export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const {
    spec,
    steps = new Set<string>(ALL_STEPS),
    rawDir,
    drugsDir = defaultDrugsDir(),
    refresh = false,
    maxLookups = 400,
    dryRun = false,
    now = new Date(),
    log = () => {},
  } = options;

  const ctx: IngestContext = makeContext(spec.slug, { rawDir, refresh });
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    log(`  ! ${message}`);
  };

  // --- fda -----------------------------------------------------------------
  log('[fda]   openFDA Drugs@FDA');
  const fda = await runFdaStage(ctx, spec.applicationNumber, spec.applicationType);
  log(
    `        ${fda.milestones.length} approved submissions, ${fda.documentUrls.length} documents linked`
  );

  // --- docs ----------------------------------------------------------------
  let docs: FetchedDoc[] = [];
  if (steps.has('docs')) {
    log('[docs]  downloading and parsing approval package');
    docs = await runDocsStage(ctx, fda.documentUrls);
    log(`        ${docs.length} documents parsed`);
  }

  const reviewDoc = docs.find((d) => /review/i.test(d.type));
  const reviewText = docs
    .filter((d) => /review/i.test(d.type))
    .map((d) => d.text)
    .join('\n');
  const labelDoc = docs.find((d) => /label/i.test(d.type));
  const allDocText = docs.map((d) => d.text).join('\n');

  // --- codes ---------------------------------------------------------------
  const trialsById = new Map<string, Trial>();
  let resolution: ResolveReport | null = null;

  if (steps.has('codes')) {
    log('[codes] extracting trial identifiers from documents');
    const candidates = extractCandidates(allDocText);
    log(`        ${candidates.length} candidate identifiers`);

    if (candidates.length === 0 && allDocText.length < 500) {
      warn(
        'no document text available. If the PDFs are scanned images, the ' +
          'identifiers cannot be read from them without OCR.'
      );
    }

    resolution = await resolveCandidates(ctx, candidates, spec.interventionNames, maxLookups);
    log(
      `        ${resolution.resolved.length} resolved, ${resolution.rejected.length} rejected, ` +
        `${resolution.skipped.length} skipped (${resolution.lookups} lookups)`
    );

    for (const r of resolution.resolved) {
      const trial = studyToTrial(r.study, ctgovStudyUrl(r.nctId));
      // Record where in the approval package the identifier was found.
      trial.provenance.citedIn = {
        sourceUrl: reviewDoc?.url ?? docs[0]?.url,
        sourceLabel: 'FDA approval package',
        page: r.candidate.firstPage,
        quote: r.candidate.quote,
        extractedBy: 'regex',
        verified: false,
      };
      trialsById.set(r.nctId, trial);
    }
  }

  // --- ctgov ---------------------------------------------------------------
  let registeredTrialCount = 0;
  if (steps.has('ctgov')) {
    log('[ctgov] searching the registry for every trial of this drug');
    const all = await searchByIntervention(ctx, spec.inn);
    const forDrug = all.filter((s) => studyMatchesDrug(s, spec.interventionNames));
    registeredTrialCount = forDrug.length;
    let added = 0;
    for (const study of forDrug) {
      const nctId = study.protocolSection?.identificationModule?.nctId;
      if (!nctId || trialsById.has(nctId)) continue;
      trialsById.set(nctId, studyToTrial(study, ctgovStudyUrl(nctId)));
      added++;
    }
    log(
      `        ${forDrug.length} registered trials, ${added} not cited in the approval package`
    );
  }

  // --- roles ---------------------------------------------------------------
  const labelSection14 = labelDoc ? extractLabelSection14(labelDoc.text) : null;
  if (labelDoc && !labelSection14) {
    warn(
      'could not locate section 14 in the label; pivotal classification falls ' +
        'back to review citation only.'
    );
  }

  let trials = applyRoles([...trialsById.values()], {
    labelSection14,
    reviewText,
    labelUrl: labelDoc?.url,
    reviewUrl: reviewDoc?.url,
  });

  // Deterministic order keeps the committed JSON diff-friendly across runs.
  trials = trials.sort((a, b) => {
    const ap = a.startDate?.value ?? '9999';
    const bp = b.startDate?.value ?? '9999';
    return ap.localeCompare(bp) || a.id.localeCompare(b.id);
  });

  const pivotal = trials.filter((t) => t.role === 'PIVOTAL').length;
  log(`[roles] ${pivotal} pivotal, ${trials.length - pivotal} other`);

  // --- merge ---------------------------------------------------------------
  const incoming = buildDrugRecord(spec, fda, trials, docs);
  const existing = loadExisting(drugsDir, spec.slug);
  const merged = mergeDrug(existing, incoming);

  // Only advance the ingest timestamp when something else actually changed.
  // Stamping every run would make each re-run produce a diff, which in turn
  // would make the workflow open a pull request even when nothing moved.
  const contentUnchanged =
    existing !== null && stableJson(withoutStamp(existing)) === stableJson(withoutStamp(merged.drug));
  merged.drug.lastIngestedAt = contentUnchanged
    ? existing.lastIngestedAt
    : now.toISOString();

  const validated = Drug.safeParse(merged.drug);
  if (!validated.success) {
    throw new Error(
      'Ingested record failed schema validation:\n' +
        validated.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    );
  }

  log(
    `[merge] ${merged.addedTrials.length} added, ${merged.updatedTrials.length} updated, ` +
      `${merged.droppedTrials.length} kept from previous run`
  );

  let outPath: string | null = null;
  let written = false;
  if (!dryRun) {
    mkdirSync(drugsDir, { recursive: true });
    outPath = join(drugsDir, `${spec.slug}.json`);
    writeFileSync(outPath, JSON.stringify(validated.data, null, 2) + '\n');
    written = true;
  }

  return {
    drug: validated.data,
    outPath,
    written,
    fda,
    docs,
    resolution,
    foundLabelSection14: labelSection14 !== null,
    registeredTrialCount,
    conflicts: merged.conflicts,
    addedTrials: merged.addedTrials,
    updatedTrials: merged.updatedTrials,
    droppedTrials: merged.droppedTrials,
    warnings,
  };
}

function withoutStamp(d: DrugType): Omit<DrugType, 'lastIngestedAt'> {
  const { lastIngestedAt: _ignored, ...rest } = d;
  return rest;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function buildDrugRecord(
  spec: DrugSpec,
  fda: FdaStageResult,
  trials: Trial[],
  docs: FetchedDoc[]
): DrugType {
  const original = fda.milestones.find((m) => m.type === 'FDA_APPROVAL');

  return {
    slug: spec.slug,
    brandName: spec.brandName,
    inn: spec.inn,
    modality: spec.modality,
    sponsor: spec.sponsor,
    mechanism: spec.mechanism,
    summary: '',
    indications: fda.milestones
      .filter((m) => m.type === 'FDA_APPROVAL' || m.type === 'FDA_SUPPLEMENT')
      .map((m) => ({
        name: m.description ?? m.label,
        approvalDate: m.date,
        submissionNumber: m.submissionNumber,
      })),
    regulatory: {
      us: {
        applicationNumber: spec.applicationNumber,
        applicationType: spec.applicationType,
        sponsor: fda.application.sponsor_name ?? spec.sponsor,
        originalApprovalDate: original?.date,
      },
    },
    trials,
    milestones: fda.milestones,
    sources: [
      {
        id: 'openfda',
        label: `openFDA Drugs@FDA — ${spec.applicationType} ${spec.applicationNumber}`,
        url: fda.queryUrl,
        type: 'other',
      },
      ...docs.map((d, i) => ({
        id: `doc-${i}`,
        label: `${d.type} (${d.submission})`,
        url: d.url,
        type: /label/i.test(d.type) ? ('fda_label' as const) : ('fda_review' as const),
      })),
    ],
  };
}
