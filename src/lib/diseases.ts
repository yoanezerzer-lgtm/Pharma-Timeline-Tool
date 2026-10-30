import type { DateValue, Drug } from '../schema/index.js';

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

export interface DiseaseSummary {
  meshId: string;
  term: string;
  areas: string[];
  definition?: { text: string; sourceUrl?: string };
  /** MedlinePlus's plain-language summary, word for word. */
  summary?: { title: string; paragraphs: string[]; sourceUrl?: string };
  /** Oldest first; undated last. */
  approvals: DiseaseApproval[];
}

export function summarizeDiseases(drugs: Drug[]): DiseaseSummary[] {
  const byId = new Map<string, DiseaseSummary>();
  for (const drug of drugs) {
    for (const i of drug.indications) {
      for (const d of i.diseases ?? []) {
        let entry = byId.get(d.meshId);
        if (!entry) {
          entry = { meshId: d.meshId, term: d.term, areas: [], approvals: [] };
          byId.set(d.meshId, entry);
        }
        entry.areas = [...new Set([...entry.areas, ...d.areas])].sort();
        if (!entry.definition && d.definition) entry.definition = { text: d.definition.text, sourceUrl: d.definition.provenance.sourceUrl };
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
      }
    }
  }
  const out = [...byId.values()];
  for (const d of out) d.approvals.sort((a, b) => (a.date?.value ?? '9999').localeCompare(b.date?.value ?? '9999'));
  return out.sort((a, b) => a.term.localeCompare(b.term));
}
