/**
 * Plain-English display for ClinicalTrials.gov's enum codes. Display only —
 * the stored value stays the registry's own code, which is what the review
 * page shows for checking against the source.
 */
const SPECIAL: Record<string, string> = {
  ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  NOT_YET_RECRUITING: 'Not yet recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling by invitation',
  NON_RANDOMIZED: 'Non-randomized',
  NA: 'Not applicable',
};

const MASKING: Record<string, string> = {
  NONE: 'None (open label)',
  SINGLE: 'Single-blind',
  DOUBLE: 'Double-blind',
  TRIPLE: 'Triple-blind',
  QUADRUPLE: 'Quadruple-blind',
};

export function registryText(code: string): string {
  if (SPECIAL[code]) return SPECIAL[code];
  // Already human text (hand-entered, or a future registry change) — leave it alone.
  if (!/^[A-Z0-9_]+$/.test(code)) return code;
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function maskingText(code: string): string {
  return MASKING[code] ?? registryText(code);
}
