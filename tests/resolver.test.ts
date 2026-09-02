import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CtgovStudy } from '../scripts/ingest/ctgov.js';

// The resolver's whole premise is that ClinicalTrials.gov acts as the oracle:
// a loose regex is safe because tokens that are not real study identifiers
// resolve to nothing. Mocking the lookup lets that be tested offline.
const lookupById = vi.fn<(slug: string, id: string) => Promise<CtgovStudy[]>>();

vi.mock('../scripts/ingest/ctgov.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scripts/ingest/ctgov.js')>();
  return { ...actual, lookupById: (slug: string, id: string) => lookupById(slug, id) };
});

const { resolveCandidates, extractCandidates } = await import('../scripts/ingest/codes.js');

function study(nctId: string, orgId: string, intervention: string): CtgovStudy {
  return {
    protocolSection: {
      identificationModule: {
        nctId,
        orgStudyIdInfo: { id: orgId },
        briefTitle: `A study of ${intervention}`,
      },
      armsInterventionsModule: { interventions: [{ name: intervention }] },
    },
  };
}

const REAL: Record<string, CtgovStudy> = {
  'M13-545': study('NCT02629159', 'M13-545', 'upadacitinib'),
  'M14-465': study('NCT02675426', 'M14-465', 'upadacitinib'),
};

beforeEach(() => {
  lookupById.mockReset();
  // Anything not in REAL resolves to nothing, which is how the registry
  // behaves for a token that was never a study identifier.
  lookupById.mockImplementation(async (_slug, id) => (REAL[id] ? [REAL[id]] : []));
});

describe('resolveCandidates', () => {
  const cand = (token: string) => ({
    token,
    occurrences: 1,
    contextHits: 1,
    score: 1,
  });

  it('keeps identifiers that resolve to a study for this drug', async () => {
    const report = await resolveCandidates(
      'upadacitinib',
      [cand('M13-545'), cand('M14-465')],
      ['upadacitinib']
    );
    expect(report.resolved.map((r) => r.nctId)).toEqual(['NCT02629159', 'NCT02675426']);
    expect(report.rejected).toHaveLength(0);
  });

  it('discards junk tokens that resolve to nothing', async () => {
    const junk = ['Table-5', 'ICH-E6', 'AB1234', 'Section-14', '1200.22'].map(cand);
    const report = await resolveCandidates('upadacitinib', junk, ['upadacitinib']);
    expect(report.resolved).toHaveLength(0);
    expect(report.rejected.map((r) => r.token)).toEqual([
      'Table-5',
      'ICH-E6',
      'AB1234',
      'Section-14',
      '1200.22',
    ]);
  });

  it('discards a study that exists but is for a different drug', async () => {
    lookupById.mockImplementation(async () => [
      study('NCT09999999', 'X99-999', 'adalimumab'),
    ]);
    const report = await resolveCandidates('upadacitinib', [cand('X99-999')], [
      'upadacitinib',
    ]);
    expect(report.resolved).toHaveLength(0);
    expect(report.rejected).toHaveLength(1);
  });

  it('discards a near-match that does not actually carry the searched identifier', async () => {
    // The registry can return fuzzy matches; requiring the identifier to appear
    // on the record stops an unrelated trial being attributed to a token.
    lookupById.mockImplementation(async () => [
      study('NCT01111111', 'TOTALLY-OTHER', 'upadacitinib'),
    ]);
    const report = await resolveCandidates('upadacitinib', [cand('M13-999')], [
      'upadacitinib',
    ]);
    expect(report.resolved).toHaveLength(0);
  });

  it('never returns the same trial twice when several tokens point at it', async () => {
    lookupById.mockImplementation(async (_s, id) =>
      id === 'M13-545' || id === 'NCT02629159' ? [REAL['M13-545']] : []
    );
    const report = await resolveCandidates(
      'upadacitinib',
      [cand('NCT02629159'), cand('M13-545')],
      ['upadacitinib']
    );
    expect(report.resolved).toHaveLength(1);
  });

  it('respects the lookup budget and reports what it skipped', async () => {
    const many = Array.from({ length: 10 }, (_, i) => cand(`M13-${500 + i}`));
    const report = await resolveCandidates('upadacitinib', many, ['upadacitinib'], 3);
    expect(report.lookups).toBe(3);
    expect(report.skipped).toHaveLength(7);
  });

  it('resolves real codes pulled straight out of review text', async () => {
    const text = 'Study M13-545 (SELECT-COMPARE) and Study M14-465 were pivotal.';
    const report = await resolveCandidates(
      'upadacitinib',
      extractCandidates(text),
      ['upadacitinib']
    );
    expect(report.resolved.map((r) => r.nctId).sort()).toEqual([
      'NCT02629159',
      'NCT02675426',
    ]);
  });
});
