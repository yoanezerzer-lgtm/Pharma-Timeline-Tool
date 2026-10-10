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
  indications: { name: string; slug: string; approvalDate?: DateValue; trialCount: number }[];
  verification: VerificationStats;
  pendingChanges: number;
}

export function summarize(drug: Drug): DrugSummary {
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
      slug: i.slug,
      approvalDate: i.approvalDate,
      trialCount: trialsForIndication(drug, i.name).length,
    })),
    verification: drugStats(drug),
    pendingChanges: drugPendingChangeCount(drug),
  };
}
