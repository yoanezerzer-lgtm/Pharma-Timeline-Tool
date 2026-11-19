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

  it('does not match a numbered sister trial or a longer word', () => {
    const [p] = namePatterns(trial({ acronym: 'MARIPOSA' }));
    for (const s of ['MARIPOSA-2', 'MARIPOSA -2', 'MARIPOSAS']) expect(p.test(s)).toBe(false);
    expect(p.test('the Phase 3 MARIPOSA ( NCT04487080 ) study')).toBe(true);
  });

  it('matches a one-word capitals acronym only in capitals', () => {
    const [p] = namePatterns(trial({ acronym: 'VENTURE' }));
    expect(p.test('Joint Ventures')).toBe(false);
    expect(p.test('Venture Capital')).toBe(false);
    expect(p.test('In VENTURE, dupilumab reduced')).toBe(true);
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
    expect(r?.provenance.quote).toBe('The study met its primary endpoint.');
  });

  it('quotes a bullet line, not the menu text before it (a real PR Newswire page)', () => {
    const page = htmlToText(
      '<nav><a>News Releases</a> <a>Send a Release</a> <a>Client Login</a></nav>' +
        '<h1>Upadacitinib Meets All Primary and Ranked Secondary Endpoints</h1>' +
        '<ul><li>- In SELECT-PsA 1, upadacitinib met both primary endpoints, with 71 percent of patients achieving ACR20 at week 12 (1)</li><li>All ranked secondary endpoints were also achieved</li></ul>'
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

// Excerpts of real releases, as read by the workflow (diag/readouts-<slug> branches).
describe('pickReadout on real releases', () => {
  const day = (value: string) => ({ value, precision: 'day' as const });

  it('takes the result sentence after the one naming the trial, not the title (Cibinqo, JADE TEEN)', () => {
    const teen = trial({ acronym: 'JADE TEEN', nctId: 'NCT03796676', primaryCompletionDate: day('2020-04-08') });
    const text = [
      'Pfizer Announces Positive Top-Line Results from JADE TEEN Trial of Abrocitinib in Adolescents with Moderate-to-Severe Atopic Dermatitis',
      'NEW YORK--(BUSINESS WIRE)-- Pfizer Inc. (NYSE: PFE) announced today positive top-line results from the Phase 3 JADE TEEN study of abrocitinib, an investigational oral once-daily Janus kinase 1 (JAK1) inhibitor, in patients 12 to <18 years of age with moderate to severe atopic dermatitis (AD) who were also on background topical therapy. Both doses of abrocitinib met the co-primary endpoints and were generally well tolerated.',
    ].join('\n');
    const r = pickReadout(teen, [release('2020-06-10', text, 'Pfizer Announces Positive Top-Line Results from JADE TEEN Trial')], {});
    expect(r?.provenance.quote).toBe('Both doses of abrocitinib met the co-primary endpoints and were generally well tolerated.');
  });

  const mono1 = trial({ acronym: 'JADE Mono-1', nctId: 'NCT03349060', primaryCompletionDate: day('2019-03-26') });
  const mono2 = trial({ acronym: 'JADE Mono-2', nctId: 'NCT03575871', primaryCompletionDate: day('2019-08-13') });
  const mono2Text = [
    'NEW YORK--( BUSINESS WIRE )--Pfizer Inc. (NYSE: PFE) announced today positive top-line results from a second Phase 3 pivotal study. This is the second monotherapy trial in the JAK1 Atopic Dermatitis Efficacy and Safety (JADE) global development program (B7451013, or JADE MONO-2). Pfizer announced positive top-line results from the first trial in the JADE program (B7451012, or JADE MONO-1) on May 15, 2019 .',
    'JADE MONO-2 was a randomized, double-blind, placebo-controlled, parallel-group study designed to evaluate the efficacy and safety of two doses (100mg and 200mg once daily) of abrocitinib monotherapy over 12 weeks.',
    'Consistent with JADE MONO-1, results showed that by week 12 the percentage of patients achieving each co-primary efficacy endpoint and each key secondary endpoint with either dose of abrocitinib was statistically significantly higher than placebo.',
    'The co-primary study endpoints in JADE MONO-2 were the proportion of patients who achieved an Investigator Global Assessment (IGA) score of clear (0) or almost clear (1) skin and two-point or greater improvement.',
  ].join('\n');

  it('skips the endpoint description and a comparison with a sister trial (Cibinqo, JADE MONO-2)', () => {
    const r = pickReadout(mono2, [release('2019-09-27', mono2Text)], {}, [mono1]);
    expect(r?.provenance.quote).toMatch(/^Consistent with JADE MONO-1, results showed .* statistically significantly higher than placebo\.$/);
    // The same sentence is not MONO-1's result: it only compares with it.
    expect(pickReadout(mono1, [release('2019-09-27', mono2Text)], {}, [mono2])).toBeUndefined();
  });

  it('takes a "both trials met" sentence for each trial the release names (Dupixent, SINUS-24 and SINUS-52)', () => {
    const s24 = trial({ acronym: 'SINUS-24', nctId: 'NCT02912468', primaryCompletionDate: day('2018-09-01') });
    const s52 = trial({ acronym: 'SINUS-52', nctId: 'NCT02898454', primaryCompletionDate: day('2018-09-01') });
    const text = [
      'Joint Ventures', // page menu: not the VENTURE trial
      'Regeneron Pharmaceuticals, Inc. (NASDAQ: REGN ) and Sanofi today announced that both pivotal Phase 3 placebo-controlled trials evaluating Dupixent ® (dupilumab) in adults with inadequately-controlled chronic rhinosinusitis with nasal polyps ("CRSwNP"), met all their primary and secondary endpoints.',
      'The rates of conjunctivitis were: 1.4% Dupixent versus 0.8% placebo in SINUS-24; 2.7% Dupixent every two weeks versus 1.3% placebo in SINUS-52.',
      'The pivotal Phase 3 trials, known as SINUS-24 (n=276) and SINUS-52 (n=448), had the same co-primary endpoints, which were change from baseline in nasal congestion/ obstruction severity.',
    ].join('\n');
    const sisters = [trial({ acronym: 'VENTURE' }), trial({ acronym: 'CRSwNP' })];
    for (const [t, o] of [[s24, s52], [s52, s24]]) {
      const r = pickReadout(t, [release('2018-10-16', text)], {}, [o, ...sisters]);
      expect(r?.provenance.quote).toMatch(/^Regeneron Pharmaceuticals, Inc\. \(NASDAQ.*met all their primary and secondary endpoints\.$/);
    }
  });

  it('records nothing when no sentence states a result', () => {
    const r = pickReadout(psa1, [release('2019-10-22', 'AbbVie Announces Positive Top-Line Results from SELECT-PsA 1. The primary endpoint of SELECT-PsA 1 was the proportion of patients achieving ACR20 at week 12.', 'AbbVie Announces Positive Top-Line Results from SELECT-PsA 1')], {});
    expect(r).toBeUndefined();
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
