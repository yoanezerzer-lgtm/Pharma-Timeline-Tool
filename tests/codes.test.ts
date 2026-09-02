import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCandidates } from '../scripts/ingest/codes.js';

const reviewText = readFileSync(
  join(process.cwd(), 'tests/fixtures/review-excerpt.txt'),
  'utf8'
);

describe('extractCandidates', () => {
  const candidates = extractCandidates(reviewText);
  const tokens = candidates.map((c) => c.token);

  it('finds sponsor protocol numbers cited in the review', () => {
    for (const code of ['M13-545', 'M14-465', 'M13-549', 'M13-537', 'M13-550', 'M13-838']) {
      expect(tokens).toContain(code);
    }
  });

  it('finds NCT identifiers', () => {
    expect(tokens).toContain('NCT02629159');
    expect(tokens).toContain('NCT02675426');
  });

  it('finds trial acronyms', () => {
    expect(tokens).toContain('SELECT-COMPARE');
    expect(tokens).toContain('BALANCE-I');
  });

  it('ranks NCT identifiers above everything else', () => {
    // NCT IDs are exact, so they should never be crowded out of a capped run.
    const firstNonNct = candidates.findIndex((c) => !c.token.startsWith('NCT'));
    const lastNct = candidates.map((c) => c.token.startsWith('NCT')).lastIndexOf(true);
    expect(lastNct).toBeLessThan(firstNonNct);
  });

  it('ranks study-context tokens above incidental ones', () => {
    const compare = candidates.find((c) => c.token === 'M13-545');
    expect(compare).toBeDefined();
    expect(compare!.contextHits).toBeGreaterThan(0);
  });

  it('drops known non-identifier tokens from the guidance blocklist', () => {
    expect(tokens).not.toContain('ICH-E9');
  });

  it('drops year-like decimal tokens that are not protocol series', () => {
    expect(tokens).not.toContain('2018.11');
    expect(tokens).not.toContain('2019.08');
  });

  it('records the page and a quote for provenance', () => {
    const compare = candidates.find((c) => c.token === 'M13-545')!;
    expect(compare.firstPage).toBe(12);
    expect(compare.quote).toContain('SELECT-COMPARE');
  });

  it('is deterministic across runs', () => {
    expect(extractCandidates(reviewText).map((c) => c.token)).toEqual(tokens);
  });
});
