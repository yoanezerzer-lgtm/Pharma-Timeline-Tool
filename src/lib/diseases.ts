import type { Approval, DateValue, Drug } from '../schema/index.js';
import { letterCore, naturalTerm, readableDefinition } from './plainText.js';
import { shownCategories } from './areas.js';
import { roleFor, trialShortName } from './drugs.js';

/**
 * Every approval for one disease across drugs, computed at build time (see
 * vite.config.ts) for the disease pages. A disease is a MeSH term an
 * approved use was matched to by the pipeline (scripts/ingest/diseases.ts).
 */
export interface DiseaseApproval {
  drugSlug: string;
  brandName: string;
  inn: string;
  indicationSlug: string;
  /** The FDA's wording of the approved use, as the label groups it. */
  indication: string;
  date?: DateValue;
  submission?: string;
  /** The approval letter's own sentence, when the use had several approvals. */
  statement?: string;
}

/** One step in an approved use's history: its first approval, or a later change to it. */
export interface UseStep {
  date?: DateValue;
  /** Submissions approved together with the same wording ("SUPPL-8", "SUPPL-12"). */
  submissions: string[];
  kind: Approval['kind'];
  /** What the step covers: the approval letter's sentence without its opening paperwork, or the label's wording. */
  text: string;
  sourceUrl?: string;
}

/** One approved use of one drug for this disease, with every step of its history. */
export interface DiseaseUse {
  drugSlug: string;
  brandName: string;
  inn: string;
  indicationSlug: string;
  /** The label's name for the use (or the short name a person chose). */
  indication: string;
  /** Oldest first. */
  steps: UseStep[];
  /** The pivotal trials behind the use, oldest start first, for the disease page's lanes. */
  trials: LaneTrial[];
  /** Every pivotal trial of the use, dated or not, for the precedent table. */
  pivotal: PivotalTrial[];
  /** The FDA application ("BLA 761055"). */
  application: string;
}

/** A pivotal trial as the precedent table lists it. */
export interface PivotalTrial {
  id: string;
  name: string;
  nctId?: string;
  primaryCompletion?: DateValue;
}

/** A pivotal trial drawn as a bar from its start to its primary completion. */
export interface LaneTrial {
  id: string;
  name: string;
  phase?: string;
  start?: DateValue;
  primaryCompletion?: DateValue;
}

export interface DiseaseSummary {
  meshId: string;
  /** MeSH's heading as MeSH files it ("Carcinoma, Non-Small-Cell Lung"). */
  term: string;
  /** The plain summary's name for it when there is one ("Breast Cancer"), else the heading in natural word order ("Non-Small-Cell Lung Carcinoma"). */
  name: string;
  areas: string[];
  definition?: { text: string; sourceUrl?: string };
  /** MedlinePlus's plain-language summary, word for word. */
  summary?: { title: string; paragraphs: string[]; sourceUrl?: string; sourceLabel: string };
  /** Oldest first; undated last. */
  approvals: DiseaseApproval[];
  /** The same approvals grouped by use, ordered by each use's first approval. */
  uses: DiseaseUse[];
}

export function summarizeDiseases(drugs: Drug[]): DiseaseSummary[] {
  const byId = new Map<string, DiseaseSummary>();
  for (const drug of drugs) {
    for (const i of drug.indications) {
      for (const d of i.diseases ?? []) {
        let entry = byId.get(d.meshId);
        if (!entry) {
          entry = { meshId: d.meshId, term: d.term, name: naturalTerm(d.term), areas: [], approvals: [], uses: [] };
          byId.set(d.meshId, entry);
        }
        entry.areas = shownCategories(d.meshId, [...new Set([...entry.areas, ...d.areas])].sort());
        if (!entry.definition && d.definition) entry.definition = { text: readableDefinition(d.definition.text), sourceUrl: d.definition.provenance.sourceUrl };
        if (!entry.summary && d.summary) {
          const sourceLabel = d.summary.provenance.sourceLabel ?? 'MedlinePlus, U.S. National Library of Medicine';
          entry.summary = { title: d.summary.title, paragraphs: d.summary.paragraphs, sourceUrl: d.summary.provenance.sourceUrl, sourceLabel };
          // A summary is matched only when its title is this same disease, so its everyday name ("Breast Cancer",
          // "non-small cell lung cancer") can head the page. A MedlinePlus Genetics page may go by a name the FDA
          // doesn't use ("Arginase 1 deficiency" for hyperargininemia): the MeSH name stays.
          if (!sourceLabel.startsWith('MedlinePlus Genetics')) entry.name = d.summary.title.charAt(0).toUpperCase() + d.summary.title.slice(1);
        }
        const base = { drugSlug: drug.slug, brandName: drug.brandName, inn: drug.inn, indicationSlug: i.slug, indication: i.name };
        // A use approved in steps (Keytruda's melanoma: 2014, then adjuvant in 2019) shows each step.
        if (i.approvals && i.approvals.length > 0) {
          for (const a of i.approvals) entry.approvals.push({ ...base, date: a.date, submission: a.submission, statement: a.statement });
        } else {
          entry.approvals.push({ ...base, date: i.approvalDate, submission: i.submissionNumber });
        }
        entry.uses.push({ ...base, indication: i.displayName ?? i.name, steps: useSteps(drug, i), trials: laneTrials(drug, i.name), pivotal: pivotalTrials(drug, i.name), application: applicationOf(drug, i) });
      }
    }
  }
  const out = [...byId.values()];
  const first = (u: DiseaseUse) => u.steps.find((s) => s.date)?.date?.value ?? '9999';
  for (const d of out) {
    d.approvals.sort((a, b) => (a.date?.value ?? '9999').localeCompare(b.date?.value ?? '9999'));
    d.uses.sort((a, b) => first(a).localeCompare(first(b)) || a.brandName.localeCompare(b.brandName));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The FDA application a use was approved under: the drug's own, unless the
 * pipeline dated it from a sibling application (Nemluvio's BLA 761391).
 */
function applicationOf(drug: Drug, i: Drug['indications'][number]): string {
  const sibling = !i.submissionNumber && /^Approved label \((BLA|NDA) (\d{6}),/.exec(i.approvalProvenance?.sourceLabel ?? '');
  if (sibling) return `${sibling[1]} ${sibling[2]}`;
  return drug.regulatory?.us ? `${drug.regulatory.us.applicationType} ${drug.regulatory.us.applicationNumber}` : '';
}

/**
 * What one approval letter approved, in the FDA's words: the letter's own
 * sentence cut to its core. A letter whose sentence is only the use's
 * heading ("Melanoma") says no more than the label, and one approving several
 * uses at once ("for the following indications: …") can't be cut to this
 * one: both show the label's wording.
 */
export function approvalWording(drug: Pick<Drug, 'brandName' | 'inn'>, i: Pick<Drug['indications'][number], 'name'>, a: Pick<Approval, 'statement'>): string {
  const names = [drug.brandName, drug.inn, drug.brandName.split(' ')[0]];
  return a.statement.trim() === i.name.trim() || /\bfollowing indications\b/i.test(a.statement) ? i.name : letterCore(a.statement, names);
}

/**
 * A use's history from its approval letters. Letters approved the same day
 * with the same sentence (Keytruda's S-8 and S-12) are one step.
 */
function useSteps(drug: Drug, i: Drug['indications'][number]): UseStep[] {
  if (!i.approvals || i.approvals.length === 0) {
    return [{ date: i.approvalDate, submissions: i.submissionNumber ? [i.submissionNumber] : [], kind: 'new', text: i.wording?.text ?? i.name, sourceUrl: i.approvalProvenance?.sourceUrl }];
  }
  const steps: UseStep[] = [];
  for (const a of [...i.approvals].sort((x, y) => x.date.value.localeCompare(y.date.value))) {
    const same = steps.find((s) => s.date?.value === a.date.value && s.kind === a.kind && s.text === approvalWording(drug, i, a));
    if (same) {
      same.submissions.push(a.submission);
      continue;
    }
    const text = approvalWording(drug, i, a);
    steps.push({ date: a.date, submissions: [a.submission], kind: a.kind, text, sourceUrl: a.provenance.sourceUrl });
  }
  return steps;
}

/** Every pivotal trial of the use, earliest primary completion first (undated last). */
function pivotalTrials(drug: Drug, indicationName: string): PivotalTrial[] {
  return drug.trials
    .filter((t) => roleFor(t, indicationName) === 'PIVOTAL')
    .map((t) => ({ id: t.id, name: trialShortName(t, drug.trials), nctId: t.nctId, primaryCompletion: t.primaryCompletionDate }))
    .sort((a, b) => (a.primaryCompletion?.value ?? '9999').localeCompare(b.primaryCompletion?.value ?? '9999'));
}

/** The use's pivotal trials with both ends dated, oldest start first. */
function laneTrials(drug: Drug, indicationName: string): LaneTrial[] {
  return drug.trials
    .filter((t) => roleFor(t, indicationName) === 'PIVOTAL' && t.startDate && t.primaryCompletionDate)
    .map((t) => ({ id: t.id, name: trialShortName(t, drug.trials), phase: t.phase, start: t.startDate, primaryCompletion: t.primaryCompletionDate }))
    .sort((a, b) => a.start!.value.localeCompare(b.start!.value));
}

/** Disease severity as the FDA's wording names it; uses of different severities aren't compared. */
export type Severity = 'moderate-to-severe' | 'mild-to-moderate' | 'not-stated';

export const SEVERITY_LABEL: Record<Severity, string> = {
  'moderate-to-severe': 'Moderate-to-severe',
  'mild-to-moderate': 'Mild-to-moderate',
  'not-stated': 'Severity not stated',
};

const MILD = /\bmild(?:[\s-]+to[\s-]+|[\s-]*(?:or|and)[\s-]*)moderate\b/i;
const SEVERE = /\bmoderate(?:[\s-]+to[\s-]+|[\s-]*(?:or|and)[\s-]*)severe\b/i;

/**
 * Which severity a use is approved for, read from the FDA's own wording: the
 * newest letter that names one, else the label's wording. Nothing named:
 * "not-stated", never a guess.
 */
export function severityOf(u: Pick<DiseaseUse, 'indication' | 'steps'>): Severity {
  return severityOfText([...u.steps.map((s) => s.text).reverse(), u.indication]);
}

/** The first severity the texts name, in order; "not-stated" when none does. */
export function severityOfText(texts: string[]): Severity {
  for (const text of texts) {
    if (MILD.test(text)) return 'mild-to-moderate';
    if (SEVERE.test(text)) return 'moderate-to-severe';
  }
  return 'not-stated';
}

/** A disease's uses split by severity, largest group first; one group when they all share one. */
export function severityGroups(disease: DiseaseSummary): { severity: Severity; label: string; disease: DiseaseSummary }[] {
  const by = new Map<Severity, DiseaseUse[]>();
  for (const u of disease.uses) {
    const s = severityOf(u);
    by.set(s, [...(by.get(s) ?? []), u]);
  }
  const named = [...by.keys()].filter((s) => s !== 'not-stated');
  // Only split a disease whose approvals name more than one severity.
  if (named.length < 2) return [{ severity: named[0] ?? 'not-stated', label: '', disease }];
  return [...by.entries()]
    .sort(([a, x], [b, y]) => Number(a === 'not-stated') - Number(b === 'not-stated') || y.length - x.length)
    .map(([severity, uses]) => ({
      severity,
      label: SEVERITY_LABEL[severity],
      disease: { ...disease, uses, approvals: disease.approvals.filter((a) => uses.some((u) => u.drugSlug === a.drugSlug && u.indicationSlug === a.indicationSlug)) },
    }));
}
