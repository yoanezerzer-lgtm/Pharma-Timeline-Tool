import { describe, expect, it } from 'vitest';
import { letterSource, mergeSources, productSources } from '../src/lib/citations.js';
import type { PrecedentProduct } from '../src/lib/reviewTime.js';

const url = 'https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2021/761180Orig1s000ltr.pdf';

describe('citation sources', () => {
  it('a letter cited twice is one source with both excerpts and all fields', () => {
    const a = letterSource({ brandName: 'Adbry', application: 'BLA 761180' }, { date: { value: '2021-12-27', precision: 'day' }, submissions: ['ORIG-1'], kind: 'new', text: 'moderate-to-severe atopic dermatitis', sourceUrl: url })!;
    const p: PrecedentProduct = {
      brandName: 'Adbry', application: 'BLA 761180', applicationType: 'BLA', submission: 'ORIG-1', severity: 'moderate-to-severe',
      receiptDate: { value: { value: '2020-04-27', precision: 'day' }, source: { url, label: 'letter', quote: 'dated and received April 27, 2020' } },
    };
    const b = productSources(p).letter!;
    expect(b.id).toBe(a.id);
    const m = mergeSources(a, b);
    expect(m.excerpt).toBe('moderate-to-severe atopic dermatitis\n\n“dated and received April 27, 2020”');
    expect(m.fields!.map(([k]) => k)).toEqual(['Approval type', 'Application', 'Submission', 'Received', 'Accelerated approval']);
    expect(mergeSources(m, b)).toEqual(m);
  });

  it('cites no letter for a step without one', () => {
    expect(letterSource({ brandName: 'X', application: 'NDA 1' }, { submissions: [], kind: 'new', text: 'x' })).toBeUndefined();
  });
});
