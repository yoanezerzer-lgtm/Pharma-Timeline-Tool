import { describe, it, expect } from 'vitest';
import { Drug, type Trial } from '../src/schema/index.js';
import {
  buildAxis,
  endpointsDiffer,
  evidenceCsv,
  evidenceRows,
  parseProgramRef,
  programView,
  readoutCards,
  resultSummary,
} from '../src/lib/compare.js';

const day = (value: string) => ({ value, precision: 'day' as const });
const src = { sourceUrl: 'https://www.accessdata.fda.gov/x.pdf', extractedBy: 'rule' as const, verified: false };

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}

function drug(slug: string, indication: string, approval: string | undefined, trials: Trial[]): Drug {
  return Drug.parse({
    slug, brandName: slug.toUpperCase(), inn: slug, modality: 'mAb', sponsor: 'Acme',
    regulatory: { us: { applicationNumber: '1', applicationType: 'BLA' } },
    indications: [{ name: indication, slug: indication.toLowerCase().replace(/\s+/g, '-'), approvalDate: approval ? day(approval) : undefined }],
    trials,
  });
}

const pivotal = (indication: string) => [{ indication, role: 'PIVOTAL' as const, provenance: src }];
const supportive = (indication: string) => [{ indication, role: 'SUPPORTIVE' as const, provenance: src }];

const ra = drug('rinvoq', 'RA', '2019-08-16', [
  trial({ id: 'next', acronym: 'SELECT-NEXT', nctId: 'NCT02675426', startDate: day('2015-12-17'), primaryCompletionDate: day('2017-04-21'), roles: pivotal('RA') }),
  trial({
    id: 'compare', acronym: 'SELECT-COMPARE', nctId: 'NCT02629159', startDate: day('2015-12-01'), primaryCompletionDate: day('2017-10-27'), roles: pivotal('RA'),
    readoutDate: day('2018-04-09'),
    provenance: { readoutDate: { sourceUrl: 'https://www.prnewswire.com/x-1.html', sourceLabel: 'PR Newswire: Upadacitinib meets endpoints', quote: 'SELECT-COMPARE met both primary endpoints.', extractedBy: 'regex', verified: false } },
    postedResults: [{
      title: 'ACR20 at Week 12', unitOfMeasure: 'percentage of participants',
      groups: [{ id: 'G0', title: 'Placebo' }, { id: 'G1', title: 'Upadacitinib 15 mg' }],
      measurements: [{ groupId: 'G0', value: '36.4' }, { groupId: 'G1', value: '70.5' }],
      analyses: [{ groupIds: ['G0', 'G1'], pValue: '<0.001' }],
    }],
  }),
  trial({ id: 'ext', acronym: 'SELECT-LTE', startDate: day('2018-01-01'), primaryCompletionDate: day('2020-01-01'), roles: supportive('RA') }),
]);

const psa = drug('skyrizi', 'PsA', '2022-01-21', [
  trial({
    id: 'k1', acronym: 'KEEPsAKE 1', nctId: 'NCT03675308', startDate: day('2019-03-25'), primaryCompletionDate: day('2020-10-08'), roles: pivotal('PsA'),
    postedResults: [{ title: 'ACR20 at Week 24', unitOfMeasure: 'percentage of participants', groups: [{ id: 'G0', title: 'Placebo' }, { id: 'G1', title: 'Risankizumab' }], measurements: [{ groupId: 'G0', value: '33.5' }, { groupId: 'G1', value: '57.3' }], analyses: [] }],
  }),
]);

const old = drug('keytruda', 'Melanoma', '2014-09-04', [
  trial({ id: 'k001', acronym: 'KEYNOTE-001', startDate: day('2011-03-01'), primaryCompletionDate: day('2013-10-01'), roles: pivotal('Melanoma') }),
]);

describe('program views', () => {
  it('reads a program reference from the URL', () => {
    expect(parseProgramRef('upadacitinib:rheumatoid-arthritis')).toEqual({ slug: 'upadacitinib', indicationSlug: 'rheumatoid-arthritis' });
    expect(parseProgramRef('bad')).toBeUndefined();
    expect(parseProgramRef(null)).toBeUndefined();
  });

  it('shows every cited trial with its role, pivotal ones first, earliest start first', () => {
    const v = programView(ra, ra.indications[0]);
    expect(v.lanes.map((l) => [l.name, l.role])).toEqual([
      ['SELECT-COMPARE', 'PIVOTAL'],
      ['SELECT-NEXT', 'PIVOTAL'],
      ['SELECT-LTE', 'SUPPORTIVE'],
    ]);
  });
});

describe('buildAxis', () => {
  const a = programView(ra, ra.indications[0]);
  const b = programView(psa, psa.indications[0]);
  const k = programView(old, old.indications[0]);

  it('puts both programs on one calendar axis, years labelled and quarters marked', () => {
    const axis = buildAxis([a, b]);
    expect(axis.ticks.filter((t) => t.major).map((t) => t.label)).toContain('2018');
    expect(axis.ticks.some((t) => !t.major)).toBe(true);
    expect(axis.position(a.approval!)).toBeGreaterThan(axis.position(a.lanes[0].start!));
    expect(axis.position(b.approval!)).toBeLessThanOrEqual(100);
  });

  it('spaces year labels out when the programs span many years', () => {
    const axis = buildAxis([k, b]);
    const labelled = axis.ticks.filter((t) => t.label);
    expect(labelled.length).toBeLessThanOrEqual(12);
    expect(axis.ticks.some((t) => !t.major)).toBe(false);
  });
});

describe('evidence table', () => {
  const a = programView(ra, ra.indications[0]);
  const b = programView(psa, psa.indications[0]);

  it('lists every arm as posted, drug arms before the control', () => {
    const r = resultSummary(ra.trials.find((t) => t.id === 'compare')!, ['upadacitinib', 'Rinvoq']);
    expect(r?.arms.map((x) => [x.label, x.value, x.isComparator])).toEqual([
      ['Upadacitinib 15 mg', '70.5%', false],
      ['Placebo', '36.4%', true],
    ]);
    expect(r?.arms[0].percent).toBe(70.5);
    expect(r?.pValue).toBe('<0.001');
  });

  it('puts an active comparator after the drug and before placebo', () => {
    const t = trial({ postedResults: [{ title: 'ACR20', unitOfMeasure: 'percentage of participants', groups: [{ id: 'a', title: 'Adalimumab' }, { id: 'b', title: 'Placebo' }, { id: 'c', title: 'Upadacitinib' }], measurements: [{ groupId: 'a', value: '63' }, { groupId: 'b', value: '36' }, { groupId: 'c', value: '70' }], analyses: [] }] });
    expect(resultSummary(t, ['upadacitinib'])?.arms.map((a) => a.label)).toEqual(['Upadacitinib', 'Adalimumab', 'Placebo']);
  });

  it('marks trials completed after the approval as later label updates, and keeps "NA" as posted', () => {
    const later = programView(old, old.indications[0]);
    expect(later.lanes[0].afterApproval).toBe(false);
    const d = drug('k', 'M', '2014-09-04', [trial({ id: 'a', roles: pivotal('M'), primaryCompletionDate: day('2017-10-02'), postedResults: [{ title: 'RFS', unitOfMeasure: 'Months', groups: [{ id: 'g', title: 'Pembrolizumab' }], measurements: [{ groupId: 'g', value: 'NA' }], analyses: [] }] })]);
    expect(programView(d, d.indications[0]).lanes[0].afterApproval).toBe(true);
    expect(resultSummary(d.trials[0])?.arms[0].value).toBe('NA');
  });

  it('flags rows that measure different endpoints', () => {
    expect(endpointsDiffer(evidenceRows([a, b]))).toBe(true);
    expect(endpointsDiffer(evidenceRows([b]))).toBe(false);
  });

  it('exports CSV with a source link per row and quotes cells that need it', () => {
    const csv = evidenceCsv(evidenceRows([a]), [a]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Announcement source');
    expect(lines).toHaveLength(4);
    expect(csv).toContain('https://www.prnewswire.com/x-1.html');
    expect(csv).toContain('https://clinicaltrials.gov/study/NCT02629159');
    expect(csv).toContain(',Upadacitinib 15 mg: 70.5%; Placebo: 36.4%,');
    // The endpoint has no comma; a label with one is quoted.
    const withComma = evidenceCsv(evidenceRows([programView(psa, { ...psa.indications[0], displayName: 'Arthritis, psoriatic' })]), [programView(psa, psa.indications[0])]);
    expect(withComma).toContain('"Arthritis, psoriatic"');
  });
});

describe('readoutCards', () => {
  it('shows one card per release, with months to the announcement and to approval', () => {
    const cards = readoutCards([programView(ra, ra.indications[0])]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ trials: ['SELECT-COMPARE'], completionToAnnouncement: 5, announcementToApproval: 16 });
  });

  it('merges two trials announced in the same release', () => {
    const shared = { sourceUrl: 'https://www.prnewswire.com/both-2.html', quote: 'Both met.', extractedBy: 'regex' as const, verified: false };
    const d = drug('d', 'PsA', '2021-12-14', [
      trial({ id: 'p1', acronym: 'PsA 1', primaryCompletionDate: day('2019-09-26'), roles: pivotal('PsA'), readoutDate: day('2019-10-22'), provenance: { readoutDate: shared } }),
      trial({ id: 'p2', acronym: 'PsA 2', primaryCompletionDate: day('2019-07-23'), roles: pivotal('PsA'), readoutDate: day('2019-10-22'), provenance: { readoutDate: shared } }),
    ]);
    const cards = readoutCards([programView(d, d.indications[0])]);
    expect(cards).toHaveLength(1);
    expect(cards[0].trials.sort()).toEqual(['PsA 1', 'PsA 2']);
  });
});
