import { describe, it, expect } from 'vitest';
import { isMeaningfulMilestone, readoutToApprovalMonths } from '../src/lib/drugs.js';
import type { Milestone, Trial, DateValue } from '../src/schema/index.js';

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

describe('readoutToApprovalMonths', () => {
  const day = (value: string): DateValue => ({ value, precision: 'day' });
  const trial = (role: 'PIVOTAL' | 'SUPPORTIVE', completion?: DateValue): Trial =>
    ({
      roles: [{ indication: 'RA', role, provenance: { extractedBy: 'rule', verified: false } }],
      primaryCompletionDate: completion,
    }) as Trial;

  it('measures from the latest pivotal readout before approval', () => {
    const trials = [trial('PIVOTAL', day('2017-10-27')), trial('PIVOTAL', day('2018-01-15')), trial('SUPPORTIVE', day('2019-01-01'))];
    expect(readoutToApprovalMonths(trials, 'RA', day('2019-08-16'))).toBe(19);
  });

  it('ignores a pivotal trial still running after approval', () => {
    const trials = [trial('PIVOTAL', day('2018-02-01')), trial('PIVOTAL', day('2027-06-01'))];
    expect(readoutToApprovalMonths(trials, 'RA', day('2019-08-16'))).toBe(18);
  });

  it('is undefined without a dated approval or any usable readout', () => {
    expect(readoutToApprovalMonths([trial('PIVOTAL', day('2018-01-01'))], 'RA', undefined)).toBeUndefined();
    expect(readoutToApprovalMonths([trial('PIVOTAL', { value: '2018-01-01', precision: 'year' })], 'RA', day('2019-08-16'))).toBeUndefined();
    expect(readoutToApprovalMonths([trial('SUPPORTIVE', day('2018-01-01'))], 'RA', day('2019-08-16'))).toBeUndefined();
  });
});
