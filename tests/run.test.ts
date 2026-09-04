import { describe, it, expect } from 'vitest';
import { dedupeTrialIds } from '../scripts/ingest/run.js';
import type { Trial } from '../src/schema/index.js';

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, ...o,
  };
}

/**
 * Regression coverage for a real data-quality bug found in the committed
 * Rinvoq record: `id` is derived from acronym/protocol number for
 * readability, but AbbVie has genuinely reused the acronym "UPDATE" across
 * two unrelated real post-marketing studies, and a curated trial without a
 * registry match can share a protocol number with one a later run resolves
 * under its own NCT ID. Both produced two different Trial objects with the
 * identical `id` in the committed file, undetected until `tests/data.test.ts`
 * caught it against the real 162-trial dataset — the placeholder seed data
 * was too small to ever collide. `id` is what routing and cross-references
 * key off, so a collision silently drops one trial's page.
 */
describe('dedupeTrialIds', () => {
  it('leaves already-unique ids untouched', () => {
    const trials = [trial({ id: 'a', nctId: 'NCT00000001' }), trial({ id: 'b', nctId: 'NCT00000002' })];
    expect(dedupeTrialIds(trials).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('disambiguates a real collision by appending the NCT ID', () => {
    // The exact real shape: two distinct trials both acronymed "UPDATE".
    const trials = [
      trial({ id: 'update', nctId: 'NCT05327920' }),
      trial({ id: 'update', nctId: 'NCT05669794' }),
    ];
    const result = dedupeTrialIds(trials);
    expect(result[0].id).toBe('update');
    expect(result[1].id).toBe('update-nct05669794');
    expect(new Set(result.map((t) => t.id)).size).toBe(2);
  });

  it('falls back to a numeric suffix when the colliding trial has no NCT ID', () => {
    const trials = [trial({ id: 'm13-845', nctId: 'NCT01741493' }), trial({ id: 'm13-845' })];
    const result = dedupeTrialIds(trials);
    expect(result[0].id).toBe('m13-845');
    expect(result[1].id).toBe('m13-845-1');
  });

  it('is deterministic given the same input, preserving idempotent re-runs', () => {
    const trials = [trial({ id: 'x', nctId: 'NCT00000001' }), trial({ id: 'x', nctId: 'NCT00000002' })];
    const first = dedupeTrialIds(trials).map((t) => t.id);
    const second = dedupeTrialIds(trials).map((t) => t.id);
    expect(second).toEqual(first);
  });
});
