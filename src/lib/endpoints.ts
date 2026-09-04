/**
 * Tags an endpoint's text with what kind of outcome it measures.
 *
 * ClinicalTrials.gov doesn't classify outcome measures itself — each is just
 * a free-text `measure` string ("Percentage of Participants Achieving an
 * ACR20 Response" vs "Number of Participants With Treatment-Emergent Adverse
 * Events"). This is a keyword rule, not inference: it looks for the
 * vocabulary safety and pharmacokinetic endpoints actually use, and reads
 * anything else as efficacy — the overwhelming majority of primary endpoints
 * in an interventional trial, by design.
 */
export type EndpointCategory = 'EFFICACY' | 'SAFETY' | 'PK';

export const ENDPOINT_CATEGORY_LABEL: Record<EndpointCategory, string> = {
  EFFICACY: 'Efficacy',
  SAFETY: 'Safety',
  PK: 'Pharmacokinetic',
};

const SAFETY_PATTERN =
  /\b(adverse event|adverse reaction|safety|tolerability|serious adverse|treatment-emergent|discontinuation due to|laboratory abnormalit|toxicit|dose-limiting)/i;

const PK_PATTERN =
  /\b(pharmacokinetic|c\s?max|auc|half-life|clearance|plasma concentration|bioavailab|trough concentration)/i;

export function categorizeEndpoint(text: string): EndpointCategory {
  if (SAFETY_PATTERN.test(text)) return 'SAFETY';
  if (PK_PATTERN.test(text)) return 'PK';
  return 'EFFICACY';
}
