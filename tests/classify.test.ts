import { describe, it, expect } from 'vitest';
import { classifyDrug } from '../scripts/ingest/classify.js';

const base = {
  slug: 'x',
  lastIngestedAt: '2026-10-01',
  indications: [{ name: 'Rheumatoid Arthritis', approvalDate: { value: '2019-08-16' } }],
  trials: [{ id: 't1', status: 'RECRUITING', roles: [{ role: 'PIVOTAL' }] }],
  milestones: [],
};

describe('weekly refresh: what is routine', () => {
  it('publishes registry updates and newly read document facts by itself', () => {
    const after = {
      ...base,
      lastIngestedAt: '2026-10-29',
      trials: [{ id: 't1', status: 'COMPLETED', roles: [{ role: 'PIVOTAL' }] }],
      regulatory: { us: { reviewOffice: { name: 'Office of Neuroscience' } } },
    };
    expect(classifyDrug(base, after).review).toEqual([]);
  });

  it('holds back a changed approved use, a changed trial role, or a new trial', () => {
    const changedUse = { ...base, indications: [{ name: 'Rheumatoid Arthritis', approvalDate: { value: '2019-08-17' } }] };
    expect(classifyDrug(base, changedUse).review).toEqual(['indications']);
    const changedRole = { ...base, trials: [{ id: 't1', status: 'RECRUITING', roles: [{ role: 'SUPPORTIVE' }] }] };
    expect(classifyDrug(base, changedRole).review).toEqual(['trial t1: roles']);
    const added = { ...base, trials: [...base.trials, { id: 't2', roles: [] }] };
    expect(classifyDrug(base, added).review).toEqual(['trial added: t2']);
  });
});
