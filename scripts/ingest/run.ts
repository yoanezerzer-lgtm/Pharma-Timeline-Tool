import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Drug as DrugType, type Trial, type Milestone } from '../../src/schema/index.js';
import { makeContext, type IngestContext } from './context.js';
import type { DrugSpec } from './registry.js';
import { runFdaStage, type FdaStageResult } from './fda.js';
import { runDocsStage, type FetchedDoc } from './docs.js';
import { extractCandidates, resolveCandidates, type ResolveReport } from './codes.js';
import { studyToTrial, searchByIntervention, ctgovStudyUrl, studyMatchesDrug } from './ctgov.js';
import {
  applyRoles,
  extractLabelSection14,
  diagnoseSection14,
  extractTrialAliases,
  extractIndicationList,
  splitSection14ByIndication,
  type IndicationListEntry,
} from './roles.js';
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
    maxLookups = 3000,
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
  const fda = await runFdaStage(ctx, spec.applicationNumber, spec.applicationType, spec.brandName);
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

    // The lookup budget is a runtime guard, not a cost control — every lookup
    // is a free, fast registry query. A skip means a candidate identifier was
    // never checked at all, which can silently leave a real trial out of the
    // dossier. Worth a loud warning, not just a number buried in the summary line.
    if (resolution.skipped.length > 0) {
      warn(
        `${resolution.skipped.length} of ${candidates.length} candidate identifiers were ` +
          `never checked against ClinicalTrials.gov — the lookup budget (--max-lookups ` +
          `${maxLookups}) ran out first. Some real trials may be missing. Raise --max-lookups ` +
          `and re-run; lookups are free.`
      );
    }

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
  // A mature drug carries a label document per approved supplement, and
  // openFDA's array order isn't chronological. Try them newest-first and use
  // whichever one actually yields a locatable section 14 — the most recent
  // label is usually the most complete (it accumulates every indication
  // approved so far), but an individual document can still extract badly
  // (an odd layout, a partial supplement label), so falling through to older
  // ones is cheap insurance rather than betting the whole run on one document.
  const labelDocsByRecency = [...docs.filter((d) => /label/i.test(d.type))].sort(
    (a, b) => submissionDate(b.submission, fda.milestones).localeCompare(submissionDate(a.submission, fda.milestones))
  );

  let labelSection14: string | null = null;
  let labelDoc: FetchedDoc | undefined;
  let indicationList: IndicationListEntry[] = [];
  for (const candidate of labelDocsByRecency) {
    const section = extractLabelSection14(candidate.text);
    if (section) {
      labelSection14 = section;
      labelDoc = candidate;
      indicationList = extractIndicationList(candidate.text);
      break;
    }
  }

  if (labelDocsByRecency.length > 0 && !labelSection14) {
    // None of the label documents yielded a locatable section 14. Diagnose the
    // most recent one so the log says something more useful than "not found" —
    // this is the field where PDF text extraction is most likely to misbehave.
    const diag = diagnoseSection14(labelDocsByRecency[0].text);
    warn(
      `could not locate section 14 in any of ${labelDocsByRecency.length} label document(s) ` +
        `checked. ` +
        (diag.phrasePresent
          ? `The phrase "CLINICAL STUDIES" does appear (page ${diag.page ?? 'unknown'} of ` +
            `${labelDocsByRecency[0].submission}) but not as a numbered heading — extracted ` +
            `text nearby: "${diag.snippet}"`
          : `The phrase "CLINICAL STUDIES" does not appear anywhere in the extracted text of ` +
            `the most recent label (${labelDocsByRecency[0].submission}) — the PDF text layer ` +
            `may not have extracted correctly.`) +
        ' Pivotal classification falls back to review citation only.'
    );
  }

  // A label that has accumulated indications over years of supplements often
  // renames historical trials to a generic scheme ("Trial RA-I") that appears
  // nowhere in the registry record — the pairing to the real NCT number lives
  // in the review, not the label itself. Scanning the whole corpus (not just
  // the label) is what lets applyRoles recognise that generic name even
  // though only the review states the pairing explicitly.
  const trialAliases = extractTrialAliases(allDocText);

  const indicationSections =
    labelSection14 && indicationList.length > 0
      ? splitSection14ByIndication(labelSection14, indicationList)
      : [];

  if (labelSection14 && indicationList.length === 0) {
    warn(
      'section 14 was located, but the indication list could not be read from section 1 ' +
        '(Indications and Usage). Pivotal classification falls back to review citation only.'
    );
  } else if (indicationSections.length < indicationList.length) {
    warn(
      `only found ${indicationSections.length} of ${indicationList.length} known indications' ` +
        `section 14 subsections. Missing: ${indicationList
          .filter((e) => !indicationSections.some((s) => s.indication === e.name))
          .map((e) => e.name)
          .join(', ')}.`
    );
  }

  const { trials: rolesApplied, phaseWarnings } = applyRoles([...trialsById.values()], {
    indicationSections,
    reviewText,
    labelUrl: labelDoc?.url,
    reviewUrl: reviewDoc?.url,
    sponsorName: fda.application.sponsor_name ?? spec.sponsor,
    knownTrialSponsors: spec.knownTrialSponsors,
    trialAliases,
  });
  phaseWarnings.forEach(warn);

  // Deterministic order keeps the committed JSON diff-friendly across runs.
  const trials = rolesApplied.sort((a, b) => {
    const ap = a.startDate?.value ?? '9999';
    const bp = b.startDate?.value ?? '9999';
    return ap.localeCompare(bp) || a.id.localeCompare(b.id);
  });

  const pivotal = trials.filter((t) => t.roles.some((r) => r.role === 'PIVOTAL')).length;
  log(
    `[roles] ${indicationSections.length} indication(s) found, ${pivotal} trial(s) pivotal for ` +
      `at least one, ${trials.length - pivotal} other`
  );

  // --- merge ---------------------------------------------------------------
  const incoming = buildDrugRecord(spec, fda, trials, docs, indicationList);
  const existing = loadExisting(drugsDir, spec.slug);
  const merged = mergeDrug(existing, incoming);
  merged.drug.trials = dedupeTrialIds(merged.drug.trials);

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

/**
 * The approval date of the submission a document belongs to, for sorting
 * label documents newest-first. Empty string sorts last for a submission we
 * have no milestone for (shouldn't normally happen, since documents come from
 * submissions that were themselves used to build milestones).
 */
function submissionDate(submission: string, milestones: Milestone[]): string {
  return milestones.find((m) => m.submissionNumber === submission)?.date.value ?? '';
}

/**
 * Guarantees every trial's `id` is unique, even when two genuinely different
 * trials share whatever slugifyId() derived it from — confirmed against real
 * Rinvoq data, where AbbVie reused the acronym "UPDATE" across two unrelated
 * post-marketing studies (NCT05327920 and NCT05669794), and a trial curated
 * before it had a registry match can share a protocol number with a trial a
 * later run resolves under its own NCT ID. `id` is what routing and
 * cross-references key off, so a collision here is silent data loss in the
 * UI — whichever trial's URL is visited resolves to only one of them — not
 * merely a cosmetic annoyance. Deterministic given the same input order, so
 * this does not break the pipeline's byte-identical-rerun guarantee.
 */
export function dedupeTrialIds(trials: Trial[]): Trial[] {
  const seen = new Map<string, number>();
  return trials.map((t) => {
    const count = seen.get(t.id) ?? 0;
    seen.set(t.id, count + 1);
    if (count === 0) return t;
    const suffix = t.nctId ? t.nctId.toLowerCase() : String(count);
    return { ...t, id: `${t.id}-${suffix}` };
  });
}

function withoutStamp(d: DrugType): Omit<DrugType, 'lastIngestedAt'> {
  const { lastIngestedAt: _ignored, ...rest } = d;
  return rest;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** URL-safe id for routing, e.g. "Non-radiographic Axial Spondyloarthritis" -> "non-radiographic-axial-spondyloarthritis". */
export function slugifyIndication(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildDrugRecord(
  spec: DrugSpec,
  fda: FdaStageResult,
  trials: Trial[],
  docs: FetchedDoc[],
  indicationList: IndicationListEntry[]
): DrugType {
  const original = fda.milestones.find((m) => m.type === 'FDA_APPROVAL');

  // openFDA's own submission classification ("Efficacy", "Labeling",
  // "Manufacturing (CMC)") is not the indication — it does not say which
  // disease a supplement was for. Real indication names only exist in the
  // label's own section 1 numbering (see extractIndicationList). The first
  // indication (1.1) is dated by the original approval; a later indication's
  // exact approval date isn't reliably derivable from openFDA data alone, so
  // it's left unset rather than guessed at.
  const indications = indicationList.map((entry) => ({
    name: entry.name,
    slug: slugifyIndication(entry.name),
    approvalDate: entry.number === 1 ? original?.date : undefined,
  }));

  return {
    slug: spec.slug,
    brandName: spec.brandName,
    inn: spec.inn,
    modality: spec.modality,
    sponsor: spec.sponsor,
    mechanism: spec.mechanism,
    summary: '',
    indications,
    regulatory: {
      us: {
        applicationNumber: fda.applicationNumber,
        applicationType: fda.applicationType,
        sponsor: fda.application.sponsor_name ?? spec.sponsor,
        originalApprovalDate: original?.date,
      },
    },
    trials,
    milestones: fda.milestones,
    sources: [
      {
        id: 'openfda',
        label: `openFDA Drugs@FDA — ${fda.applicationType} ${fda.applicationNumber}`,
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
