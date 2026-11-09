import type { Approval } from '../schema/index.js';

/**
 * Wording the site uses on more than one page, kept in one place so every
 * page says the same thing. Words quoted from the FDA, MeSH, MedlinePlus or
 * ClinicalTrials.gov never go here: those are shown exactly as published.
 */

/** When the documents don't settle an approval date. */
export const DATE_UNCLEAR = 'Date unclear';

/** When the documents don't tie a fact (a trial, a disease) to what it belongs to. */
export const NOT_YET_MATCHED = 'Not yet matched';

/**
 * What kind of FDA decision an approval was, in the industry's terms. A new
 * use is an "Original approval" on the drug's first application (ORIG-1) and
 * a "New indication" on a supplement (SUPPL-n); see approvalKindLabel.
 */
export const APPROVAL_KIND: Record<Approval['kind'], string> = {
  new: 'Original approval',
  expansion: 'Label expansion',
  revision: 'Indication revised',
  conversion: 'Converted to traditional approval',
};

/** The kind's label for one letter: a new use approved on a supplement is a "New indication". */
export function approvalKindLabel(kind: Approval['kind'], submission?: string | readonly string[]): string {
  const subs = typeof submission === 'string' ? [submission] : submission ?? [];
  if (kind === 'new' && subs.length > 0 && subs.every((x) => /^SUPPL/i.test(x))) return 'New indication';
  return APPROVAL_KIND[kind];
}
