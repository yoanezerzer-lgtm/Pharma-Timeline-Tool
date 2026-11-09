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

/** What kind of FDA decision an approval was, as the disease and compare pages label it. */
export const APPROVAL_KIND: Record<Approval['kind'], string> = {
  new: 'Approved',
  expansion: 'Widened',
  revision: 'Wording changed',
  conversion: 'Converted to traditional approval',
};
