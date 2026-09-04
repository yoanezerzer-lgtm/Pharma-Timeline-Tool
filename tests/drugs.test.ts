import { describe, it, expect } from 'vitest';
import { isMeaningfulMilestone } from '../src/lib/drugs.js';
import type { Milestone } from '../src/schema/index.js';

function milestone(o: Partial<Milestone>): Milestone {
  return {
    id: 'm', type: 'FDA_SUPPLEMENT', region: 'US',
    date: { value: '2020-01-01', precision: 'day' }, label: 'x', ...o,
  };
}

describe('isMeaningfulMilestone', () => {
  it('always keeps the original approval', () => {
    expect(isMeaningfulMilestone(milestone({ type: 'FDA_APPROVAL' }))).toBe(true);
  });

  it('keeps a supplement that added a new indication', () => {
    expect(isMeaningfulMilestone(milestone({ description: 'Efficacy-New Indication' }))).toBe(true);
  });

  it('drops a routine administrative supplement', () => {
    expect(isMeaningfulMilestone(milestone({ description: 'Labeling' }))).toBe(false);
    expect(isMeaningfulMilestone(milestone({ description: 'Manufacturing (CMC)' }))).toBe(false);
  });

  it('drops an Efficacy supplement that is not a new indication', () => {
    // Confirmed against the real Drugs@FDA "Supplements" table: most
    // "Efficacy"-classified supplements update an *existing* indication's
    // label with new trial data or extend it to a new patient population —
    // neither is a new approved use.
    expect(isMeaningfulMilestone(milestone({ description: 'Efficacy-New Patient Population' }))).toBe(
      false
    );
    expect(
      isMeaningfulMilestone(milestone({ description: 'Efficacy-Labeling Change With Clinical Data' }))
    ).toBe(false);
  });

  it('keeps a supplement with no classification rather than guessing it is noise', () => {
    expect(isMeaningfulMilestone(milestone({ description: undefined }))).toBe(true);
  });
});
