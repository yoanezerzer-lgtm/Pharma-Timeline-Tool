import { describe, it, expect } from 'vitest';
import { getSpec } from '../scripts/ingest/registry.js';

/**
 * Regression coverage for a real production failure: a workflow_dispatch run
 * typed "Upadacitinib" (capitalized, as someone naturally would) and failed
 * with "unknown drug" despite it being an exact match in every way that
 * matters. The dispatch form is free text — this needs to be forgiving.
 */
describe('getSpec', () => {
  it('finds a drug regardless of the input casing', () => {
    expect(getSpec('upadacitinib')?.slug).toBe('upadacitinib');
    expect(getSpec('Upadacitinib')?.slug).toBe('upadacitinib');
    expect(getSpec('UPADACITINIB')?.slug).toBe('upadacitinib');
    expect(getSpec('UpaDacitinib')?.slug).toBe('upadacitinib');
  });

  it('returns undefined for a genuinely unknown drug', () => {
    expect(getSpec('not-a-real-drug')).toBeUndefined();
  });
});
