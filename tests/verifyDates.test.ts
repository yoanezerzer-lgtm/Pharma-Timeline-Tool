import { describe, it, expect } from 'vitest';
import { Drug } from '../src/schema/index.js';
import { Reference } from '../scripts/qc/reference.js';
import { applyVerdicts, buildQueue, reportMarkdown, type DrugContext, type Verdict } from '../scripts/verify/claims.js';
import { dateDecoyCandidates, gradeDate, labelSecondSource, namesUse, syncIndications, type DateClaim } from '../scripts/verify/dates.js';
import type { SourceDoc } from '../scripts/verify/sources.js';

// Excerpts of the real FDA documents, as the ingest workflow extracted them
// (diag/raw-text-<slug> branches, 19 Nov 2026).

const RYB = {
  origLetter: 'https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2025/761433Orig1s000ltr.pdf',
  origLabel: 'http://www.accessdata.fda.gov/drugsatfda_docs/label/2025/761433s000lbl.pdf',
  s2Letter: 'https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2026/761433Orig1s002ltr.pdf',
  s2Label: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/761433s002lbl.pdf',
};
const LUNG = [
  'First-Line Treatment of NSCLC with EGFR Exon 19 Deletions or Exon 21 L858R Substitution Mutations',
  'Previously Treated NSCLC with EGFR Exon 19 Deletions or Exon 21 L858R Substitution Mutations',
  'First-Line Treatment of NSCLC with EGFR Exon 20 Insertion Mutations',
  'Previously Treated NSCLC with EGFR Exon 20 Insertion Mutations',
];
const HNSCC = 'Previously Treated HNSCC';
const LUNG_WORDING = [
  'The first-line treatment of adult patients with locally advanced or metastatic non-small cell lung cancer (NSCLC) with epidermal growth factor receptor (EGFR) exon 19 deletions or exon 21 L858R substitution mutations, as detected by an FDA-approved test',
  'Adult patients with locally advanced or metastatic NSCLC with EGFR exon 19 deletions or exon 21 L858R substitution mutations, whose disease has progressed on or after treatment with an EGFR tyrosine kinase inhibitor',
  'The first-line treatment of adult patients with locally advanced or metastatic NSCLC with EGFR exon 20 insertion mutations, as detected by an FDA-approved test',
  'As a single agent for the treatment of adult patients with locally advanced or metastatic NSCLC with EGFR exon 20 insertion mutations, as detected by an FDA-approved test, whose disease has progressed on or after platinum-based chemotherapy',
];
// The ORIG-1 letter's four bullets, with its real page break inside the fourth.
const LUNG_BULLETS = [
  'In combination with lazertinib for the first-line treatment of adult patients with locally advanced or metastatic non-small cell lung cancer (NSCLC) with EGFR exon 19 deletions or exon 21 L858R substitution mutations, as detected by an FDA-approved test.',
  'In combination with carboplatin and pemetrexed for the treatment of adult patients with locally advanced or metastatic NSCLC with EGFR exon 19 deletions or exon 21 L858R substitution mutations, whose disease has progressed on or after treatment with an EGFR tyrosine kinase inhibitor.',
  'In combination with carboplatin and pemetrexed for the first-line treatment of adult patients with locally advanced or metastatic NSCLC with EGFR exon 20 insertion mutations, as detected by an FDA-approved test.',
  'As a single agent for the treatment of adult patients with locally advanced or metastatic NSCLC with EGFR exon 20 insertion mutations, as detected by an',
];
const PAGE_BREAK = ' Reference ID: 5713869 <<<PAGE 2>>> BLA 761433 Page 2 ';
const ORIG_LETTER =
  '<<<PAGE 1>>> BLA 761433 BLA APPROVAL Janssen Biotech, Inc. LICENSING We have approved your BLA for Rybrevant Faspro (amivantamab and hyaluronidase- lpuj) effective this date. ' +
  `Rybrevant Faspro is indicated for the following indications: • ${LUNG_BULLETS.join(' • ')}${PAGE_BREAK}FDA approved test, whose disease has progressed on or after platinum-based chemotherapy. ` +
  'MANUFACTURING LOCATIONS Under this license, you are approved to manufacture amivantamab drug substance.';
// What a reader copies for each bullet: the fourth runs across the page footer, which stays in the quote.
const LUNG_QUOTES = [
  ...LUNG_BULLETS.slice(0, 3),
  `${LUNG_BULLETS[3]} Reference ID: 5713869 BLA 761433 Page 2 FDA approved test, whose disease has progressed on or after platinum-based chemotherapy.`,
];
const HNSCC_SENTENCE =
  'This Prior Approval sBLA provides for Rybrevant Faspro as a single agent for the treatment of adult patients with recurrent or metastatic head and neck squamous cell carcinoma (HNSCC) whose disease has progressed on or after platinum-based chemotherapy and an anti-PD-(L)1 antibody.';
const S2_LETTER =
  '<<<PAGE 1>>> BLA 761433/S-002 ACCELERATED APPROVAL Janssen Biotech, Inc. Please refer to your supplemental biologics license application (sBLA), dated and received May 20, 2026. ' +
  `${HNSCC_SENTENCE} Limitations of Use: Rybrevant Faspro is not indicated as treatment for patients with oropharyngeal squamous cell carcinoma (OPSCC) that is human papillomavirus (HPV)- associated (i.e., by p16 IHC). APPROVAL & LABELING We have completed our review of this application.`;
const toc = (names: string[]) =>
  `FULL PRESCRIBING INFORMATION: CONTENTS* 1 INDICATIONS AND USAGE ${names.map((n, i) => `1.${i + 1} ${n}`).join(' ')} 2 DOSAGE AND ADMINISTRATION 2.1 Patient Selection`;

const milestone = (submission: string, date: string, type: 'FDA_APPROVAL' | 'FDA_SUPPLEMENT', description: string) => ({
  id: submission.toLowerCase(), type, region: 'US' as const, date: { value: date, precision: 'day' as const }, label: submission, submissionNumber: submission, description,
});
const dated = (name: string, submission: string, date: string, wording?: string) => ({
  name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), submissionNumber: submission, approvalDate: { value: date, precision: 'day' as const },
  ...(wording ? { wording: { text: wording, provenance: { sourceUrl: RYB.origLabel, extractedBy: 'regex' as const, verified: false } } } : {}),
});

/** Rybrevant Faspro as Saturday's refresh shows it: four lung uses from ORIG-1, head and neck from SUPPL-2. */
function rybrevant(hnsccSubmission = 'SUPPL-2', hnsccDate = '2026-11-05'): DrugContext {
  const drug = Drug.parse({
    slug: 'rybrevant-faspro', brandName: 'Rybrevant Faspro', inn: 'amivantamab and hyaluronidase-lpuj', modality: 'mAb', sponsor: 'Janssen',
    regulatory: { us: { applicationNumber: '761433', applicationType: 'BLA', sponsor: 'JANSSEN BIOTECH' } },
    indications: [
      ...LUNG.map((n, i) => dated(n, 'ORIG-1', '2025-12-17', LUNG_WORDING[i])),
      dated(HNSCC, hnsccSubmission, hnsccDate),
    ],
    milestones: [milestone('ORIG-1', '2025-12-17', 'FDA_APPROVAL', 'Type 5 - New Formulation or New Manufacturer'), milestone('SUPPL-2', '2026-11-05', 'FDA_SUPPLEMENT', 'Efficacy')],
    sources: [
      { id: 'd0', label: 'Letter (ORIG-1)', url: RYB.origLetter, type: 'fda_review' },
      { id: 'd1', label: 'Label (ORIG-1)', url: RYB.origLabel, type: 'fda_label' },
      { id: 'd2', label: 'Letter (SUPPL-2)', url: RYB.s2Letter, type: 'fda_review' },
      { id: 'd3', label: 'Label (SUPPL-2)', url: RYB.s2Label, type: 'fda_label' },
    ],
    trials: [],
  });
  const sources: SourceDoc[] = [
    { url: RYB.origLetter, kind: 'letter', text: ORIG_LETTER, submissions: ['ORIG-1'] },
    { url: RYB.origLabel, kind: 'label', text: toc(LUNG), submissions: ['ORIG-1'] },
    { url: RYB.s2Letter, kind: 'letter', text: S2_LETTER, submissions: ['SUPPL-2'] },
    { url: RYB.s2Label, kind: 'label', text: toc([...LUNG, HNSCC]), submissions: ['SUPPL-2'] },
  ];
  const ref = syncIndications(drug, Reference.parse({ slug: drug.slug }));
  return { drug, ref, sources };
}

const claimOf = (ctx: DrugContext, indication: string, submission: string, date: string): DateClaim => ({
  kind: 'date', id: 'x', drug: ctx.drug.slug, indication, submission, date, question: '', passages: [],
});

describe('approval-date claims: Rybrevant Faspro', () => {
  it('reads which use each ORIG-1 bullet names, and only that one', () => {
    const { drug } = rybrevant();
    LUNG.forEach((name, i) => {
      expect(LUNG_QUOTES.map((b) => namesUse(b, name, drug))).toEqual(LUNG_QUOTES.map((_, j) => j === i));
    });
    expect(namesUse(HNSCC_SENTENCE, HNSCC, drug)).toBe(true);
    expect(LUNG_QUOTES.some((b) => namesUse(b, HNSCC, drug))).toBe(false);
    // Cut at the page break, the fourth bullet can't be told from the third.
    expect(namesUse(LUNG_BULLETS[3], LUNG[3], drug)).toBe(false);
  });

  it('takes the labels as the second source: the original label for ORIG-1, a new section 1 entry for SUPPL-2', () => {
    const { drug, sources } = rybrevant();
    for (const name of LUNG) expect(labelSecondSource(drug, sources, name, 'ORIG-1')).toMatchObject({ ok: true });
    expect(labelSecondSource(drug, sources, HNSCC, 'SUPPL-2')).toEqual({ ok: true, how: 'the SUPPL-2 label lists it and the ORIG-1 label before it does not' });
    expect(labelSecondSource(drug, sources, HNSCC, 'ORIG-1')).toMatchObject({ ok: false });
    expect(labelSecondSource(drug, sources, LUNG[0], 'SUPPL-2')).toMatchObject({ ok: false });
  });

  it('queues every dated use with its letter and labels, and plants head and neck on ORIG-1 as a false claim', () => {
    const ctx = rybrevant();
    expect(dateDecoyCandidates(ctx.drug, ctx.sources)).toContainEqual({ indication: HNSCC, submission: 'ORIG-1', date: '2025-12-17' });
    const { queue, key } = buildQueue([ctx], '2026-11-20');
    const real = queue.filter((c) => key[c.id] === 'real');
    expect(real.map((c) => c.kind)).toEqual(Array(5).fill('date'));
    const hn = real.find((c) => c.indication === HNSCC) as DateClaim;
    expect(hn).toMatchObject({ submission: 'SUPPL-2', date: '2026-11-05' });
    expect(hn.passages.map((p) => p.about)).toEqual([
      'Approval letter (SUPPL-2)',
      'Label approved with SUPPL-2, section 1',
      'Label before it (ORIG-1, 2025-12-17), section 1',
    ]);
    expect(hn.passages[0].text).toContain('head and neck squamous cell carcinoma (HNSCC)');
    const decoys = queue.filter((c) => key[c.id] === 'decoy');
    expect(decoys.length).toBeGreaterThanOrEqual(2);
    expect(decoys.every((c) => c.kind === 'date')).toBe(true);
  });

  const honest = (c: DateClaim, decoy: boolean): Verdict => {
    if (decoy) return { claim: c.id, verdict: 'contradicted', evidence: [], reason: 'That letter does not name this use.' };
    const quote = c.indication === HNSCC ? HNSCC_SENTENCE : LUNG_QUOTES[LUNG.indexOf(c.indication)];
    return { claim: c.id, verdict: 'supported', evidence: [{ sourceUrl: c.indication === HNSCC ? RYB.s2Letter : RYB.origLetter, quote }], reason: '' };
  };

  it('confirms the four lung uses by the ORIG-1 letter and head and neck by the SUPPL-2 letter', () => {
    const ctx = rybrevant();
    const { queue, key } = buildQueue([ctx], '2026-11-20');
    const r = applyVerdicts(queue, key, queue.map((c) => honest(c as DateClaim, key[c.id] === 'decoy')), [ctx], '2026-11-20');
    expect(r.voided).toBe(false);
    const ref = r.refs.get('rybrevant-faspro')!;
    expect(ref.indications.map((i) => [i.name, i.submission, i.status])).toEqual([
      ...LUNG.map((n) => [n, 'ORIG-1', 'confirmed']),
      [HNSCC, 'SUPPL-2', 'confirmed'],
    ]);
    expect(ref.indications[4].checkedBy).toBe(
      'Overnight agent 2026-11-20: Confirmed by the SUPPL-2 approval letter; the SUPPL-2 label lists it and the ORIG-1 label before it does not.'
    );
    expect(ref.indications[4].evidence).toEqual([{ sourceUrl: RYB.s2Letter, quote: HNSCC_SENTENCE }]);
    expect(r.results.filter((x) => x.outcome === 'decoy-caught').length).toBe(Object.values(key).filter((k) => k === 'decoy').length);
    const report = reportMarkdown(r, '2026-11-20');
    expect(report).toContain('- Checked: 5 facts (5 approval dates)');
    expect(report).toContain('- Approved uses with no date (nothing to confirm): 0');
  });

  it('voids the night when head and neck on ORIG-1, a planted claim, comes back supported', () => {
    const ctx = rybrevant();
    const { queue, key } = buildQueue([ctx], '2026-11-20');
    const r = applyVerdicts(
      queue, key,
      queue.map((c) => (key[c.id] === 'decoy' ? { claim: c.id, verdict: 'supported' as const, evidence: [], reason: '' } : honest(c as DateClaim, false))),
      [ctx], '2026-11-20'
    );
    expect(r.voided).toBe(true);
    expect(r.refs.get('rybrevant-faspro')!.indications.every((i) => i.status === 'baseline')).toBe(true);
  });

  it('never confirms head and neck dated to ORIG-1 (the 19 Nov misdating), whatever the answer quotes', () => {
    const ctx = rybrevant('ORIG-1', '2025-12-17');
    const claim = claimOf(ctx, HNSCC, 'ORIG-1', '2025-12-17');
    const fromOrig = gradeDate(claim, 'supported', [{ sourceUrl: RYB.origLetter, quote: LUNG_QUOTES[3] }], '', ctx.drug, ctx.sources);
    expect(fromOrig.outcome).toBe('rejected');
    expect(fromOrig.detail).toContain('no verified quote from the ORIG-1 approval letter naming "Previously Treated HNSCC"');
    expect(fromOrig.detail).toContain("the ORIG-1 label's section 1 does not list it");
    // Quoting the SUPPL-2 letter doesn't help: it is not ORIG-1's letter.
    expect(gradeDate(claim, 'supported', [{ sourceUrl: RYB.s2Letter, quote: HNSCC_SENTENCE }], '', ctx.drug, ctx.sources).outcome).toBe('rejected');
    // The honest answer is recorded as a disagreement for the owner.
    expect(gradeDate(claim, 'contradicted', [{ sourceUrl: RYB.s2Letter, quote: HNSCC_SENTENCE }], 'Added by SUPPL-2.', ctx.drug, ctx.sources).outcome).toBe('disagreement');
  });

  it('rejects a wrong date for the right submission, a paraphrase, a short quote, and another use\'s bullet', () => {
    const ctx = rybrevant();
    const grade = (claim: DateClaim, quote: string, url = RYB.origLetter) => gradeDate(claim, 'supported', [{ sourceUrl: url, quote }], '', ctx.drug, ctx.sources);
    expect(grade(claimOf(ctx, HNSCC, 'SUPPL-2', '2026-11-06'), HNSCC_SENTENCE, RYB.s2Letter).detail).toContain('SUPPL-2 was approved on 2026-11-05, not 2026-11-06');
    const lung0 = claimOf(ctx, LUNG[0], 'ORIG-1', '2025-12-17');
    expect(grade(lung0, LUNG_BULLETS[0]).outcome).toBe('confirmed');
    expect(grade(lung0, LUNG_BULLETS[0].replace('first-line', 'initial')).outcome).toBe('rejected');
    expect(grade(lung0, 'In combination with lazertinib').outcome).toBe('rejected');
    expect(grade(lung0, LUNG_BULLETS[2]).outcome).toBe('rejected');
  });
});

describe('approval-date claims: Dupixent and Keytruda', () => {
  // Dupixent's eosinophilic esophagitis (SUPPL-40, 20 May 2022) and Keytruda's
  // mesothelioma (SUPPL-161, 17 Sep 2024): each letter's own sentence, and the
  // tables of contents of the label approved with it and of the one before.
  const cases = [
    {
      slug: 'dupilumab', brand: 'Dupixent', use: 'Eosinophilic Esophagitis', submission: 'SUPPL-40', date: '2022-05-20',
      before: { submission: 'SUPPL-21', date: '2021-12-22', names: ['Atopic Dermatitis', 'Asthma', 'Chronic Rhinosinusitis with Nasal Polyposis'] },
      after: ['Atopic Dermatitis', 'Asthma', 'Chronic Rhinosinusitis with Nasal Polyposis', 'Eosinophilic Esophagitis'],
      quote: 'This Prior Approval supplemental biologics license application provides for the treatment of adult and pediatric patients ages 12 years and older, weighing at least 40 kg, with eosinophilic esophagitis.',
      others: ['Atopic Dermatitis', 'Asthma', 'Chronic Rhinosinusitis with Nasal Polyps'],
    },
    {
      slug: 'pembrolizumab', brand: 'Keytruda', use: 'Malignant Pleural Mesothelioma', submission: 'SUPPL-161', date: '2024-09-17',
      before: { submission: 'SUPPL-157', date: '2024-08-07', names: ['Melanoma', 'Non-Small Cell Lung Cancer', 'Head and Neck Squamous Cell Cancer', 'Classical Hodgkin Lymphoma'] },
      after: ['Melanoma', 'Non-Small Cell Lung Cancer', 'Malignant Pleural Mesothelioma', 'Head and Neck Squamous Cell Cancer', 'Classical Hodgkin Lymphoma'],
      quote: 'This Prior Approval sBLA provides for a new indication for Keytruda (pembrolizumab), in combination with pemetrexed and platinum chemotherapy, as first-line treatment of adult patients with unresectable advanced or metastatic malignant pleural mesothelioma.',
      others: ['Melanoma', 'Non-Small Cell Lung Cancer', 'Head and Neck Squamous Cell Cancer', 'Classical Hodgkin Lymphoma'],
    },
  ];

  for (const c of cases) {
    it(`confirms ${c.brand}'s ${c.use} by the ${c.submission} letter, and not by the label before it`, () => {
      const url = (s: string, kind: string) => `https://www.accessdata.fda.gov/drugsatfda_docs/${kind}/${c.slug}-${s}.pdf`;
      const drug = Drug.parse({
        slug: c.slug, brandName: c.brand, inn: c.slug, modality: 'mAb', sponsor: 'x',
        regulatory: { us: { applicationNumber: '1', applicationType: 'BLA' } },
        indications: [...c.others.map((n) => ({ name: n, slug: n.toLowerCase().replace(/\W+/g, '-') })), dated(c.use, c.submission, c.date)],
        milestones: [milestone(c.before.submission, c.before.date, 'FDA_SUPPLEMENT', 'Labeling'), milestone(c.submission, c.date, 'FDA_SUPPLEMENT', 'Efficacy')],
        trials: [],
      });
      const sources: SourceDoc[] = [
        { url: url(c.submission, 'ltr'), kind: 'letter', submissions: [c.submission], text: `Dear Sir or Madam: ${c.quote} APPROVAL & LABELING We have completed our review of this application.` },
        { url: url(c.submission, 'lbl'), kind: 'label', submissions: [c.submission], text: toc(c.after) },
        { url: url(c.before.submission, 'lbl'), kind: 'label', submissions: [c.before.submission], text: toc(c.before.names) },
      ];
      const claim = claimOf({ drug, ref: Reference.parse({ slug: c.slug }), sources }, c.use, c.submission, c.date);
      expect(gradeDate(claim, 'supported', [{ sourceUrl: url(c.submission, 'ltr'), quote: c.quote }], '', drug, sources)).toMatchObject({
        outcome: 'confirmed',
        detail: `Confirmed by the ${c.submission} approval letter; the ${c.submission} label lists it and the ${c.before.submission} label before it does not.`,
      });
      // Dated to the earlier submission instead: its label doesn't list the use, and its letter isn't loaded.
      const early = claimOf({ drug, ref: Reference.parse({ slug: c.slug }), sources }, c.use, c.before.submission, c.before.date);
      expect(gradeDate(early, 'supported', [{ sourceUrl: url(c.submission, 'ltr'), quote: c.quote }], '', drug, sources).outcome).toBe('rejected');
    });
  }
});

describe('syncIndications', () => {
  it('adds uses the file lacks, replaces unchecked entries whose date changed, drops uses gone from the site, and keeps confirmed ones', () => {
    const { drug } = rybrevant();
    const ref = Reference.parse({
      slug: 'rybrevant-faspro',
      indications: [
        { name: LUNG[0].replace(/ /g, '  '), approvalDate: '2025-12-17', submission: 'ORIG-1', status: 'baseline', tries: 1 },
        { name: LUNG[1], approvalDate: null, submission: null, status: 'baseline', tries: 2 },
        { name: LUNG[2], approvalDate: '2020-01-01', submission: 'ORIG-1', status: 'confirmed', checkedBy: 'owner' },
        { name: 'A use the site no longer shows', approvalDate: '2025-12-17', submission: 'ORIG-1', status: 'baseline' },
      ],
    });
    const synced = syncIndications(drug, ref);
    expect(synced.indications).toEqual([
      ref.indications[0],
      ref.indications[2],
      { name: LUNG[1], approvalDate: '2025-12-17', submission: 'ORIG-1', status: 'baseline' },
      { name: LUNG[3], approvalDate: '2025-12-17', submission: 'ORIG-1', status: 'baseline' },
      { name: HNSCC, approvalDate: '2026-11-05', submission: 'SUPPL-2', status: 'baseline' },
    ]);
    expect(syncIndications(drug, synced)).toBe(synced);
  });

  it('leaves undated uses out of the queue and counts them in the report', () => {
    const ctx = rybrevant();
    ctx.ref.indications[4] = { ...ctx.ref.indications[4], approvalDate: null, submission: null };
    const { queue, key } = buildQueue([ctx], '2026-11-20');
    expect(queue.filter((c) => key[c.id] === 'real').map((c) => c.indication)).not.toContain(HNSCC);
    const r = applyVerdicts(queue, key, [], [ctx], '2026-11-20');
    expect(reportMarkdown(r, '2026-11-20')).toContain('- Approved uses with no date (nothing to confirm): 1');
  });

  it('counts a night against a date that is not confirmed, and stops queuing it after three', () => {
    const ctx = rybrevant();
    for (const [night, date] of ['2026-11-20', '2026-11-21', '2026-11-22'].entries()) {
      const { queue, key } = buildQueue([ctx], date);
      const r = applyVerdicts(queue, key, queue.map((c) => ({ claim: c.id, verdict: 'unclear' as const, evidence: [], reason: 'x' })), [ctx], date);
      ctx.ref = r.refs.get('rybrevant-faspro')!;
      expect(ctx.ref.indications.every((i) => i.tries === night + 1)).toBe(true);
      expect(r.stuck.length).toBe(night === 2 ? 5 : 0);
    }
    const { key } = buildQueue([ctx], '2026-11-23');
    expect(Object.values(key).filter((k) => k === 'real')).toHaveLength(0);
  });
});
