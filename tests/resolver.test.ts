import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CtgovStudy } from '../scripts/ingest/ctgov.js';

// The resolver's whole premise is that ClinicalTrials.gov acts as the oracle:
// a loose regex is safe because tokens that are not real study identifiers
// resolve to nothing. Mocking the lookup lets that be tested offline.
const lookupById = vi.fn<(id: string) => Promise<CtgovStudy[]>>();

vi.mock('../scripts/ingest/ctgov.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scripts/ingest/ctgov.js')>();
  return {
    ...actual,
    lookupById: (_ctx: unknown, id: string) => lookupById(id),
  };
});

const { resolveCandidates, extractCandidates, bestCitation } = await import(
  '../scripts/ingest/codes.js'
);
const { makeContext } = await import('../scripts/ingest/context.js');

const ctx = makeContext('upadacitinib');

function study(
  nctId: string,
  orgId: string,
  intervention: string,
  acronym?: string
): CtgovStudy {
  return {
    protocolSection: {
      identificationModule: {
        nctId,
        acronym,
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
  lookupById.mockImplementation(async (id) => (REAL[id] ? [REAL[id]] : []));
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
      ctx,
      [cand('M13-545'), cand('M14-465')],
      ['upadacitinib']
    );
    expect(report.resolved.map((r) => r.nctId)).toEqual(['NCT02629159', 'NCT02675426']);
    expect(report.rejected).toHaveLength(0);
  });

  it('discards junk tokens that resolve to nothing', async () => {
    const junk = ['Table-5', 'ICH-E6', 'AB1234', 'Section-14', '1200.22'].map(cand);
    const report = await resolveCandidates(
      ctx, junk, ['upadacitinib']);
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
    const report = await resolveCandidates(
      ctx, [cand('X99-999')], [
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
    const report = await resolveCandidates(
      ctx, [cand('M13-999')], [
      'upadacitinib',
    ]);
    expect(report.resolved).toHaveLength(0);
  });

  it('never returns the same trial twice when several tokens point at it', async () => {
    lookupById.mockImplementation(async (id) =>
      id === 'M13-545' || id === 'NCT02629159' ? [REAL['M13-545']] : []
    );
    const report = await resolveCandidates(
      ctx,
      [cand('NCT02629159'), cand('M13-545')],
      ['upadacitinib']
    );
    expect(report.resolved).toHaveLength(1);
  });

  it('respects the lookup budget and reports what it skipped', async () => {
    const many = Array.from({ length: 10 }, (_, i) => cand(`M13-${500 + i}`));
    const report = await resolveCandidates(
      ctx, many, ['upadacitinib'], 3);
    expect(report.lookups).toBe(3);
    expect(report.skipped).toHaveLength(7);
  });

  it('resolves real codes pulled straight out of review text', async () => {
    const text = 'Study M13-545 (SELECT-COMPARE) and Study M14-465 were pivotal.';
    const report = await resolveCandidates(
      ctx,
      extractCandidates(text),
      ['upadacitinib']
    );
    expect(report.resolved.map((r) => r.nctId).sort()).toEqual([
      'NCT02629159',
      'NCT02675426',
    ]);
  });
});

describe('bestCitation', () => {
  const cand = (token: string, contextHits: number, occurrences = 1) => ({
    token, occurrences, contextHits, score: 0,
  });

  it('prefers the mention with the most study context', () => {
    // An NCT ID usually sits in a bare list of registrations; a protocol number
    // sits in the sentence that describes the study. The latter is the more
    // useful citation to show a person checking the source.
    const chosen = bestCitation([cand('NCT02629159', 0), cand('M13-545', 2)]);
    expect(chosen.token).toBe('M13-545');
  });

  it('falls back to frequency when context is equal', () => {
    expect(bestCitation([cand('M13-545', 1, 1), cand('SELECT-COMPARE', 1, 5)]).token).toBe(
      'SELECT-COMPARE'
    );
  });

  it('prefers a non-NCT token when context and frequency tie', () => {
    expect(bestCitation([cand('NCT02629159', 1), cand('M13-545', 1)]).token).toBe('M13-545');
  });

  it('is deterministic for otherwise identical candidates', () => {
    // Non-determinism here would make each run produce a different file.
    const a = [cand('B-222', 1), cand('A-111', 1)];
    expect(bestCitation(a).token).toBe(bestCitation([...a].reverse()).token);
  });
});

describe('alias collection', () => {
  it('gathers every identifier pointing at one study instead of dropping them', async () => {
    // The study must genuinely carry each identifier — the resolver refuses to
    // attribute a trial to a token the registry record does not list.
    const withAcronym = study('NCT02629159', 'M13-545', 'upadacitinib', 'SELECT-COMPARE');
    lookupById.mockImplementation(async (id) =>
      ['M13-545', 'SELECT-COMPARE', 'NCT02629159'].includes(id) ? [withAcronym] : []
    );
    const report = await resolveCandidates(
      ctx,
      [
        { token: 'NCT02629159', occurrences: 1, contextHits: 0, score: 0 },
        { token: 'M13-545', occurrences: 1, contextHits: 3, score: 0 },
        { token: 'SELECT-COMPARE', occurrences: 1, contextHits: 2, score: 0 },
      ],
      ['upadacitinib']
    );
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0].aliases).toHaveLength(2);
    // The best-contextualised mention becomes the citation.
    expect(report.resolved[0].candidate.token).toBe('M13-545');
  });

  it('does not alias an identifier the registry record does not carry', async () => {
    // Guards the same rule from the other side: a token that merely returns a
    // study must not be recorded as one of that study's identifiers.
    lookupById.mockImplementation(async () => [REAL['M13-545']]);
    const report = await resolveCandidates(
      ctx,
      [
        { token: 'M13-545', occurrences: 1, contextHits: 1, score: 0 },
        { token: 'SELECT-COMPARE', occurrences: 1, contextHits: 9, score: 0 },
      ],
      ['upadacitinib']
    );
    expect(report.resolved[0].aliases).toHaveLength(0);
    expect(report.rejected.map((r) => r.token)).toEqual(['SELECT-COMPARE']);
  });
});
