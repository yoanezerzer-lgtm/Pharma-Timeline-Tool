import type { DateValue, Drug } from '../schema/index.js';
import { trialsForIndication } from './drugs.js';
import { drugStats, drugPendingChangeCount, type VerificationStats } from './review.js';

/**
 * Everything the landing page and review index need about a drug, computed
 * at build time (see vite.config.ts) so those pages never download the full
 * records — which run to hundreds of KB each, mostly trials only the
 * indication and review pages ever show.
 */
export interface DrugSummary {
  slug: string;
  brandName: string;
  inn: string;
  sponsor: string;
  modality: string;
  mechanism?: string;
  trialCount: number;
  indications: { name: string; displayName?: string; slug: string; approvalDate?: DateValue; trialCount: number }[];
  verification: VerificationStats;
  /** Pivotal-trial facts in data/reference: how many the checker has confirmed against FDA documents. */
  checked: CheckStats;
  pendingChanges: number;
}

export interface CheckStats {
  confirmed: number;
  total: number;
}

export type CheckState = 'unchecked' | 'partial' | 'checked';

/** A drug counts as checked only once every pivotal-trial fact is confirmed; nothing confirmed is "not yet checked". */
export function checkState({ confirmed, total }: CheckStats): CheckState {
  if (confirmed === 0) return 'unchecked';
  return confirmed < total ? 'partial' : 'checked';
}

/** Counts a reference file's pivotal entries (an unparsed file: only these two fields are read). */
export function checkStats(ref: { pivotal?: { status?: string }[] } | undefined): CheckStats {
  const pivotal = ref?.pivotal ?? [];
  return { confirmed: pivotal.filter((p) => p.status === 'confirmed').length, total: pivotal.length };
}

export function summarize(drug: Drug, checked: CheckStats = { confirmed: 0, total: 0 }): DrugSummary {
  return {
    slug: drug.slug,
    brandName: drug.brandName,
    inn: drug.inn,
    sponsor: drug.sponsor,
    modality: drug.modality,
    mechanism: drug.mechanism,
    trialCount: drug.trials.length,
    indications: drug.indications.map((i) => ({
      name: i.name,
      displayName: i.displayName,
      slug: i.slug,
      approvalDate: i.approvalDate,
      trialCount: trialsForIndication(drug, i.name).length,
    })),
    verification: drugStats(drug),
    checked,
    pendingChanges: drugPendingChangeCount(drug),
  };
}
