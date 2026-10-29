import { describe, it, expect } from 'vitest';
import { labelCompany, reviewOffice, signingOffice } from '../scripts/ingest/labelFacts.js';
import { sameCompany } from '../src/lib/company.js';
import { mergeAreas, mergeCompanies } from '../src/lib/summary.js';
import { shortIndication } from '../src/lib/drugs.js';

// Passages copied from the real documents (diag/raw-text-<slug> branches).
const RINVOQ_S007 =
  'Sincerely, {See appended electronic signature page} Deputy Director Division of Gastroenterology Office of Immunology and Inflammation Office of New Drugs Center for Drug Evaluation and Research ENCLOSURE(S):';
const RINVOQ_ORIG =
  'Sincerely, {See appended electronic signature page} Mary Thanh Hai, MD Acting Director Office of Drug Evaluation II Office of New Drugs Center for Drug Evaluation and Research';
const COPPER =
  'Christine P. Nguyen, MD Deputy Director Office of Rare Diseases, Pediatrics, Urologic and Reproductive Medicine Office of New Drug Center for Drug Evaluation and Research';
const RUSFERTIDE =
  'Sincerely, {See appended electronic signature page} Lisa Yanoff, MD Deputy Director for Clinical Science Center for Drug Evaluation and Research ENCLOSURES:';

const doc = (submission: string, text: string) => ({ url: `https://www.accessdata.fda.gov/${submission}.pdf`, submission, text });

describe('FDA review office', () => {
  it('reads the clinical office from the signature, not the division or Office of New Drugs', () => {
    expect(signingOffice(RINVOQ_S007)?.office).toBe('Office of Immunology and Inflammation');
    expect(signingOffice(COPPER)?.office).toBe('Office of Rare Diseases, Pediatrics, Urologic and Reproductive Medicine');
  });

  it('names none when the letter is signed above the office level', () => {
    expect(signingOffice(RUSFERTIDE)).toBeUndefined();
    expect(signingOffice('Office of New Drugs Center for Drug Evaluation and Research')).toBeUndefined();
  });

  it('takes the newest letter that names an office, with the signature as its quote', () => {
    const fact = reviewOffice([doc('ORIG-1', RINVOQ_ORIG), doc('SUPPL-7', RINVOQ_S007), doc('SUPPL-9', RUSFERTIDE)]);
    expect(fact?.name).toBe('Office of Immunology and Inflammation');
    expect(fact?.provenance.sourceUrl).toContain('SUPPL-7');
    expect(RINVOQ_S007).toContain(fact!.provenance.quote!);
  });
});

describe('company on the label', () => {
  it('reads the applicant as printed, stopping at its legal suffix', () => {
    const keytruda = 'Manufactured for: Merck Sharp & Dohme LLC Rahway, NJ 07065, USA Manufactured by: MSD International';
    expect(labelCompany([doc('SUPPL-180', keytruda)], 'MERCK SHARP DOHME')?.name).toBe('Merck Sharp & Dohme LLC');
    const lilly = 'Manufactured by: Eli Lilly and Company Indianapolis, IN 46285, USA US License No';
    expect(labelCompany([doc('ORIG-1', lilly)], 'ELI LILLY AND CO')?.name).toBe('Eli Lilly and Company');
  });

  it('prefers "Distributed by" over a manufacturing site, and reads the newest label', () => {
    const azOld = 'Manufactured by: AstraZeneca AB Södertälje, Sweden';
    const azNew = 'Manufactured by: AstraZeneca AB Södertälje, Sweden SE-15185 Distributed by: AstraZeneca Pharmaceuticals LP, Wilmington, DE 19850';
    expect(labelCompany([doc('SUPPL-3', azNew), doc('ORIG-1', azOld)], 'ASTRAZENECA AB')?.name).toBe('AstraZeneca Pharmaceuticals LP');
  });

  it('gives nothing for a contract manufacturer, a partner, or a name it cannot end', () => {
    const veppanu = 'Manufactured by: Pfizer Inc New York, NY Distributed by: Arvinas Operations, Inc. New Haven, CT';
    expect(labelCompany([doc('ORIG-1', veppanu)], 'RIGEL PHARMS')).toBeUndefined();
    const gsk = 'Manufactured for GlaxoSmithKline Durham, NC 27701 Trademarks are owned by or licensed to the GSK group';
    expect(labelCompany([doc('ORIG-1', gsk)], 'GLAXOSMITHKLINE')).toBeUndefined();
  });
});

describe('sameCompany', () => {
  it('matches the names openFDA, the registry and labels use for one company', () => {
    expect(sameCompany('ABBVIE', 'AbbVie Inc.')).toBe(true);
    expect(sameCompany('MSD', 'Merck Sharp & Dohme LLC')).toBe(true);
    expect(sameCompany('TAKEDA PHARMS USA', 'Takeda Pharmaceuticals America, Inc.')).toBe(true);
    expect(sameCompany('AbbVie Inc.', 'Vanda Pharmaceuticals Inc.')).toBe(false);
  });
});

describe('one name per company and office on the home screen', () => {
  it('lists every spelling of a company under the one its labels print', () => {
    const names = mergeCompanies([
      { company: 'ABBVIE', labelPrinted: false },
      { company: 'AbbVie Inc.', labelPrinted: true },
      { company: 'Abbvie Inc.', labelPrinted: true },
      { company: 'AbbVie Inc.', labelPrinted: true },
      { company: 'Vanda Pharmaceuticals Inc.', labelPrinted: true },
    ]);
    expect(names).toEqual(['AbbVie Inc.', 'AbbVie Inc.', 'AbbVie Inc.', 'AbbVie Inc.', 'Vanda Pharmaceuticals Inc.']);
  });

  it('treats office names that differ only in a comma as one', () => {
    const a = 'Cardiology, Hematology, Endocrinology, and Nephrology';
    expect(mergeAreas([a, 'Cardiology, Hematology, Endocrinology and Nephrology', a, undefined])).toEqual([a, a, a, undefined]);
  });

  it('shortens a long indication by cutting the FDA wording, never rewording it', () => {
    expect(shortIndication({ name: 'Rheumatoid Arthritis' })).toBe('Rheumatoid Arthritis');
    const long = 'Hypertension, to lower blood pressure in adults who are not adequately controlled on other drugs';
    const short = shortIndication({ name: long });
    expect(short.endsWith('…')).toBe(true);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });
});
