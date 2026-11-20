import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Trial } from '../src/schema/index.js';
import { crossCheckDrug, isAbbreviationOf, productForms, trialForms, trialGivesDrugTopically } from '../scripts/qc/crossChecks.js';
import { checkLabelDates, labelHasUse } from '../scripts/qc/labelDates.js';

// Real values from the records (data/drugs, data/refresh-2026-11-15) and the
// labels' saved text (diag/raw-text-<slug>), cut to what each rule reads.

const src = { sourceUrl: 'https://www.accessdata.fda.gov/x.pdf', extractedBy: 'rule' as const, verified: false };
const review = { ...src, sourceLabel: 'FDA review (cited, not in a label section 14 indication span)' };
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'qc', name), 'utf8');

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}

function drug(o: Partial<Drug> & { routes?: string[] } = {}): Drug {
  const { routes, ...rest } = o;
  return Drug.parse({
    slug: 'testdrug', brandName: 'Testa', inn: 'testamab', modality: 'mAb', sponsor: 'Acme',
    regulatory: { us: { applicationNumber: '1', applicationType: 'BLA', sponsor: 'ACME', ...(routes ? { routes } : {}) } },
    ...rest,
  });
}

const codes = (d: Drug) => crossCheckDrug(d).map((f) => `${f.severity}:${f.code}`);

describe("a pivotal trial's disease and its use", () => {
  const exon20 = {
    name: 'Previously Treated NSCLC with EGFR Exon 20 Insertion Mutations',
    slug: 'previously-treated-nsclc-with-egfr-exon-20-insertion',
    diseases: [{ meshId: 'D002289', term: 'Carcinoma, Non-Small-Cell Lung', areas: [], provenance: src }],
  };
  const pivotalFor = (indication: string) => [{ indication, role: 'PIVOTAL' as const, provenance: src }];

  it('catches ORIGAMI-4, a head and neck trial, pivotal for a lung cancer use (15 Nov refresh)', () => {
    const d = drug({
      indications: [exon20],
      trials: [trial({
        id: 'origami-4', acronym: 'OrigAMI-4', nctId: 'NCT06385080', sponsor: 'ACME',
        conditions: ['Squamous Cell Carcinoma of Head and Neck'],
        conditionMesh: [{ id: 'D000077195', term: 'Squamous Cell Carcinoma of Head and Neck' }],
        roles: pivotalFor(exon20.name),
      })],
    });
    expect(codes(d)).toEqual(['error:pivotal-wrong-disease']);
  });

  it('passes a trial filed under the same disease or a synonym', () => {
    const d = drug({
      indications: [exon20, { name: 'Urothelial Cancer', slug: 'urothelial-cancer' }],
      trials: [
        trial({ id: 'chrysalis', sponsor: 'ACME', conditions: ['Non-Small-Cell Lung Cancer'], conditionMesh: [{ id: 'D002289', term: 'Carcinoma, Non-Small-Cell Lung' }], roles: pivotalFor(exon20.name) }),
        trial({ id: 'keynote-057', sponsor: 'ACME', conditions: ['Bladder Cancer'], roles: pivotalFor('Urothelial Cancer') }),
      ],
    });
    expect(codes(d)).toEqual([]);
  });

  it("reads a basket trial's cohorts, and catches an outsider's basket trial that never names the use", () => {
    const hnscc = { name: 'Head and Neck Squamous Cell Cancer', slug: 'hnscc' };
    const d = drug({
      indications: [hnscc, { name: 'Melanoma', slug: 'melanoma' }],
      trials: [
        trial({
          id: 'keynote-012', labelName: 'KEYNOTE-012', sponsor: 'ACME', conditions: ['Cancer', 'Solid Tumor'],
          title: 'A Phase Ib Multi-Cohort Study of MK-3475 in Subjects With Advanced Solid Tumors',
          arms: [{ label: 'Cohort A: Triple Negative Breast Cancer' }, { label: 'Cohort B: Head & Neck Cancer' }],
          roles: pivotalFor(hnscc.name),
        }),
        trial({
          id: 'solid-tumors', acronym: 'Solid Tumors', sponsor: 'Hefei Xinzhu Biological Technology Co., Ltd.', conditions: ['Advanced Malignant Solid Tumors'],
          title: 'A Phase I/II Clinical Study Evaluating the Safety, Tolerability, and Efficacy of N-3C01 as Monotherapy and in Combination With PD-(L)1 Monoclonal Antibody in Patients With Advanced Malignant Solid Tumors',
          arms: [{ label: 'N-3C01 monotherapy(Q2W)' }, { label: 'N-3C01 plus pembrolizumab' }],
          roles: pivotalFor('Melanoma'),
        }),
      ],
    });
    expect(codes(d)).toEqual(['error:pivotal-outsider-basket']);
    // The applicant's own basket trial that doesn't name the use: a warning to check.
    d.trials[1].sponsor = 'ACME';
    expect(codes(d)).toEqual(['warn:pivotal-disease-unnamed']);
  });

  it('requires a trial for a marker-defined use to be about that marker', () => {
    const tmb = { name: 'Tumor Mutational Burden-High Cancer', slug: 'tmb-h' };
    const msi = { name: 'Microsatellite Instability-High or Mismatch Repair Deficient Cancer', slug: 'msi-h' };
    const d = drug({
      indications: [tmb, msi],
      trials: [
        trial({ id: 'keynote-158', sponsor: 'ACME', conditions: ['Advanced Cancer', 'Anal Carcinoma'], title: 'A Clinical Trial of Pembrolizumab (MK-3475) Evaluating Predictive Biomarkers in Subjects With Advanced Solid Tumors (KEYNOTE 158)', roles: pivotalFor(tmb.name) }),
        trial({ id: 'keynote-164', sponsor: 'ACME', conditions: ['Colorectal Carcinoma'], title: 'A Phase II Study of Pembrolizumab (MK-3475) as Monotherapy in Subjects With Previously Treated Locally Advanced Unresectable or Metastatic (Stage IV) Mismatched Repair Deficient or Microsatellite Instability-High Colorectal Carcinoma (KEYNOTE-164)', roles: pivotalFor(msi.name) }),
        trial({ id: 'solid-tumors', sponsor: 'ACME', conditions: ['Advanced Malignant Solid Tumors'], title: 'N-3C01 Monotherapy and Combination With PD-(L)1 Inhibitors in Advanced Solid Tumors', roles: pivotalFor(tmb.name) }),
      ],
    });
    expect(crossCheckDrug(d).map((f) => `${f.code} ${f.path}`)).toEqual(['pivotal-wrong-disease trials[solid-tumors].roles[0]']);
  });

  it("catches Keytruda's pivotal role on a constipation trial found by its protocol number", () => {
    const d = drug({
      indications: [{ name: 'Ovarian Cancer', slug: 'ovarian-cancer' }],
      trials: [trial({ id: '0083', nctId: 'NCT01655771', protocolNumber: '0083', sponsor: 'ACME', conditions: ['Constipation'], roles: pivotalFor('Ovarian Cancer') })],
    });
    expect(codes(d)).toEqual(['error:pivotal-by-number', 'error:pivotal-wrong-disease']);
  });
});

describe("the product's form and the trial's", () => {
  // Opzelura (ruxolitinib cream) carried Jakafi's oral trials.
  const oral = trial({
    id: 'nct00509899', nctId: 'NCT00509899',
    title: 'A Phase 1/2, Open-Label Study of the JAK2 Inhibitor INCB018424 Administered Orally to Patients With Primary Myelofibrosis (PMF) and Post Polycythemia Vera/Essential Thrombocythemia Myelofibrosis (Post-PV/ET)',
    arms: [{ label: 'Ruxolitinib', description: 'All participants received oral ruxolitinib. Patients began treatment with either 10 mg twice a day (bid)' }],
  });
  const cream = trial({
    id: 'cream', title: 'Ruxolitinib Phosphate Cream in Plaque Psoriasis',
    arms: [{ label: 'Group A', description: 'Patients with active stable plaque psoriasis treated with topical cream application on lesions involving a small percent BSA.' }],
  });

  it('reads the forms', () => {
    expect([...productForms(['TOPICAL'])]).toEqual(['topical']);
    expect([...productForms(['SUBCUTANEOUS'])]).toEqual(['injected']);
    expect([...trialForms(oral)]).toEqual(['oral']);
    expect([...trialForms(cream)]).toEqual(['topical']);
    expect([...trialForms(trial({ title: 'Ruxolitinib Cream in Oral Lichen Planus' }))]).toEqual(['topical']);
  });

  it("catches an oral trial on a cream, and only that way round", () => {
    expect(codes(drug({ routes: ['TOPICAL'], trials: [oral, cream] }))).toEqual(['error:trial-form-mismatch']);
    // Dupixent's trials let patients use topical steroids alongside the injection.
    const withSteroids = trial({ id: 'liberty', title: 'Dupilumab With Concomitant Topical Corticosteroids in Atopic Dermatitis' });
    expect(codes(drug({ routes: ['SUBCUTANEOUS'], trials: [withSteroids] }))).toEqual([]);
    // Pritelivir is a tablet; LipP1 tested a pritelivir ointment.
    const lipP1 = trial({
      id: 'lipp1', acronym: 'LipP1',
      title: 'A Randomized, Double-blind, Multi-center, Three Arm (Pritelivir, Placebo and Zovirax®) Parallel Group, Comparative Trial to Assess the Efficacy and Safety of Pritelivir 5% w/w Ointment for the Treatment of Recurrent Herpes Labialis in Adults - LipP1',
      arms: [{ label: 'Pritelivir 5% w/w ointment', description: 'Topical treatment (20 applications), 5 times daily for 4 days' }, { label: 'Zovirax® cream' }],
    });
    expect(codes(drug({ inn: 'pritelivir', brandName: 'Hovilpri', routes: ['ORAL'], trials: [lipP1] }))).toEqual(['error:trial-form-mismatch']);
    expect(trialGivesDrugTopically(withSteroids, ['dupilumab', 'Dupixent'])).toBe(false);
    // No routes in the record yet: nothing to compare.
    expect(codes(drug({ trials: [oral] }))).toEqual([]);
  });
});

describe('a review role found by a word', () => {
  const role = [{ role: 'SUPPORTIVE' as const, provenance: review }];
  const d = drug({
    brandName: 'Dupixent', inn: 'dupilumab',
    trials: [
      trial({ id: 'dupilumab', acronym: 'DUPILUMAB', nctId: 'NCT07637292', sponsor: 'Hospices Civils de Lyon', conditions: ['Asthma Acute'], roles: role }),
      trial({ id: 'crswnp', acronym: 'CRSwNP', nctId: 'NCT05246267', sponsor: 'Montefiore Medical Center', conditions: ['Chronic Rhinosinusitis With Nasal Polyps'], roles: role }),
      trial({ id: 'via', acronym: 'VIA', nctId: 'NCT04380038', sponsor: 'University of Virginia', conditions: ['Atopic Dermatitis'], roles: role }),
      trial({ id: 'pathway', acronym: 'PATHWAY', nctId: 'NCT05073458', sponsor: 'Acme', conditions: ['Vitiligo'], roles: role }),
      trial({ id: 'liberty-ad-chronos', acronym: 'LIBERTY AD CHRONOS', sponsor: 'Acme', roles: role }),
    ],
  });

  it('errs on a drug or disease name, warns on a plain word, passes a real trial name', () => {
    expect(codes(d)).toEqual(['error:review-role-by-name', 'error:review-role-by-name', 'warn:review-role-by-word', 'warn:review-role-by-word']);
  });

  it('knows an abbreviation of a disease from a word', () => {
    expect(isAbbreviationOf('MDD', 'Major Depressive Disorder (MDD)')).toBe(true);
    expect(isAbbreviationOf('CRSwNP', 'Chronic Rhinosinusitis With Nasal Polyps')).toBe(true);
    expect(isAbbreviationOf('ADVANCE', 'Atopic Dermatitis')).toBe(false);
  });
});

describe('brand names and section 1 notes', () => {
  it('catches a brand cased or tagged unlike the label', () => {
    expect(codes(drug({ brandName: 'Rybrevant faspro' }))).toEqual(['error:brand-casing']);
    expect(codes(drug({ brandName: 'Lifyorli (copackaged)' }))).toEqual(['error:brand-casing']);
    expect(codes(drug({ brandName: 'Awiqli FlexTouch' }))).toEqual([]);
  });

  it("catches antibacterial labels' stewardship note listed as a use", () => {
    const d = drug({ indications: [{ name: 'Usage to Reduce Development of Drug-Resistant Bacteria', slug: 'usage' }] });
    expect(codes(d)).toEqual(['error:not-a-use']);
  });
});

describe("a use dated to an approval whose label doesn't list it", () => {
  it("reads section 1 of real labels", () => {
    const faspro = fixture('rybrevant-faspro-2025-label-section1.txt');
    expect(labelHasUse('Previously Treated HNSCC', faspro)).toBe(false);
    expect(labelHasUse('Previously Treated NSCLC with EGFR Exon 20 Insertion Mutations', faspro)).toBe(true);
    // A heading in other words ("1.5 Urothelial Carcinoma"), or shorter than
    // today's name, with section 1's text carrying the rest.
    const k2017 = fixture('keytruda-2017-label-section1.txt');
    expect(labelHasUse('Urothelial Cancer', k2017)).toBe(true);
    expect(labelHasUse('Microsatellite Instability-High or Mismatch Repair Deficient Cancer', k2017)).toBe(true);
    const k2016 = fixture('keytruda-2016-label-section1.txt');
    expect(labelHasUse('Head and Neck Squamous Cell Cancer', k2016)).toBe(true);
    expect(labelHasUse('Adjuvant Melanoma', k2016)).toBe(false);
    expect(labelHasUse('Urothelial Cancer', k2016)).toBe(false);
    // One use, no "1.1"; the age it covers widened later (2 years, then 3 months).
    expect(labelHasUse('Topical treatment of mild to moderate atopic dermatitis in adult and pediatric patients 3 months of age and older', fixture('eucrisa-2016-label-section1.txt'))).toBe(true);
    // Before 2006: one reworded sentence, judged by its disease.
    const elidel = fixture('elidel-2001-label-indications.txt');
    const elidelUse = 'As second-line therapy for the short-term and non-continuous chronic treatment of mild to moderate atopic dermatitis in non-immunocompromised adults and children 2 years of age and older';
    expect(labelHasUse(elidelUse, elidel, ['Dermatitis, Atopic'])).toBe(true);
    expect(labelHasUse('Psoriasis', elidel, ['Psoriasis'])).toBe(false);
    expect(labelHasUse('Atopic Dermatitis', 'Some other document')).toBeUndefined();
  });

  it("catches Rybrevant Faspro's head and neck use dated to the original approval, and skips without the text", () => {
    const labelUrl = 'http://www.accessdata.fda.gov/drugsatfda_docs/label/2025/761433s000lbl.pdf';
    const d = drug({
      indications: [{ name: 'Previously Treated HNSCC', slug: 'previously-treated-hnscc', approvalDate: { value: '2025-12-17', precision: 'day' }, submissionNumber: 'ORIG-1' }],
      sources: [{ id: 'doc-1', label: 'Label (ORIG-1)', url: labelUrl, type: 'fda_label' }],
    });
    const text = fixture('rybrevant-faspro-2025-label-section1.txt');
    expect(checkLabelDates(d, (u) => (u === labelUrl ? text : undefined)).map((f) => f.code)).toEqual(['dated-to-label-without-use']);
    expect(checkLabelDates(d, () => undefined)).toEqual([]);
  });
});
