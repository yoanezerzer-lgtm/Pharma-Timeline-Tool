import { describe, expect, it } from 'vitest';
import { trialShortName } from '../src/lib/drugs.js';
import { parsePath } from '../src/lib/router.js';

describe('trialShortName', () => {
  const a = { id: 'adhere', acronym: 'ADhere', nctId: 'NCT04250337' };
  const b = { id: '17801', labelName: 'ADhere', nctId: 'NCT04146363' };
  const c = { id: 'adore', acronym: 'ADore', nctId: 'NCT04250350' };

  it('adds the NCT number when two trials of a drug share a name', () => {
    expect(trialShortName(a, [a, b, c])).toBe('ADhere (NCT04250337)');
    expect(trialShortName(b, [a, b, c])).toBe('ADhere (NCT04146363)');
  });

  it('leaves a unique name alone', () => {
    expect(trialShortName(c, [a, b, c])).toBe('ADore');
    expect(trialShortName(a)).toBe('ADhere');
  });
});

describe('parsePath', () => {
  it('opens the home page and the Drugs page at their own addresses', () => {
    expect(parsePath('')).toEqual({ name: 'index' });
    expect(parsePath('drugs/')).toEqual({ name: 'drugs' });
  });

  it('keeps trial addresses on the approved-use page', () => {
    expect(parsePath('drug/x/indication/y/trial/z/')).toEqual({ name: 'indication', slug: 'x', indicationSlug: 'y', trialId: 'z' });
  });
});
