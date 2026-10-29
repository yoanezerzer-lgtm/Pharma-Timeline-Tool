import { describe, it, expect } from 'vitest';
import { labelDrugClass, pharmacology, pharmacologySections } from '../scripts/ingest/pharmacology.js';

// Shortened from Myqorzo's real label (diag/raw-text-aficamten): the table of
// contents lists the headings back to back, then the full sections follow.
const MYQORZO =
  'HIGHLIGHTS OF PRESCRIBING INFORMATION ----------------------INDICATIONS AND USAGE-------------------------- - MYQORZO is a cardiac myosin inhibitor indicated for the treatment of adults. ' +
  'FULL PRESCRIBING INFORMATION: CONTENTS* 12 CLINICAL PHARMACOLOGY 12.1 Mechanism of Action 12.2 Pharmacodynamics 12.3 Pharmacokinetics 12.5 Pharmacogenomics 13 NONCLINICAL TOXICOLOGY ' +
  'Reference ID: 5715575 <<<PAGE 2>>> FULL PRESCRIBING INFORMATION <<<PAGE 10>>> 12 CLINICAL PHARMACOLOGY 12.1 Mechanism of Action Aficamten is an allosteric and reversible inhibitor of cardiac myosin motor activity. ' +
  '12.2 Pharmacodynamics In SEQUOIA-HCM, reductions in LVOT-G were observed at 2 weeks after initiating treatment [see Pharmacokinetics (12.3)]. ' +
  'Reference ID: 5715575 <<<PAGE 11>>> 12.3 Pharmacokinetics Aficamten exposure increases dose proportionally following single doses of 1 mg to 75 mg. ' +
  '12.5 Pharmacogenomics CYP2C9 is polymorphic. 13 NONCLINICAL TOXICOLOGY 13.1 Carcinogenesis';
const label = { url: 'https://www.accessdata.fda.gov/label.pdf', submission: 'ORIG-1', text: MYQORZO };

describe('About this drug', () => {
  it('reads 12.1 to 12.3 word for word from the sections, not the table of contents', () => {
    const s = pharmacologySections(label);
    expect(s.map((x) => x.number)).toEqual(['12.1', '12.2', '12.3']);
    expect(s[0].text).toBe('Aficamten is an allosteric and reversible inhibitor of cardiac myosin motor activity.');
    expect(s[1].text).toBe('In SEQUOIA-HCM, reductions in LVOT-G were observed at 2 weeks after initiating treatment [see Pharmacokinetics (12.3)].');
    expect(s[2]).toMatchObject({ text: 'Aficamten exposure increases dose proportionally following single doses of 1 mg to 75 mg.', provenance: { page: 11 } });
  });

  it('finds a heading the PDF split mid-word', () => {
    const awiqli = { ...label, text: '12.3 Pharmaco kinetics Absorption Dose proportionality in total exposure was seen. 12.6 Immunogenicity The observed incidence' };
    expect(pharmacologySections(awiqli)[0]).toMatchObject({ number: '12.3', text: 'Absorption Dose proportionality in total exposure was seen.' });
  });

  it('takes the class from the Highlights statement, or from openFDA when it lists one', () => {
    expect(labelDrugClass(label, 'Myqorzo')?.name).toBe('cardiac myosin inhibitor');
    const pasatru = { ...label, text: 'PASATRU is a n activin signaling inhibitor indicated to reduce formation' };
    expect(labelDrugClass(pasatru, 'Pasatru')?.name).toBe('activin signaling inhibitor');
    const fromApi = pharmacology([label], 'Myqorzo', 'Cardiac Myosin Inhibitor [EPC]', 'https://api.fda.gov/x');
    expect(fromApi?.drugClass).toMatchObject({ name: 'Cardiac Myosin Inhibitor', provenance: { extractedBy: 'api' } });
  });

  it('leaves a gap when the label states no class', () => {
    expect(labelDrugClass({ ...label, text: 'Awiqli is indicated as an adjunct to diet and exercise' }, 'Awiqli')).toBeUndefined();
  });
});
