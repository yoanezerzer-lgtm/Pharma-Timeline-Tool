import { describe, expect, it } from 'vitest';
import { letterCore, naturalTerm, readableDefinition } from '../src/lib/plainText.js';

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
