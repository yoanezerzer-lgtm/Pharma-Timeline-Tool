import { describe, expect, it } from 'vitest';
import { letterCore, naturalTerm, readableDefinition, withoutPageFooters } from '../src/lib/plainText.js';

describe('naturalTerm', () => {
  it('reads an inverted MeSH heading in natural order', () => {
    expect(naturalTerm('Carcinoma, Non-Small-Cell Lung')).toBe('Non-Small-Cell Lung Carcinoma');
    expect(naturalTerm('Hepatitis B, Chronic')).toBe('Chronic Hepatitis B');
    expect(naturalTerm('Melanoma')).toBe('Melanoma');
  });
});

describe('readableDefinition', () => {
  it('lower-cases cross-references, keeps abbreviations and drops the citation (MeSH D020162, D000130)', () => {
    expect(
      readableDefinition(
        'It is caused by a deficiency of the hepatic enzyme ARGINASE. Arginine is elevated, and periodic HYPERAMMONEMIA may occur. (From Hum Genet 1993 Mar;91(1):1-5; Menkes, Textbook of Child Neurology, 5th ed, p51)'
      )
    ).toBe('It is caused by a deficiency of the hepatic enzyme arginase. Arginine is elevated, and periodic hyperammonemia may occur.');
    expect(readableDefinition('INFLAMMATION of the LIVER in humans caused by HEPATITIS B VIRUS lasting six months.')).toBe(
      'Inflammation of the liver in humans caused by hepatitis B virus lasting six months.'
    );
    expect(readableDefinition('A subclass of DIABETES MELLITUS that is not INSULIN-responsive or dependent (NIDDM).')).toBe(
      'A subclass of diabetes mellitus that is not insulin-responsive or dependent (NIDDM).'
    );
    expect(readableDefinition('Associated with defects in DNA MISMATCH REPAIR.')).toBe('Associated with defects in DNA mismatch repair.');
  });
});

describe('letterCore', () => {
  const keytruda = ['Keytruda', 'pembrolizumab', 'KEYTRUDA'];
  it('drops the opening paperwork of real approval letters', () => {
    expect(
      letterCore(
        'This Prior Approval supplemental biologics application adds a new indication for the adjuvant treatment of patients with melanoma with involvement of lymph node(s) following complete resection.',
        keytruda
      )
    ).toBe('For the adjuvant treatment of patients with melanoma with involvement of lymph node(s) following complete resection.');
    expect(
      letterCore(
        'This Prior Approval supplemental biologics application adds a new indication for KEYTRUDA, as a single agent, for the first-line treatment of patients with stage III non-small cell lung cancer.',
        keytruda
      )
    ).toBe('As a single agent, for the first-line treatment of patients with stage III non-small cell lung cancer.');
    expect(
      letterCore('This NDA provides for the use of Zanvastro (zilganersen) injection for the treatment of Alexander disease in pediatric and adult patients.')
    ).toBe('For the treatment of Alexander disease in pediatric and adult patients.');
  });
  it('drops the legal tail of a revision', () => {
    expect(
      letterCore(
        'These Prior Approval supplemental biologics applications provide for modifications of the approved indication for the treatment of patients with unresectable or metastatic melanoma approved on September 4, 2014, under the provisions of 21 CFR 601.70, to remove the following language',
        keytruda
      )
    ).toBe('For the treatment of patients with unresectable or metastatic melanoma.');
  });
  it('leaves a sentence it does not recognise unchanged', () => {
    const s = 'These Prior Approval sBLAs provide for: BLA 761105/S-044: the use of risankizumab 55 mg/0.37 mL pre-filled syringe.';
    expect(letterCore(s)).toBe(s);
  });
});

describe('letterCore: supplement letters for a new patient population', () => {
  it('cuts "proposes a new patient population:"', () => {
    expect(
      letterCore(
        'This Prior Approval supplemental biologics application proposes a new patient population: patients 12 to less than18 years of age with moderate-to-severe atopic dermatitis whose disease is not adequately controlled with topical prescription therapies or when those therapies are not advisable.',
      ),
    ).toBe(
      'Patients 12 to less than18 years of age with moderate-to-severe atopic dermatitis whose disease is not adequately controlled with topical prescription therapies or when those therapies are not advisable.',
    );
  });
  it('drops a postmarketing requirement listed after the use', () => {
    expect(
      letterCore(
        'This Prior Approval supplemental biologics application contains the final summary report for the following postmarketing requirement listed in the March 28, 2017 BLA approval letter and provides for a new patient population: patients with moderate-to-severe atopic dermatitis (AD) aged ≥ 6 to < 12 years. 3183-1 Conduct a randomized, double-blind, placebo-controlled study to investigate the efficacy.',
      ),
    ).toBe('Patients with moderate-to-severe atopic dermatitis (AD) aged ≥ 6 to < 12 years.');
  });
  it('cuts an age-range extension down to the quoted use', () => {
    expect(
      letterCore(
        'This Prior Approval supplemental biologics license application provides for an extension of the age range for the atopic dermatitis indication to allow for the “treatment of patients aged 6 months and older with moderate-to-severe atopic dermatitis whose disease is not adequately controlled with topical prescription therapies or when those therapies are not advisable.”',
      ),
    ).toBe(
      'Treatment of patients aged 6 months and older with moderate-to-severe atopic dermatitis whose disease is not adequately controlled with topical prescription therapies or when those therapies are not advisable.',
    );
  });
});

describe('withoutPageFooters', () => {
  it('removes page markers the PDF reader picked up mid-sentence', () => {
    expect(withoutPageFooters('has not been definitively established. Page 32 of 77')).toBe('has not been definitively established.');
    expect(withoutPageFooters('steady-state trough concentration Page 35 of 77 was 53.6')).toBe('steady-state trough concentration was 53.6');
    expect(withoutPageFooters('(Study 1) Reference ID: 5841185 Page 24 of 30 Study 2')).toBe('(Study 1) Study 2');
  });
});
