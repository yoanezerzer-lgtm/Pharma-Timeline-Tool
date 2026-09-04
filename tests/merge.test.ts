import { describe, it, expect } from 'vitest';
import { mergeDrug } from '../scripts/ingest/merge.js';
import type { Drug, Trial } from '../src/schema/index.js';

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
    ...overrides,
  };
}

function drug(trials: Trial[], summary = ''): Drug {
  return {
    slug: 'upadacitinib',
    brandName: 'Rinvoq',
    inn: 'upadacitinib',
    modality: 'Small molecule',
    sponsor: 'AbbVie Inc.',
    summary,
    indications: [],
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
});
