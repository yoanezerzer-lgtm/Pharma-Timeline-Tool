import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Drug as DrugType, type Trial, type Milestone } from '../../src/schema/index.js';
import { makeContext, type IngestContext } from './context.js';
import type { DrugSpec } from './registry.js';
import { identityFromApplication, runFdaStage, type FdaStageResult } from './fda.js';
import { runDocsStage, type FetchedDoc } from './docs.js';
import { extractCandidates, resolveCandidates, type ResolveReport } from './codes.js';
import { codeNamesFrom, studyToTrial, searchByIntervention, ctgovStudyUrl, studyMatchesDrug } from './ctgov.js';
import {
  applyRoles,
  extractLabelSection14,
  diagnoseSection14,
  extractTrialAliases,
  extractIndicationList,
  splitSection14ByIndication,
  runByApplicant,
  extractLabelTrialNames,
  type IndicationListEntry,
  type IndicationSpan,
} from './roles.js';
import { mergeDrug, canonicalJson, type Conflict } from './merge.js';
import { dateIndications } from './indicationDates.js';
import { approvalsByIndication, historyComplete, linkRolesToApprovals } from './approvals.js';
import { findReviews } from './reviews.js';

export const ALL_STEPS = ['fda', 'docs', 'codes', 'ctgov', 'merge'] as const;

interface IngestOptions {
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

interface IngestResult {
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

function defaultDrugsDir(): string {
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
    spec: given,
    steps = new Set<string>(ALL_STEPS),
    rawDir,
    drugsDir = defaultDrugsDir(),
    refresh = false,
    maxLookups = 3000,
    dryRun = false,
    now = new Date(),
    log = () => {},
  } = options;

  const ctx: IngestContext = makeContext(given.slug, { rawDir, refresh });
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    log(`  ! ${message}`);
  };

  // --- fda -----------------------------------------------------------------
  log('[fda]   openFDA Drugs@FDA');
  const fda = await runFdaStage(ctx, given.applicationNumber, given.applicationType, given.brandName);
  // A drug added by name or application number alone takes the rest of its identity from the FDA record.
  const identified = { ...given, ...identityFromApplication(given, fda.application, fda.applicationType) };
  // Its development codes come from the registry, so trials registered under a code are found too.
  const registered = steps.has('codes') || steps.has('ctgov') ? await searchByIntervention(ctx, identified.inn) : [];
  const codes = codeNamesFrom(registered, identified.inn).filter(
    (c) => !identified.interventionNames.some((n) => n.toLowerCase() === c.toLowerCase())
  );
  if (codes.length > 0) log(`        development codes from the registry: ${codes.join(', ')}`);
  const spec = { ...identified, interventionNames: [...identified.interventionNames, ...codes] };
  log(
    `        ${fda.milestones.length} approved submissions, ${fda.documentUrls.length} documents linked`
  );

  // --- docs ----------------------------------------------------------------
  let docs: FetchedDoc[] = [];
  if (steps.has('docs')) {
    log('[docs]  downloading and parsing approval package');
    // Reviews openFDA doesn't list, from the Drugs@FDA page.
    const listed = new Set(fda.documentUrls.map((d) => d.url));
    const extra = (await findReviews(ctx, fda.applicationNumber)).filter((d) => !listed.has(d.url));
    if (extra.length > 0) log(`        ${extra.length} more reviews linked from Drugs@FDA`);
    docs = await runDocsStage(ctx, [...fda.documentUrls, ...extra]);
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
    const byCode = await Promise.all(codes.map((c) => searchByIntervention(ctx, c)));
    const all = [...new Map([registered, ...byCode].flat().map((s) => [s.protocolSection?.identificationModule?.nctId, s])).values()];
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

  // Prefer the newest label whose section 14 actually splits into every
  // indication it lists, not just the newest with a section 14 at all.
  // Confirmed necessary against Skyrizi: its newest label (SUPPL-45) has a
  // section 14 that won't split by indication, which left every trial without
  // an indication-scoped role, while the label before it splits cleanly.
  // Falls back to whichever label split best.
  let labelSection14: string | null = null;
  let labelDoc: FetchedDoc | undefined;
  let indicationList: IndicationListEntry[] = [];
  let indicationSections: IndicationSpan[] = [];
  for (const candidate of labelDocsByRecency) {
    const section = extractLabelSection14(candidate.text);
    if (!section) continue;
    const list = extractIndicationList(candidate.text);
    const spans = list.length > 0 ? splitSection14ByIndication(section, list) : [];
    if (labelSection14 === null || spans.length > indicationSections.length) {
      labelSection14 = section;
      labelDoc = candidate;
      indicationList = list;
      indicationSections = spans;
    }
    if (list.length > 0 && spans.length === list.length) break;
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

  // Uncited trials are kept for future indications or regions — which only
  // ever come from the applicant's own program. Keytruda has ~2,700
  // registered trials, ~2,400 of them uncited academic studies; keeping those
  // made an 11.7 MB record. Posted results are likewise only kept for trials
  // in a filing, which is all the site shows them for.
  const sponsorName = fda.application.sponsor_name ?? spec.sponsor;
  const kept = rolesApplied.filter(
    (t) => t.roles.length > 0 || runByApplicant(t, sponsorName, spec.knownTrialSponsors)
  );
  if (kept.length < rolesApplied.length) {
    log(`[trim]  dropped ${rolesApplied.length - kept.length} uncited trial(s) not run by the applicant`);
  }
  const labelNames = labelSection14 ? extractLabelTrialNames(labelSection14) : new Map<string, string>();
  const trimmed = kept.map((t) => {
    const base = t.roles.length > 0 ? t : withoutPostedResults(t);
    const labelName = base.nctId ? labelNames.get(base.nctId) : undefined;
    if (!labelName || labelName === base.acronym) return base;
    return {
      ...base,
      labelName,
      provenance: {
        ...base.provenance,
        labelName: {
          sourceUrl: labelDoc?.url,
          sourceLabel: 'Approved label, section 14',
          quote: `${labelName} (${base.nctId})`,
          extractedBy: 'regex' as const,
          verified: false,
        },
      },
    };
  });

  // Deterministic order keeps the committed JSON diff-friendly across runs.
  const trials = trimmed.sort((a, b) => {
    const ap = a.startDate?.value ?? '9999';
    const bp = b.startDate?.value ?? '9999';
    return ap.localeCompare(bp) || a.id.localeCompare(b.id);
  });

  const pivotal = trials.filter((t) => t.roles.some((r) => r.role === 'PIVOTAL')).length;
  const withResults = trials.filter((t) => t.postedResults?.length).length;
  log(`[results] ${withResults} cited trial(s) have primary results posted to ClinicalTrials.gov`);
  log(
    `[roles] ${indicationSections.length} indication(s) found, ${pivotal} trial(s) pivotal for ` +
      `at least one, ${trials.length - pivotal} other`
  );

  // --- merge ---------------------------------------------------------------
  const incoming = buildDrugRecord(spec, fda, trials, docs, indicationList);
  const existing = loadExisting(drugsDir, spec.slug);
  const merged = mergeDrug(existing, incoming, now);
  merged.drug.trials = dedupeTrialIds(merged.drug.trials);

  // Only advance the ingest timestamp when something else actually changed.
  // Stamping every run would make each re-run produce a diff, which in turn
  // would make the workflow open a pull request even when nothing moved.
  const contentUnchanged =
    existing !== null && canonicalJson(withoutStamp(existing)) === canonicalJson(withoutStamp(merged.drug));
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

export function withoutPostedResults(trial: Trial): Trial {
  const { postedResults: _results, ...rest } = trial;
  const { postedResults: _prov, ...provenance } = trial.provenance;
  return { ...rest, provenance };
}

/**
 * Numbered indications ("1.1 Rheumatoid Arthritis") are already short — this
 * cap only bites on the unnumbered-indication fallback (extractIndicationList
 * in roles.ts), which reuses a label's full indication sentence verbatim.
 * Confirmed necessary against Foundayo's real label: its indication sentence
 * slugified to 260 characters. The display name stays the full sentence —
 * only the URL needs to be short.
 */
const MAX_INDICATION_SLUG_LENGTH = 60;

/** URL-safe id for routing, e.g. "Non-radiographic Axial Spondyloarthritis" -> "non-radiographic-axial-spondyloarthritis". */
export function slugifyIndication(name: string): string {
  const full = name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= MAX_INDICATION_SLUG_LENGTH) return full;
  // Cut at the last word boundary within the limit, not mid-word.
  const truncated = full.slice(0, MAX_INDICATION_SLUG_LENGTH);
  const lastHyphen = truncated.lastIndexOf('-');
  return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
}

/**
 * Truncation can give two indications the same slug — Keytruda's MSI-H
 * cancer and MSI-H colorectal cancer both cut to the same 50 characters,
 * leaving the second page unreachable. Later ones get "-2", "-3".
 */
export function uniqueSlugs(slugs: string[]): string[] {
  const seen = new Map<string, number>();
  return slugs.map((s) => {
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    return n === 1 ? s : `${s}-${n}`;
  });
}

function buildDrugRecord(
  spec: DrugSpec,
  fda: FdaStageResult,
  trials: Trial[],
  docs: FetchedDoc[],
  indicationList: IndicationListEntry[]
): DrugType {
  const original = fda.milestones.find((m) => m.type === 'FDA_APPROVAL');

  // openFDA's submission class doesn't say which disease a supplement was
  // for; the labels do. See dateIndications for how, and when it declines.
  const labels = docs.filter((d) => /label/i.test(d.type));
  const letters = docs.filter((d) => /letter/i.test(d.type));
  const approvals = dateIndications(indicationList.map((e) => e.name), labels, fda.milestones, letters);
  const slugs = uniqueSlugs(indicationList.map((e) => slugifyIndication(e.name)));
  // Every approval within each indication, from the letters; see approvals.ts.
  const datedBy = new Map([...approvals].map(([name, a]) => [name, a.submission]));
  const history = approvalsByIndication(indicationList.map((e) => e.name), letters, fda.milestones, datedBy);
  const indications = indicationList.map((entry, k) => {
    const approval = approvals.get(entry.name);
    const own = history.get(entry.name) ?? [];
    return {
      name: entry.name,
      slug: slugs[k],
      approvalDate: approval?.date ?? (entry.number === 1 && labels.length === 0 ? original?.date : undefined),
      submissionNumber: approval?.submission,
      approvalProvenance: approval?.provenance,
      ...(own.length > 0 ? { approvals: own } : {}),
    };
  });
  const completeFor = new Set(
    indications.filter((i) => historyComplete(i.approvals?.[0]?.date.value, letters, fda.milestones)).map((i) => i.name)
  );
  const reviews = docs.filter((d) => /review/i.test(d.type));
  trials = linkRolesToApprovals(trials, history, letters, completeFor, reviews);

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
