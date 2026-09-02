import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Drug as DrugType, type Trial } from '../../src/schema/index.js';
import { getSpec, DRUG_SPECS, type DrugSpec } from './registry.js';
import { runFdaStage } from './fda.js';
import { runDocsStage } from './docs.js';
import { extractCandidates, resolveCandidates } from './codes.js';
import { studyToTrial, searchByIntervention, ctgovStudyUrl, studyMatchesDrug } from './ctgov.js';
import { applyRoles, extractLabelSection14 } from './roles.js';
import { mergeDrug } from './merge.js';

const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');

interface Args {
  slug: string;
  steps: Set<string>;
  refresh: boolean;
  maxLookups: number;
  dryRun: boolean;
}

const ALL_STEPS = ['fda', 'docs', 'codes', 'ctgov', 'merge'];

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const slug = get('--drug');
  if (!slug) {
    console.error('Usage: npm run ingest -- --drug <slug> [--steps fda,docs,codes,ctgov,merge]');
    console.error(`Known drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`);
    process.exit(1);
  }

  const stepsRaw = get('--steps');
  return {
    slug,
    steps: new Set(stepsRaw ? stepsRaw.split(',').map((s) => s.trim()) : ALL_STEPS),
    refresh: argv.includes('--refresh'),
    maxLookups: Number(get('--max-lookups') ?? 400),
    dryRun: argv.includes('--dry-run'),
  };
}

function loadExisting(slug: string): DrugType | null {
  const path = join(DRUGS_DIR, `${slug}.json`);
  if (!existsSync(path)) return null;
  const parsed = Drug.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  return parsed.success ? parsed.data : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const spec = getSpec(args.slug);
  if (!spec) {
    console.error(`Unknown drug "${args.slug}". Add it to scripts/ingest/registry.ts.`);
    console.error(`Known drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nIngesting ${spec.brandName} (${spec.inn}) — ${spec.applicationType} ${spec.applicationNumber}\n`);

  // --- fda -----------------------------------------------------------------
  console.log('[fda]   openFDA Drugs@FDA');
  const fda = await runFdaStage(
    spec.slug,
    spec.applicationNumber,
    spec.applicationType,
    args.refresh
  );
  console.log(
    `        ${fda.milestones.length} approved submissions, ${fda.documentUrls.length} documents linked`
  );

  // --- docs ----------------------------------------------------------------
  let docs: Awaited<ReturnType<typeof runDocsStage>> = [];
  if (args.steps.has('docs')) {
    console.log('[docs]  downloading and parsing approval package');
    docs = await runDocsStage(spec.slug, fda.documentUrls, args.refresh);
    console.log(`        ${docs.length} documents parsed`);
  }

  const reviewText = docs
    .filter((d) => /review/i.test(d.type))
    .map((d) => d.text)
    .join('\n');
  const labelDoc = docs.find((d) => /label/i.test(d.type));
  const allDocText = docs.map((d) => d.text).join('\n');

  // --- codes ---------------------------------------------------------------
  const trialsById = new Map<string, Trial>();

  if (args.steps.has('codes')) {
    console.log('[codes] extracting trial identifiers from documents');
    const candidates = extractCandidates(allDocText);
    console.log(`        ${candidates.length} candidate identifiers`);

    if (candidates.length === 0 && allDocText.length < 500) {
      console.warn(
        '        ! no document text available. If the PDFs are scanned images, ' +
          'the identifiers cannot be read without OCR.'
      );
    }

    const report = await resolveCandidates(
      spec.slug,
      candidates,
      spec.interventionNames,
      args.maxLookups,
      args.refresh
    );
    console.log(
      `        ${report.resolved.length} resolved, ${report.rejected.length} rejected, ` +
        `${report.skipped.length} skipped (${report.lookups} lookups)`
    );

    for (const r of report.resolved) {
      const trial = studyToTrial(r.study, ctgovStudyUrl(r.nctId));
      // Record where in the approval package the identifier was found.
      trial.provenance.citedIn = {
        sourceUrl: docs[0]?.url,
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
  if (args.steps.has('ctgov')) {
    console.log('[ctgov] searching the registry for every trial of this drug');
    const all = await searchByIntervention(spec.slug, spec.inn, args.refresh);
    const forDrug = all.filter((s) => studyMatchesDrug(s, spec.interventionNames));
    let added = 0;
    for (const study of forDrug) {
      const nctId = study.protocolSection?.identificationModule?.nctId;
      if (!nctId || trialsById.has(nctId)) continue;
      trialsById.set(nctId, studyToTrial(study, ctgovStudyUrl(nctId)));
      added++;
    }
    console.log(
      `        ${forDrug.length} registered trials, ${added} not cited in the approval package`
    );
  }

  // --- roles ---------------------------------------------------------------
  const labelSection14 = labelDoc ? extractLabelSection14(labelDoc.text) : null;
  if (labelDoc && !labelSection14) {
    console.warn(
      '        ! could not locate section 14 in the label; pivotal classification ' +
        'will fall back to review citation only.'
    );
  }

  let trials = applyRoles([...trialsById.values()], {
    labelSection14,
    reviewText,
    labelUrl: labelDoc?.url,
    reviewUrl: docs.find((d) => /review/i.test(d.type))?.url,
  });

  // Deterministic order keeps the committed JSON diff-friendly across runs.
  trials = trials.sort((a, b) => {
    const ap = a.startDate?.value ?? '9999';
    const bp = b.startDate?.value ?? '9999';
    return ap.localeCompare(bp) || a.id.localeCompare(b.id);
  });

  const pivotal = trials.filter((t) => t.role === 'PIVOTAL').length;
  console.log(`[roles] ${pivotal} pivotal, ${trials.length - pivotal} other`);

  // --- merge ---------------------------------------------------------------
  const incoming = buildDrugRecord(spec, fda, trials, docs);
  const existing = loadExisting(spec.slug);
  const result = mergeDrug(existing, incoming);

  const validated = Drug.safeParse(result.drug);
  if (!validated.success) {
    console.error('\nIngested record failed schema validation:');
    for (const issue of validated.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(
    `[merge] ${result.addedTrials.length} added, ${result.updatedTrials.length} updated, ` +
      `${result.droppedTrials.length} kept from previous run`
  );

  if (result.conflicts.length > 0) {
    console.log(
      `\n  ${result.conflicts.length} conflict(s) against human-verified values — kept the verified value:`
    );
    for (const c of result.conflicts) {
      console.log(
        `    ${c.trialId}.${c.field}: kept ${JSON.stringify(c.keptValue)}, ` +
          `ingest offered ${JSON.stringify(c.incomingValue)}`
      );
    }
  }

  if (args.dryRun) {
    console.log('\n--dry-run: no files written.\n');
    return;
  }

  mkdirSync(DRUGS_DIR, { recursive: true });
  const outPath = join(DRUGS_DIR, `${spec.slug}.json`);
  writeFileSync(outPath, JSON.stringify(validated.data, null, 2) + '\n');
  console.log(`\nWrote ${outPath}\n`);
}

function buildDrugRecord(
  spec: DrugSpec,
  fda: Awaited<ReturnType<typeof runFdaStage>>,
  trials: Trial[],
  docs: Awaited<ReturnType<typeof runDocsStage>>
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
    lastIngestedAt: new Date().toISOString(),
  };
}

main().catch((err) => {
  console.error(`\nIngest failed: ${err.message}\n`);
  process.exit(1);
});
