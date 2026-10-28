import { describe, it, expect } from 'vitest';
import type { Trial } from '../src/schema/index.js';
import { namePatterns, pickReadout, type Release } from '../scripts/readouts/select.js';
import { extractPublishedDate, htmlToText } from '../scripts/readouts/sources.js';

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}

const psa1 = trial({ acronym: 'SELECT-PsA 1', labelName: 'PsA-I', nctId: 'NCT03104400', primaryCompletionDate: { value: '2019-09-26', precision: 'day' } });

function release(date: string, text: string, title = 'News'): Release {
  return { url: `https://www.prnewswire.com/news-releases/${date}.html`, source: 'PR Newswire', date, title, text };
}

describe('namePatterns', () => {
  it('matches the trial name however a release spaces or hyphenates it', () => {
    const [p] = namePatterns(psa1);
    for (const s of ['SELECT-PsA 1', 'SELECT PsA 1', 'SELECT-PsA-1', 'select-psa 1']) expect(p.test(s)).toBe(true);
  });

  it('does not match a longer trial number', () => {
    const [p] = namePatterns(trial({ acronym: 'KEYNOTE-01' }));
    expect(p.test('KEYNOTE-012')).toBe(false);
    expect(p.test('KEYNOTE-01 met its endpoint')).toBe(true);
  });

  it('ignores names too short to search for safely', () => {
    expect(namePatterns(trial({ labelName: 'RA-I' }))).toEqual([]);
  });
});

describe('pickReadout', () => {
  it('takes the earliest release reporting the primary result, with its sentence as the quote', () => {
    const r = pickReadout(
      psa1,
      [
        release('2020-11-07', 'Long-term data from SELECT-PsA 1 were presented at ACR Convergence. Results from SELECT-PsA 1 showed durable responses.'),
        release('2019-10-22', 'NORTH CHICAGO. AbbVie today announced positive top-line results from SELECT-PsA 1, a Phase 3 study in psoriatic arthritis. The study met its primary endpoint.'),
      ],
      { approvalDate: '2021-12-14' }
    );
    expect(r?.date).toEqual({ value: '2019-10-22', precision: 'day' });
    expect(r?.provenance).toMatchObject({ extractedBy: 'regex', verified: false, sourceUrl: 'https://www.prnewswire.com/news-releases/2019-10-22.html' });
    expect(r?.provenance.quote).toContain('positive top-line results from SELECT-PsA 1');
  });

  it('quotes a bullet line, not the menu text before it (a real PR Newswire page)', () => {
    const page = htmlToText(
      '<nav><a>News Releases</a> <a>Send a Release</a> <a>Client Login</a></nav>' +
        '<h1>Upadacitinib Meets All Primary and Ranked Secondary Endpoints</h1>' +
        '<ul><li>In SELECT-PsA 1, upadacitinib met both primary endpoints, with 71 percent of patients achieving ACR20 at week 12 (1)</li><li>All ranked secondary endpoints were also achieved</li></ul>'
    );
    const r = pickReadout(psa1, [release('2019-10-22', page)], {});
    expect(r?.provenance.quote).toBe('In SELECT-PsA 1, upadacitinib met both primary endpoints, with 71 percent of patients achieving ACR20 at week 12 (1)');
  });

  it('ignores announcements about starting or enrolling the trial', () => {
    const r = pickReadout(psa1, [release('2019-09-30', 'AbbVie completed enrollment in SELECT-PsA 1 and expects results from the study next year.')], {});
    expect(r).toBeUndefined();
  });

  it('ignores releases before primary completion or after approval', () => {
    const text = 'SELECT-PsA 1 met its primary endpoint.';
    expect(pickReadout(psa1, [release('2019-06-01', text)], { approvalDate: '2021-12-14' })).toBeUndefined();
    expect(pickReadout(psa1, [release('2022-03-01', text)], { approvalDate: '2021-12-14' })).toBeUndefined();
    expect(pickReadout(psa1, [release('2019-09-10', text)], { approvalDate: '2021-12-14' })?.date.value).toBe('2019-09-10');
  });

  it('finds a trial named only by its NCT number', () => {
    const r = pickReadout(psa1, [release('2019-11-01', 'The Phase 3 study (NCT03104400) achieved its primary endpoint of ACR20 at week 12.')], {});
    expect(r?.date.value).toBe('2019-11-01');
  });

  it('finds nothing for a trial without a primary completion date', () => {
    expect(pickReadout(trial({ acronym: 'SELECT-PsA 1' }), [release('2019-10-22', 'SELECT-PsA 1 met its primary endpoint.')], {})).toBeUndefined();
  });
});

describe('release pages', () => {
  it('reads the publication date from the page metadata', () => {
    expect(extractPublishedDate('<meta property="article:published_time" content="2019-10-22T08:00:00-04:00">')).toBe('2019-10-22');
    expect(extractPublishedDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2020-06-15T12:00:00Z"}</script>')).toBe('2020-06-15');
    expect(extractPublishedDate('<p>no date here</p>')).toBeUndefined();
  });

  it('turns HTML into readable text without scripts or styles', () => {
    expect(htmlToText('<html><head><style>p{}</style><script>var a=1</script></head><body><p>SELECT-PsA&nbsp;1 met&amp;passed</p><p>Next  <b>line</b></p></body></html>')).toBe('SELECT-PsA 1 met&passed\nNext line');
  });
});
