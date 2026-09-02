import { describe, it, expect } from 'vitest';
import { toDateValue, toTime, toEndTime, formatDate, isApproximate } from '../src/lib/dates.js';

describe('toDateValue', () => {
  it('keeps day precision when the source gives a full date', () => {
    expect(toDateValue('2019-08-16')).toEqual({ value: '2019-08-16', precision: 'day' });
  });

  it('pads a month-only date and records the coarser precision', () => {
    expect(toDateValue('2016-03')).toEqual({ value: '2016-03-01', precision: 'month' });
  });

  it('pads a year-only date', () => {
    expect(toDateValue('2016')).toEqual({ value: '2016-01-01', precision: 'year' });
  });

  it('returns undefined for missing or unparseable input', () => {
    expect(toDateValue(undefined)).toBeUndefined();
    expect(toDateValue('')).toBeUndefined();
    expect(toDateValue('March 2016')).toBeUndefined();
  });
});

describe('toEndTime', () => {
  it('extends a year-precision date to the end of that year', () => {
    // "2016" means somewhere in 2016, so a bar ending there covers the year.
    expect(toEndTime({ value: '2016-01-01', precision: 'year' })).toBe(Date.UTC(2017, 0, 1));
  });

  it('extends a month-precision date to the end of that month', () => {
    expect(toEndTime({ value: '2016-03-01', precision: 'month' })).toBe(Date.UTC(2016, 3, 1));
  });

  it('extends a day-precision date by exactly one day', () => {
    const d = { value: '2016-03-15', precision: 'day' } as const;
    expect(toEndTime(d) - toTime(d)).toBe(86_400_000);
  });
});

describe('formatDate', () => {
  it('never displays more precision than the source gave', () => {
    expect(formatDate({ value: '2016-01-01', precision: 'year' })).toBe('2016');
    expect(formatDate({ value: '2016-03-01', precision: 'month' })).toBe('Mar 2016');
    expect(formatDate({ value: '2019-08-16', precision: 'day' })).toBe('16 Aug 2019');
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('isApproximate', () => {
  it('flags anything coarser than a day so the chart can soften the edge', () => {
    expect(isApproximate({ value: '2016-03-01', precision: 'month' })).toBe(true);
    expect(isApproximate({ value: '2019-08-16', precision: 'day' })).toBe(false);
  });
});
