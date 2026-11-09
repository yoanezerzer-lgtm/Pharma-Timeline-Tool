import { describe, expect, it } from 'vitest';
import { monthsAfter, trialsFor } from '../src/lib/precedent.js';
import type { PivotalTrial, UseStep } from '../src/lib/diseases.js';

const d = (value: string) => ({ value, precision: 'day' as const });
const step = (date: string, kind: UseStep['kind']): UseStep => ({ date: d(date), kind, submissions: [], text: '' });
const trials: PivotalTrial[] = [
  { id: 'a', name: 'SOLO 1', primaryCompletion: d('2016-03-01') },
  { id: 'b', name: 'AD-1526', primaryCompletion: d('2018-05-01') },
  { id: 'c', name: 'Undated' },
];

describe('trialsFor', () => {
  it('gives a single-approval use all its pivotal trials', () => {
    expect(trialsFor([step('2017-03-28', 'new')], 0, trials)).toHaveLength(3);
  });
  it('gives the first of several approvals only the trials finished before it', () => {
    const steps = [step('2017-03-28', 'new'), step('2019-03-11', 'expansion')];
    expect(trialsFor(steps, 0, trials)?.map((t) => t.name)).toEqual(['SOLO 1']);
  });
  it('leaves later approvals unmatched rather than guessing from dates', () => {
    const steps = [step('2017-03-28', 'new'), step('2019-03-11', 'expansion')];
    expect(trialsFor(steps, 1, trials)).toBeUndefined();
  });
});

describe('monthsAfter', () => {
  it('counts whole months from the last primary completion to approval', () => {
    expect(monthsAfter(trials, d('2018-09-14'))).toBe(4);
  });
  it('is undefined without a dated trial or approval', () => {
    expect(monthsAfter([trials[2]], d('2018-09-14'))).toBeUndefined();
    expect(monthsAfter(trials, undefined)).toBeUndefined();
  });
});
