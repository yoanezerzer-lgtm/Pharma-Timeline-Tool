import type { Approval, DateValue, Drug } from '../schema/index.js';
import { letterCore, naturalTerm, readableDefinition } from './plainText.js';

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
}

export interface DiseaseSummary {
  meshId: string;
  /** MeSH's heading as MeSH files it ("Carcinoma, Non-Small-Cell Lung"). */
  term: string;
  /** The same heading in natural word order ("Non-Small-Cell Lung Carcinoma"). */
  name: string;
  areas: string[];
  definition?: { text: string; sourceUrl?: string };
  /** MedlinePlus's plain-language summary, word for word. */
  summary?: { title: string; paragraphs: string[]; sourceUrl?: string };
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
        entry.areas = [...new Set([...entry.areas, ...d.areas])].sort();
        if (!entry.definition && d.definition) entry.definition = { text: readableDefinition(d.definition.text), sourceUrl: d.definition.provenance.sourceUrl };
        if (!entry.summary && d.summary) {
          entry.summary = { title: d.summary.title, paragraphs: d.summary.paragraphs, sourceUrl: d.summary.provenance.sourceUrl };
        }
        const base = { drugSlug: drug.slug, brandName: drug.brandName, inn: drug.inn, indicationSlug: i.slug, indication: i.name };
        // A use approved in steps (Keytruda's melanoma: 2014, then adjuvant in 2019) shows each step.
        if (i.approvals && i.approvals.length > 0) {
          for (const a of i.approvals) entry.approvals.push({ ...base, date: a.date, submission: a.submission, statement: a.statement });
        } else {
          entry.approvals.push({ ...base, date: i.approvalDate, submission: i.submissionNumber });
        }
        entry.uses.push({ ...base, indication: i.displayName ?? i.name, steps: useSteps(drug, i) });
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
 * A use's history from its approval letters. Letters approved the same day
 * with the same sentence (Keytruda's S-8 and S-12) are one step.
 */
function useSteps(drug: Drug, i: Drug['indications'][number]): UseStep[] {
  if (!i.approvals || i.approvals.length === 0) {
    return [{ date: i.approvalDate, submissions: i.submissionNumber ? [i.submissionNumber] : [], kind: 'new', text: i.name, sourceUrl: i.approvalProvenance?.sourceUrl }];
  }
  const names = [drug.brandName, drug.inn, drug.brandName.split(' ')[0]];
  const steps: UseStep[] = [];
  for (const a of [...i.approvals].sort((x, y) => x.date.value.localeCompare(y.date.value))) {
    const same = steps.find((s) => s.date?.value === a.date.value && s.kind === a.kind && s.text === letterCore(a.statement, names));
    if (same) {
      same.submissions.push(a.submission);
      continue;
    }
    // A letter whose sentence is only the use's heading ("Melanoma") says no more than the label: show the label's wording.
    // A letter approving several uses at once ("for the following indications: …") can't be cut to this one: show the label's wording.
    const text =
      a.statement.trim() === i.name.trim() || /\bfollowing indications\b/i.test(a.statement) ? i.name : letterCore(a.statement, names);
    steps.push({ date: a.date, submissions: [a.submission], kind: a.kind, text, sourceUrl: a.provenance.sourceUrl });
  }
  return steps;
}
