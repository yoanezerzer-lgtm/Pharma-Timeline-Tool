import { describe, it, expect } from 'vitest';
import { sameWording } from '../src/lib/wording.js';
import { scoreAgainstReference, snapshotReference, type Reference } from '../scripts/qc/reference.js';
import type { Drug } from '../src/schema/index.js';

describe('sameWording', () => {
  it('matches wording the PDF reader once split', () => {
    expect(sameWording('adults with out cirrhosis', 'adults without cirrhosis')).toBe(true);
    expect(sameWording('To reduc e formation', 'To reduce formation')).toBe(true);
    expect(sameWording('(HER2) - negative', '(HER2)-negative')).toBe(true);
  });

  it('still tells different wording apart', () => {
    expect(sameWording('adults with cirrhosis', 'adults without cirrhosis')).toBe(false);
    expect(sameWording('HER2-negative', 'HER2-positive')).toBe(false);
  });
});

describe('reference facts confirmed under split wording', () => {
  const oldName = 'Chronic HDV infection in adults with out cirrhosis';
  const newName = 'Chronic HDV infection in adults without cirrhosis';
  const drug = {
    slug: 'x',
    indications: [{ name: newName }],
    trials: [{ id: 'MYR301', nctId: 'NCT03852719', roles: [{ indication: newName, role: 'PIVOTAL' }] }],
  } as unknown as Drug;
  const ref: Reference = {
    slug: 'x',
    indications: [],
    pivotal: [{ indication: oldName, trial: 'NCT03852719', pivotal: true, status: 'confirmed' }],
  } as Reference;

  it('still pass once the wording is read correctly', () => {
    const [r] = scoreAgainstReference(drug, ref);
    expect(r.pass).toBe(true);
  });

  it('are not duplicated as a new baseline fact', () => {
    const snap = snapshotReference(drug, ref);
    expect(snap.pivotal).toHaveLength(1);
    expect(snap.pivotal[0].status).toBe('confirmed');
  });
});
