import { describe, expect, it } from 'vitest';
import {
  acceleratedFromLetter,
  letterIsFor,
  median,
  MIN_SAMPLE,
  parseLetterDate,
  percent,
  receiptFromLetter,
  reviewDays,
  reviewStats,
  type PrecedentProduct,
} from '../src/lib/reviewTime.js';

const src = { url: 'https://api.fda.gov/drug/drugsfda.json?search=application_number:BLA761180', label: 'openFDA' };
const day = (value: string) => ({ value: { value, precision: 'day' as const }, source: src });

function product(name: string, received?: string, approved?: string, extra: Partial<PrecedentProduct> = {}): PrecedentProduct {
  return {
    brandName: name,
    application: 'BLA 761180',
    applicationType: 'BLA',
    submission: 'ORIG-1',
    severity: 'moderate-to-severe',
    receiptDate: received ? day(received) : undefined,
    approvalDate: approved ? day(approved) : undefined,
    ...extra,
  };
}

describe('receipt date from an approval letter', () => {
  it('reads "dated and received"', () => {
    const text =
      'Dear Dr. Suarez: Please refer to your biologics license application (BLA) dated and received April 27, 2020, and your amendments, submitted under section 351(a)';
    const r = receiptFromLetter(text)!;
    expect(r.date).toEqual({ value: '2020-04-27', precision: 'day' });
    expect(text).toContain(r.quote);
  });

  it('reads "dated X, received Y" and takes the received date', () => {
    const text = 'Please refer to your new drug application (NDA) dated December 17, 2018, received December 18, 2018, and your amendments';
    expect(receiptFromLetter(text)!.date.value).toBe('2018-12-18');
  });

  it('reads across page markers and line breaks', () => {
    const text = 'Please refer to your supplemental biologics license application (sBLA) dated\n<<<PAGE 1>>>\nand received October 15,\n2020, submitted';
    expect(receiptFromLetter(text)!.date.value).toBe('2020-10-15');
  });

  it('leaves a gap for an OCR-garbled month', () => {
    expect(receiptFromLetter('Please refer to your Biologics License Application (BLA) dated Febmmy 27 , 2014, received Febmmy 27 , 2014')).toBeUndefined();
  });

  it('ignores "received" outside the opening sentence', () => {
    const text = 'Please refer to your application. The MedWatch program provides copies of reports received directly by the FDA on May 1, 2020.';
    expect(receiptFromLetter(text)).toBeUndefined();
  });

  it('reads "received" with no "dated", and "received on"', () => {
    expect(receiptFromLetter('Please refer to your biologics license application (BLA) received June 14, 2024, and your amendments, submitted under section 351(a)')!.date.value).toBe('2024-06-14');
    expect(receiptFromLetter('Please refer to your supplemental new drug application (sNDA) dated and received on August 18, 2022, and your amendments')!.date.value).toBe('2022-08-18');
    expect(receiptFromLetter('Please refer to your supplemental biologics license application (sBLA), dated May 28, 2020, received, May 28, 2020, and your amendments')!.date.value).toBe('2020-05-28');
  });

  it('leaves a gap when one letter covers several submissions with their own dates', () => {
    expect(
      receiptFromLetter('Please refer to your supplemental biologics license applications (sBLAs) S-021, dated and received February 19, 2020, S-027, dated and received June 9, 2020, and your amendments'),
    ).toBeUndefined();
    expect(
      receiptFromLetter('Please refer to your supplemental biologics license applications (sBLAs), submitted and received on April 18, 2019 (S-59), April 23, 2019 (S-60 through S-64), September 23, 2019 (S-69)'),
    ).toBeUndefined();
  });

  it('does not take the application’s own date for the receipt date', () => {
    expect(receiptFromLetter('Please refer to your supplemental biologics license application (sBLA), dated July 8, 2019, and your amendments, submitted under section 351(a)')).toBeUndefined();
    expect(receiptFromLetter('Please refer to your November 9, 2020, supplemental biologics license application (sBLA), submitted under section 351(a)')).toBeUndefined();
  });

  it('rejects impossible dates', () => {
    expect(parseLetterDate('February 30, 2020')).toBeUndefined();
    expect(parseLetterDate('March 9 , 2021')).toEqual({ value: '2021-03-09', precision: 'day' });
  });
});

describe('accelerated approval from a letter', () => {
  it('finds the rule cited, with the letter’s words', () => {
    const r = acceleratedFromLetter('This application is approved under the provisions of accelerated approval regulations (21 CFR 601.41).');
    expect(r.value).toBe(true);
    expect(r.quote).toContain('601.41');
  });
  it('is false when the letter says nothing of it', () => {
    expect(acceleratedFromLetter('It is approved, effective on the date of this letter.').value).toBe(false);
  });
});

describe('review days', () => {
  it('counts days from receipt to approval', () => {
    expect(reviewDays(product('Adbry', '2020-04-27', '2021-12-27'))).toBe(609);
  });
  it('needs both dates to the day', () => {
    expect(reviewDays(product('X', undefined, '2021-12-27'))).toBeUndefined();
    expect(reviewDays({ receiptDate: { value: { value: '2020-04-01', precision: 'month' }, source: src }, approvalDate: day('2021-01-01') })).toBeUndefined();
  });
  it('refuses a receipt after the approval', () => {
    expect(reviewDays(product('X', '2022-01-02', '2022-01-01'))).toBeUndefined();
  });
});

describe('median and the minimum-sample rule', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3); // (2 + 3) / 2 rounded
    expect(median([])).toBeUndefined();
  });

  it('computes no median from fewer than five products with both dates', () => {
    const rows = [
      product('A', '2020-01-01', '2020-11-01'),
      product('B', '2020-01-01', '2021-01-01'),
      product('C', undefined, '2021-01-01'),
      product('D', '2020-01-01'),
    ];
    const s = reviewStats(rows);
    expect(MIN_SAMPLE).toBe(5);
    expect(s.median).toBeUndefined();
    expect(s.days).toEqual([
      { brandName: 'A', days: 305 },
      { brandName: 'B', days: 366 },
    ]);
    expect(s.total).toBe(4);
  });

  it('computes the median from exactly five', () => {
    const rows = [
      product('Protopic', '1999-09-09', '2000-12-08'),
      product('Adbry', '2020-04-27', '2021-12-27'),
      product('Cibinqo', '2020-08-25', '2022-01-14'),
      product('Rinvoq', '2020-10-15', '2022-01-14'),
      product('Ebglyss', '2022-09-28', '2024-09-13'),
      product('Dupixent', undefined, '2017-03-28'),
    ];
    const s = reviewStats(rows);
    expect(s.days.map((d) => d.days)).toEqual([456, 609, 507, 456, 716]);
    expect(s.median).toBe(507);
  });

  it('counts accelerated over letters read, expedited over all', () => {
    const letter = { url: 'https://example.org/ltr.pdf', label: 'letter' };
    const rows = [
      product('A', undefined, undefined, { accelerated: { value: true, source: letter } }),
      product('B', undefined, undefined, { accelerated: { value: false, source: letter }, orphan: { value: true, source: src } }),
      product('C'),
      product('D', undefined, undefined, { accelerated: { value: false, source: letter } }),
    ];
    const s = reviewStats(rows);
    expect(s.accelerated).toEqual({ yes: 1, known: 3 });
    expect(s.expedited).toEqual({ yes: 2, total: 4 });
    expect(percent(1, 3)).toBe('33%');
    expect(percent(0, 0)).toBeUndefined();
  });
});

describe('which submission a letter is for', () => {
  const base = 'https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2025/';
  it('matches the original and supplements by file name', () => {
    expect(letterIsFor(`${base}761391Orig1s000ltr.pdf`, 'ORIG-1')).toBe(true);
    expect(letterIsFor(`${base}761055Orig1s012ltr.pdf`, 'SUPPL-12')).toBe(true);
    expect(letterIsFor(`${base}761055Orig1s015,s017ltr.pdf`, 'SUPPL-17')).toBe(true);
  });
  it('rejects a later supplement letter listed under the original', () => {
    expect(letterIsFor(`${base}761391Orig1s001,761390Orig1s002ltr.pdf`, 'ORIG-1')).toBe(false);
  });
  it('accepts a name with no supplement number', () => {
    expect(letterIsFor(`${base}21-302_ELIDEL_Approv.pdf`, 'ORIG-1')).toBe(true);
  });
});
