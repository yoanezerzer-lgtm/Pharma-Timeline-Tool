import { describe, it, expect } from 'vitest';
import { reviewPackageLinks, reviewPdfsOnToc, submissionOf } from '../scripts/ingest/reviews.js';

const PAGE = 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=125514';

describe('reviews from the Drugs@FDA page', () => {
  it('reads the submission from the file name', () => {
    expect(submissionOf('125514Orig1s040TOC.cfm', '125514')).toBe('SUPPL-40');
    expect(submissionOf('125514Orig1s000SumR.pdf', '125514')).toBe('ORIG-1');
    expect(submissionOf('761105Orig1s014.pdf', '125514')).toBeUndefined();
  });

  it('collects review packages, absolute or relative, once each', () => {
    const html = `
      <td><a href="https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/125514Orig1s040TOC.cfm" title="Review">Review</a></td>
      <td><a href="/drugsatfda_docs/nda/2016/125514Orig1s009.pdf">Review</a></td>
      <td><a href="/drugsatfda_docs/nda/2016/125514Orig1s009.pdf">Review</a></td>
      <td><a href="https://www.accessdata.fda.gov/drugsatfda_docs/nda/2014/125514Orig1s000TOC.html">Review</a></td>
      <td><a href="/drugsatfda_docs/appletter/2019/125514Orig1s040ltr.pdf">Letter</a></td>
      <td><a href="/drugsatfda_docs/label/2019/125514s040lbl.pdf">Label</a></td>`;
    expect(reviewPackageLinks(html, '125514', PAGE)).toEqual([
      { url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/125514Orig1s040TOC.cfm', submission: 'SUPPL-40' },
      { url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2016/125514Orig1s009.pdf', submission: 'SUPPL-9' },
      { url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2014/125514Orig1s000TOC.html', submission: 'ORIG-1' },
    ]);
  });

  it('keeps only the clinical reviews on a table-of-contents page', () => {
    const toc = 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/125514Orig1s040TOC.cfm';
    const html = `
      <a href="125514Orig1s040MultidisciplineR.pdf">Multidiscipline Review</a>
      <a href="125514Orig1s040SumR.pdf">Summary Review</a>
      <a href="125514Orig1s040Ltr.pdf">Approval Letter</a>
      <a href="125514Orig1s040Lbl.pdf">Label</a>
      <a href="125514Orig1s040ChemR.pdf">Chemistry Review</a>
      <a href="125514Orig1s040AdminCorres.pdf">Correspondence</a>`;
    expect(reviewPdfsOnToc(html, toc)).toEqual([
      'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/125514Orig1s040MultidisciplineR.pdf',
      'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/125514Orig1s040SumR.pdf',
    ]);
  });
});
