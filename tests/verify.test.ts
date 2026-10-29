import { describe, it, expect } from 'vitest';
import { Drug, type Trial } from '../src/schema/index.js';
import { Reference } from '../scripts/qc/reference.js';
import { applyVerdicts, buildQueue, type DrugContext, type Verdict } from '../scripts/verify/claims.js';
import { checkQuote, findPassages, normalize, type SourceDoc } from '../scripts/verify/sources.js';

const FILLER = 'Patients were randomized and assessed at prespecified visits. '.repeat(6);
const LABEL_URL = 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/000001s010lbl.pdf';
const LETTER_URL = 'https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2024/000001s010ltr.pdf';

const labelText =
  'FULL PRESCRIBING INFORMATION: CONTENTS 1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis 1.2 Psoriatic Arthritis ' +
  '2 DOSAGE AND ADMINISTRATION <<<PAGE 1>>> 1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis TESTA is indicated for RA. ' +
  '1.2 Psoriatic Arthritis TESTA is indicated for PsA. 2 DOSAGE AND ADMINISTRATION Take once daily. <<<PAGE 9>>> ' +
  `14 CLINICAL STUDIES 14.1 Rheumatoid Arthritis Trial RA - I (NCT00000001) was a 24 - week trial in 500 patients with moderately to severely active rheumatoid arthritis. ${FILLER}` +
  `14.2 Psoriatic Arthritis Trial PsA-I (NCT00000002) was a 24-week trial in 600 patients with active psoriatic arthritis. ${FILLER}` +
  '16 HOW SUPPLIED/STORAGE AND HANDLING Bottles of 30.';

const sources: SourceDoc[] = [
  { url: LABEL_URL, kind: 'label', text: labelText },
  { url: LETTER_URL, kind: 'letter', text: 'This supplemental application provides for psoriatic arthritis based on Trial PsA-I (NCT00000002) results.' },
];

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}

const pivotal = (indication: string) => [{ indication, role: 'PIVOTAL' as const, provenance: { sourceUrl: LABEL_URL, extractedBy: 'rule' as const, verified: false } }];
const ra = trial({ id: 'ra-i', nctId: 'NCT00000001', labelName: 'RA-I', sponsor: 'Acme', studyType: 'INTERVENTIONAL', roles: pivotal('Rheumatoid Arthritis') });
const psa = trial({ id: 'psa-i', nctId: 'NCT00000002', labelName: 'PsA-I', phase: 'PHASE1', sponsor: 'Acme', roles: pivotal('Psoriatic Arthritis') });

function context(): DrugContext {
  const drug = Drug.parse({
    slug: 'testdrug', brandName: 'Testa', inn: 'testamab', modality: 'mAb', sponsor: 'Acme',
    regulatory: { us: { applicationNumber: '1', applicationType: 'BLA', sponsor: 'ACME' } },
    indications: [
      { name: 'Rheumatoid Arthritis', slug: 'ra' },
      { name: 'Psoriatic Arthritis', slug: 'psa' },
    ],
    trials: [ra, psa],
  });
  const ref = Reference.parse({
    slug: 'testdrug',
    pivotal: [
      { indication: 'Rheumatoid Arthritis', trial: 'NCT00000001', pivotal: true, status: 'baseline' },
      { indication: 'Psoriatic Arthritis', trial: 'NCT00000002', pivotal: true, status: 'baseline' },
    ],
  });
  return { drug, ref, sources };
}

const RA_QUOTE = 'Trial RA-I (NCT00000001) was a 24-week trial in 500 patients with moderately to severely active rheumatoid arthritis.';
const PSA_QUOTE = 'Trial PsA-I (NCT00000002) was a 24-week trial in 600 patients with active psoriatic arthritis.';

describe('source passages and quote checks', () => {
  it('finds the passage inside the right indication span, with its page', () => {
    const [first] = findPassages(ra, 'Rheumatoid Arthritis', sources);
    expect(first).toMatchObject({ sourceUrl: LABEL_URL, kind: 'label', inIndicationSpan: true, page: 9 });
    expect(findPassages(ra, 'Psoriatic Arthritis', sources).some((p) => p.inIndicationSpan)).toBe(false);
  });

  it('accepts a quote whose only difference is PDF spacing around hyphens', () => {
    expect(normalize('RA - I and 24 - week')).toBe('RA-I and 24-week');
    expect(checkQuote(RA_QUOTE, LABEL_URL, ra, 'Rheumatoid Arthritis', sources)).toEqual({ ok: true, kind: 'label', inIndicationSpan: true });
  });

  it('rejects a reworded quote, a short one, one that does not name the trial, and an unknown document', () => {
    const fail = (q: string, url = LABEL_URL) => checkQuote(q, url, ra, 'Rheumatoid Arthritis', sources).ok;
    expect(fail('Trial RA-I (NCT00000001) was the only trial supporting approval in rheumatoid arthritis.')).toBe(false);
    expect(fail('Trial RA-I (NCT00000001)')).toBe(false);
    expect(fail('was a 24-week trial in 600 patients with active psoriatic arthritis.')).toBe(false);
    expect(fail(RA_QUOTE, 'https://www.accessdata.fda.gov/other.pdf')).toBe(false);
  });

  it('places a quote from another indication outside the span', () => {
    expect(checkQuote(RA_QUOTE, LABEL_URL, ra, 'Psoriatic Arthritis', sources)).toMatchObject({ ok: true, inIndicationSpan: false });
  });
});

describe('overnight verification', () => {
  it('queues unchecked entries plus at least two planted false claims, reproducibly', () => {
    const a = buildQueue([context()], '2026-10-27');
    const b = buildQueue([context()], '2026-10-27');
    expect(a.queue.map((c) => c.id)).toEqual(b.queue.map((c) => c.id));
    expect(Object.values(a.key).filter((k) => k === 'real')).toHaveLength(2);
    expect(Object.values(a.key).filter((k) => k === 'decoy').length).toBeGreaterThanOrEqual(1);
    for (const c of a.queue.filter((c) => a.key[c.id] === 'decoy')) {
      expect(c.passages.some((p) => p.inIndicationSpan)).toBe(false);
    }
  });

  it('takes drugs with nothing confirmed yet first', () => {
    const checked = context();
    checked.ref.pivotal[0].status = 'confirmed';
    const fresh = context();
    fresh.drug = { ...fresh.drug, slug: 'freshdrug' };
    for (const date of ['2026-10-27', '2026-10-28', '2026-10-29']) {
      const { queue, key } = buildQueue([checked, fresh], date, 2);
      expect(queue.filter((c) => key[c.id] === 'real').map((c) => c.drug)).toEqual(['freshdrug', 'freshdrug']);
    }
  });

  function run(answer: (id: string, decoy: boolean, trial: string) => Verdict) {
    const ctx = context();
    const { queue, key } = buildQueue([ctx], '2026-10-27');
    const verdicts = queue.map((c) => answer(c.id, key[c.id] === 'decoy', c.trial));
    return applyVerdicts(queue, key, verdicts, [ctx], '2026-10-27');
  }
  const honest = (id: string, decoy: boolean, t: string): Verdict =>
    decoy
      ? { claim: id, verdict: 'contradicted', evidence: [], reason: 'Not named under this indication.' }
      : t === 'NCT00000001'
        ? { claim: id, verdict: 'supported', evidence: [{ sourceUrl: LABEL_URL, quote: RA_QUOTE }], reason: '' }
        : { claim: id, verdict: 'supported', evidence: [{ sourceUrl: LABEL_URL, quote: PSA_QUOTE }], reason: '' };

  it('confirms with a label quote plus the registry; holds a Phase 1 trial without a second document', () => {
    const r = run(honest);
    const ref = r.refs.get('testdrug')!;
    expect(r.voided).toBe(false);
    expect(ref.pivotal.find((p) => p.trial === 'NCT00000001')).toMatchObject({ status: 'confirmed', evidence: [{ sourceUrl: LABEL_URL, quote: RA_QUOTE }] });
    expect(ref.pivotal.find((p) => p.trial === 'NCT00000002')?.status).toBe('baseline');
    expect(r.results.find((x) => x.claim.trial === 'NCT00000002' && !x.outcome.startsWith('decoy'))?.outcome).toBe('rejected');
    expect(r.spotCheck).toHaveLength(1);
  });

  it('accepts an FDA letter as the second source', () => {
    const r = run((id, decoy, t) =>
      !decoy && t === 'NCT00000002'
        ? { claim: id, verdict: 'supported', reason: '', evidence: [
            { sourceUrl: LABEL_URL, quote: PSA_QUOTE },
            { sourceUrl: LETTER_URL, quote: 'provides for psoriatic arthritis based on Trial PsA-I (NCT00000002) results' },
          ] }
        : honest(id, decoy, t)
    );
    expect(r.refs.get('testdrug')!.pivotal.find((p) => p.trial === 'NCT00000002')?.status).toBe('confirmed');
  });

  it('voids the whole night when a planted false claim comes back supported', () => {
    const r = run((id, decoy, t) => (decoy ? { claim: id, verdict: 'supported', evidence: [{ sourceUrl: LABEL_URL, quote: RA_QUOTE }], reason: '' } : honest(id, decoy, t)));
    expect(r.voided).toBe(true);
    expect(r.refs.get('testdrug')!.pivotal.every((p) => p.status === 'baseline')).toBe(true);
    expect(r.spotCheck).toEqual([]);
  });

  it('reports a contradiction with a verified quote as a disagreement and changes nothing', () => {
    const r = run((id, decoy, t) =>
      !decoy && t === 'NCT00000001'
        ? { claim: id, verdict: 'contradicted', evidence: [{ sourceUrl: LABEL_URL, quote: RA_QUOTE }], reason: 'Supportive only.' }
        : honest(id, decoy, t)
    );
    expect(r.results.find((x) => x.claim.trial === 'NCT00000001' && !x.outcome.startsWith('decoy'))?.outcome).toBe('disagreement');
    expect(r.refs.get('testdrug')!.pivotal.find((p) => p.trial === 'NCT00000001')?.status).toBe('baseline');
  });

  it('counts each night a fact is not confirmed, and stops queuing it after three', () => {
    const unclear = (id: string, decoy: boolean, t: string): Verdict =>
      !decoy && t === 'NCT00000001' ? { claim: id, verdict: 'unclear', evidence: [], reason: 'Garbled text.' } : honest(id, decoy, t);
    const ctx = context();
    for (const [night, date] of ['2026-10-27', '2026-10-28', '2026-10-29'].entries()) {
      const { queue, key } = buildQueue([ctx], date);
      expect(queue.some((c) => key[c.id] === 'real' && c.trial === 'NCT00000001')).toBe(true);
      const r = applyVerdicts(queue, key, queue.map((c) => unclear(c.id, key[c.id] === 'decoy', c.trial)), [ctx], date);
      ctx.ref = r.refs.get('testdrug')!;
      expect(ctx.ref.pivotal.find((p) => p.trial === 'NCT00000001')?.tries).toBe(night + 1);
      // PsA-I is a Phase 1 trial with no second source, so it is rejected every night too.
      expect(r.stuck.map((x) => x.claim.trial).sort()).toEqual(night === 2 ? ['NCT00000001', 'NCT00000002'] : []);
    }
    const { queue, key } = buildQueue([ctx], '2026-10-30');
    expect(queue.some((c) => key[c.id] === 'real' && c.trial === 'NCT00000001')).toBe(false);
  });

  it('never changes an entry that is already confirmed', () => {
    const ctx = context();
    ctx.ref.pivotal[0] = { ...ctx.ref.pivotal[0], status: 'confirmed', checkedBy: 'a person' };
    const { queue, key } = buildQueue([ctx], '2026-10-27');
    expect(queue.some((c) => key[c.id] === 'real' && c.trial === 'NCT00000001')).toBe(false);
  });
});
