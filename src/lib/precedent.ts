import type { DateValue } from '../schema/index.js';
import type { DiseaseSummary, PivotalTrial, UseStep } from './diseases.js';

/**
 * The precedent table: one row per FDA approval letter for a disease, across
 * drugs, as an analyst lists precedents. Built from stored facts only:
 * trials are tied to an approval only when the record settles it (see
 * `trialsFor`), otherwise the row says "not yet matched".
 */
export interface PrecedentRow {
  key: string;
  drugSlug: string;
  indicationSlug: string;
  brandName: string;
  inn: string;
  company: string;
  /** "BLA 761055". */
  application: string;
  /** "ORIG-1", "SUPPL-12". */
  submissions: string[];
  date?: DateValue;
  kind: UseStep['kind'];
  /** What the approval covers, in the FDA's words (letter without its paperwork, or the label). */
  covers: string;
  /** The pivotal trials behind this approval; undefined when the documents don't tie trials to it. */
  trials?: PivotalTrial[];
  /** Whole months from the last of those trials' primary completion to this approval. */
  monthsAfterTrials?: number;
  letterUrl?: string;
}

export function precedentRows(disease: DiseaseSummary, companyOf: (drugSlug: string) => string): PrecedentRow[] {
  const rows: PrecedentRow[] = [];
  for (const u of disease.uses) {
    u.steps.forEach((step, k) => {
      const trials = trialsFor(u.steps, k, u.pivotal);
      rows.push({
        key: `${u.drugSlug}-${u.indicationSlug}-${k}`,
        drugSlug: u.drugSlug,
        indicationSlug: u.indicationSlug,
        brandName: u.brandName,
        inn: u.inn,
        company: companyOf(u.drugSlug),
        application: u.application,
        submissions: step.submissions,
        date: step.date,
        kind: step.kind,
        covers: step.text,
        trials,
        monthsAfterTrials: trials ? monthsAfter(trials, step.date) : undefined,
        letterUrl: step.sourceUrl,
      });
    });
  }
  return rows.sort((a, b) => (a.date?.value ?? '9999').localeCompare(b.date?.value ?? '9999') || a.brandName.localeCompare(b.brandName));
}

/**
 * Which pivotal trials stand behind one step of a use's history. A use with
 * a single approval: all of its pivotal trials. A use approved in steps:
 * the first approval gets the trials whose primary completion came before
 * it; the later steps get none, because the records don't say which trial
 * each later letter rests on, and a guess from dates is not a fact.
 */
export function trialsFor(steps: UseStep[], index: number, pivotal: PivotalTrial[]): PivotalTrial[] | undefined {
  if (steps.length === 1) return pivotal;
  if (index > 0) return undefined;
  const date = steps[0].date;
  if (!date) return undefined;
  return pivotal.filter((t) => t.primaryCompletion && t.primaryCompletion.value <= date.value);
}

/** Whole months from the latest primary completion (known to the month) to the approval. */
export function monthsAfter(trials: PivotalTrial[], approval?: DateValue): number | undefined {
  if (!approval || approval.precision === 'year') return undefined;
  const ends = trials
    .map((t) => t.primaryCompletion)
    .filter((d): d is DateValue => !!d && d.precision !== 'year' && d.value <= approval.value);
  if (ends.length === 0) return undefined;
  const last = ends.reduce((a, b) => (b.value > a.value ? b : a));
  const [ay, am] = approval.value.split('-').map(Number);
  const [ly, lm] = last.value.split('-').map(Number);
  return (ay - ly) * 12 + (am - lm);
}
