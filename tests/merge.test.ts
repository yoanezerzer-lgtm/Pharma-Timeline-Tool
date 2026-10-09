import { describe, it, expect } from 'vitest';
import { mergeDrug, canonicalJson } from '../scripts/ingest/merge.js';
import type { Drug, Trial, Indication } from '../src/schema/index.js';

function trial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 'select-compare',
    nctId: 'NCT02629159',
    protocolNumber: 'M13-545',
    title: 'A study',
    phase: 'PHASE3',
    roles: [],
    arms: [],
    primaryEndpoints: [],
    secondaryEndpoints: [],
    metPrimaryEndpoint: null,
    takeaways: [],
    limitations: [],
    publications: [],
    provenance: {},
    changeLog: [],
    ...overrides,
  };
}

function drug(trials: Trial[], summary = '', indications: Indication[] = []): Drug {
  return {
    slug: 'upadacitinib',
    brandName: 'Rinvoq',
    inn: 'upadacitinib',
    modality: 'Small molecule',
    sponsor: 'AbbVie Inc.',
    summary,
    indications,
    regulatory: { us: { applicationNumber: '211675', applicationType: 'NDA' } },
    trials,
    milestones: [],
    sources: [],
  };
}

describe('mergeDrug', () => {
  it('takes the incoming record wholesale when nothing exists yet', () => {
    const incoming = drug([trial()]);
    const result = mergeDrug(null, incoming);
    expect(result.drug).toEqual(incoming);
    expect(result.addedTrials).toEqual(['select-compare']);
  });

  it('never overwrites a human-verified field', () => {
    const existing = drug([
      trial({
        enrollment: { count: 1629, type: 'ACTUAL' },
        provenance: { enrollment: { extractedBy: 'human', verified: true } },
      }),
    ]);
    const incoming = drug([trial({ enrollment: { count: 9999, type: 'ACTUAL' } })]);

    const result = mergeDrug(existing, incoming);

    expect(result.drug.trials[0].enrollment?.count).toBe(1629);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ trialId: 'select-compare', field: 'enrollment' });
  });

  it('reports no conflict when a verified value agrees with the incoming one', () => {
    const value = { count: 1629, type: 'ACTUAL' } as const;
    const existing = drug([
      trial({ enrollment: value, provenance: { enrollment: { extractedBy: 'human', verified: true } } }),
    ]);
    const result = mergeDrug(existing, drug([trial({ enrollment: value })]));
    expect(result.conflicts).toHaveLength(0);
  });

  it('refreshes fields that are not verified', () => {
    const existing = drug([
      trial({
        phase: 'PHASE2',
        provenance: { phase: { extractedBy: 'seed', verified: false } },
      }),
    ]);
    const result = mergeDrug(existing, drug([trial({ phase: 'PHASE3' })]));
    expect(result.drug.trials[0].phase).toBe('PHASE3');
    expect(result.updatedTrials).toEqual(['select-compare']);
  });

  it('preserves human-authored narrative that ingestion never produces', () => {
    const existing = drug(
      [trial({ takeaways: ['Head-to-head against adalimumab.'], limitations: ['Open-label extension.'] })],
      'A hand-written development narrative.'
    );
    const result = mergeDrug(existing, drug([trial()]));
    expect(result.drug.trials[0].takeaways).toEqual(['Head-to-head against adalimumab.']);
    expect(result.drug.trials[0].limitations).toEqual(['Open-label extension.']);
    expect(result.drug.summary).toBe('A hand-written development narrative.');
  });

  it('keeps a curated trial the new run did not return', () => {
    // A registry query that misses a study must not silently delete curated work.
    const existing = drug([trial(), trial({ id: 'hand-added', nctId: undefined, protocolNumber: 'M99-001' })]);
    const result = mergeDrug(existing, drug([trial()]));
    expect(result.drug.trials.map((t) => t.id)).toContain('hand-added');
    expect(result.droppedTrials).toEqual(['hand-added']);
  });

  it('matches trials across runs by identifier, not array position', () => {
    const existing = drug([
      trial({ id: 'old-slug', provenance: { phase: { extractedBy: 'human', verified: true } }, phase: 'PHASE2' }),
    ]);
    // Same NCT ID, different local id — must be recognised as the same trial.
    const result = mergeDrug(existing, drug([trial({ id: 'new-slug', phase: 'PHASE3' })]));
    expect(result.drug.trials).toHaveLength(1);
    expect(result.drug.trials[0].phase).toBe('PHASE2');
  });

  it('preserves a hand-added press release URL across a re-run', () => {
    // The pipeline itself never produces this field — there's no public
    // registry of sponsor press releases — so a re-run must not silently
    // wipe out one a person found and added.
    const ra: Indication = { name: 'Rheumatoid Arthritis', slug: 'rheumatoid-arthritis' };
    const existing = drug([trial()], '', [
      { ...ra, pressReleaseUrl: 'https://www.abbvie.com/press/rinvoq-ra-approval' },
    ]);
    const result = mergeDrug(existing, drug([trial()], '', [ra]));
    expect(result.drug.indications[0].pressReleaseUrl).toBe(
      'https://www.abbvie.com/press/rinvoq-ra-approval'
    );
  });

  describe('changeLog', () => {
    it('records an entry when an unverified field actually changes', () => {
      const existing = drug([trial({ phase: 'PHASE2' })]);
      const now = new Date('2026-01-01T00:00:00.000Z');
      const result = mergeDrug(existing, drug([trial({ phase: 'PHASE3' })]), now);
      expect(result.drug.trials[0].changeLog).toEqual([
        { field: 'phase', previousValue: 'PHASE2', newValue: 'PHASE3', detectedAt: now.toISOString() },
      ]);
    });

    it('never records an entry purely from object key reordering', () => {
      // Regression: plain JSON.stringify is key-order-sensitive, so a
      // semantically identical `roles` provenance object built with its keys
      // in a different order than before used to register as "changed",
      // polluting the review queue with noise. Confirmed as a real bug via
      // the offline end-to-end idempotency test.
      const role = (keysReversed: boolean) => [
        {
          role: 'PIVOTAL' as const,
          indication: 'Rheumatoid Arthritis',
          provenance: keysReversed
            ? { verified: false, extractedBy: 'rule' as const, sourceUrl: 'https://x', quote: 'q' }
            : { sourceUrl: 'https://x', quote: 'q', extractedBy: 'rule' as const, verified: false },
        },
      ];
      const existing = drug([trial({ roles: role(false) })]);
      const result = mergeDrug(existing, drug([trial({ roles: role(true) })]));
      expect(result.drug.trials[0].changeLog).toEqual([]);
      expect(result.updatedTrials).toEqual([]);
    });

    it('does not record a changeLog entry for a verified field — that is a Conflict instead', () => {
      const existing = drug([
        trial({
          enrollment: { count: 1629, type: 'ACTUAL' },
          provenance: { enrollment: { extractedBy: 'human', verified: true } },
        }),
      ]);
      const result = mergeDrug(existing, drug([trial({ enrollment: { count: 9999, type: 'ACTUAL' } })]));
      expect(result.drug.trials[0].changeLog).toEqual([]);
    });

    it('replaces a prior unacknowledged entry for the same field rather than stacking it', () => {
      const withPendingChange = trial({
        phase: 'PHASE3',
        changeLog: [
          { field: 'phase', previousValue: 'PHASE1', newValue: 'PHASE2', detectedAt: '2025-01-01T00:00:00.000Z' },
        ],
      });
      const existing = drug([withPendingChange]);
      const now = new Date('2026-01-01T00:00:00.000Z');
      const result = mergeDrug(existing, drug([trial({ phase: 'PHASE4' })]), now);
      expect(result.drug.trials[0].changeLog).toEqual([
        { field: 'phase', previousValue: 'PHASE3', newValue: 'PHASE4', detectedAt: now.toISOString() },
      ]);
    });

    it('carries forward a pending entry for a field that did not change this run', () => {
      const existing = drug([
        trial({
          phase: 'PHASE3',
          changeLog: [
            { field: 'status', previousValue: 'RECRUITING', newValue: 'COMPLETED', detectedAt: '2025-01-01T00:00:00.000Z' },
          ],
        }),
      ]);
      const result = mergeDrug(existing, drug([trial({ phase: 'PHASE3' })]));
      expect(result.drug.trials[0].changeLog).toHaveLength(1);
      expect(result.drug.trials[0].changeLog[0].field).toBe('status');
    });

    it('gives a brand-new trial no changeLog — there is nothing to diff against', () => {
      const existing = drug([]);
      const result = mergeDrug(existing, drug([trial()]));
      expect(result.drug.trials[0].changeLog).toEqual([]);
    });
  });
});

describe('canonicalJson', () => {
  it('treats differently-ordered keys as equal', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('still distinguishes genuinely different values', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('sorts keys at every nesting level', () => {
    expect(canonicalJson({ z: { b: 1, a: 2 }, a: 1 })).toBe(
      canonicalJson({ a: 1, z: { a: 2, b: 1 } })
    );
  });
});
