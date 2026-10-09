import { describe, it, expect } from 'vitest';
import {
  trialStats,
  drugStats,
  reviewableFields,
  fieldValue,
  setFieldVerified,
  correctField,
  setRoleVerified,
  correctRole,
  replaceTrial,
  serializeDrug,
} from '../src/lib/review.js';
import type { Drug, Trial } from '../src/schema/index.js';

function trial(o: Partial<Trial> = {}): Trial {
  return {
    id: 't1',
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
    ...o,
  };
}

function drug(trials: Trial[]): Drug {
  return {
    slug: 'x',
    brandName: 'X',
    inn: 'x',
    modality: 'Small molecule',
    sponsor: 'Acme',
    summary: '',
    indications: [],
    regulatory: { us: { applicationNumber: '1', applicationType: 'NDA' } },
    trials,
    milestones: [],
    sources: [],
  };
}

describe('trialStats / drugStats', () => {
  it('counts both field provenance and role provenance', () => {
    const t = trial({
      provenance: {
        phase: { extractedBy: 'api', verified: true },
        sponsor: { extractedBy: 'api', verified: false },
      },
      roles: [
        { indication: 'RA', role: 'PIVOTAL', provenance: { extractedBy: 'rule', verified: false } },
      ],
    });
    expect(trialStats(t)).toEqual({ verified: 1, total: 3 });
  });

  it('sums across every trial in the drug', () => {
    const a = trial({
      id: 'a',
      provenance: { phase: { extractedBy: 'api', verified: true } },
    });
    const b = trial({
      id: 'b',
      provenance: { phase: { extractedBy: 'api', verified: false } },
    });
    expect(drugStats(drug([a, b]))).toEqual({ verified: 1, total: 2 });
  });

  it('is zero for a trial with no tracked provenance at all', () => {
    expect(trialStats(trial())).toEqual({ verified: 0, total: 0 });
  });
});

describe('reviewableFields / fieldValue', () => {
  it('lists exactly the fields the pipeline tracked provenance for', () => {
    const t = trial({
      sponsor: 'Acme',
      provenance: {
        sponsor: { extractedBy: 'api', verified: false },
        phase: { extractedBy: 'api', verified: false },
      },
    });
    expect(reviewableFields(t)).toEqual(['sponsor', 'phase']);
  });

  it('reads a field value generically by name', () => {
    const t = trial({ sponsor: 'Acme Inc.' });
    expect(fieldValue(t, 'sponsor')).toBe('Acme Inc.');
    expect(fieldValue(t, 'phase')).toBe('PHASE3');
  });
});

describe('setFieldVerified', () => {
  it('flips the flag without touching the value or extraction method', () => {
    const t = trial({
      sponsor: 'Acme',
      provenance: { sponsor: { extractedBy: 'api', verified: false, sourceUrl: 'https://x' } },
    });
    const result = setFieldVerified(t, 'sponsor', true);
    expect(result.sponsor).toBe('Acme');
    expect(result.provenance.sponsor).toEqual({
      extractedBy: 'api',
      verified: true,
      sourceUrl: 'https://x',
    });
  });

  it('is a no-op for a field with no tracked provenance', () => {
    const t = trial();
    expect(setFieldVerified(t, 'sponsor', true)).toBe(t);
  });
});

describe('correctField', () => {
  it('overwrites the value and marks it human-verified', () => {
    const t = trial({
      sponsor: 'Wrong Co',
      provenance: { sponsor: { extractedBy: 'api', verified: false } },
    });
    const result = correctField(t, 'sponsor', 'Right Co');
    expect(result.sponsor).toBe('Right Co');
    expect(result.provenance.sponsor).toEqual({ extractedBy: 'human', verified: true });
  });

  it('can introduce provenance for a field that had none', () => {
    const t = trial({ sponsor: 'Acme' });
    const result = correctField(t, 'sponsor', 'Acme Corp');
    expect(result.provenance.sponsor).toEqual({ extractedBy: 'human', verified: true });
  });
});

describe('setRoleVerified / correctRole', () => {
  const base = trial({
    roles: [{ indication: 'RA', role: 'PIVOTAL', provenance: { extractedBy: 'rule', verified: false } }],
  });

  it('flips one role verified flag by index, leaving the role untouched', () => {
    const result = setRoleVerified(base, 0, true);
    expect(result.roles[0].role).toBe('PIVOTAL');
    expect(result.roles[0].provenance.verified).toBe(true);
  });

  it('corrects a role and marks it human-verified', () => {
    const result = correctRole(base, 0, { indication: 'RA', role: 'SUPPORTIVE' });
    expect(result.roles[0].role).toBe('SUPPORTIVE');
    expect(result.roles[0].provenance).toMatchObject({ extractedBy: 'human', verified: true });
  });

  it('does not affect other roles on the same trial', () => {
    const t = trial({
      roles: [
        { indication: 'RA', role: 'PIVOTAL', provenance: { extractedBy: 'rule', verified: false } },
        { indication: 'PsA', role: 'SUPPORTIVE', provenance: { extractedBy: 'rule', verified: false } },
      ],
    });
    const result = setRoleVerified(t, 0, true);
    expect(result.roles[1].provenance.verified).toBe(false);
  });
});

describe('replaceTrial', () => {
  it('swaps the matching trial in by id and leaves the rest untouched', () => {
    const a = trial({ id: 'a', sponsor: 'Old' });
    const b = trial({ id: 'b' });
    const updated = { ...a, sponsor: 'New' };
    const result = replaceTrial(drug([a, b]), 'a', updated);
    expect(result.trials[0].sponsor).toBe('New');
    expect(result.trials[1]).toBe(b);
  });
});

describe('serializeDrug', () => {
  it('matches the pipeline\'s own formatting — two-space indent, trailing newline', () => {
    const d = drug([]);
    const serialized = serializeDrug(d);
    expect(serialized).toBe(JSON.stringify(d, null, 2) + '\n');
    expect(serialized.endsWith('\n')).toBe(true);
  });
});
