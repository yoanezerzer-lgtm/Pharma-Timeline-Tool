import { describe, expect, it } from 'vitest';
import { closeUp, patientSummary } from '../scripts/ingest/pharmacology.js';

const doc = (text: string) => ({ url: 'https://example.org/lbl.pdf', submission: 'ORIG-1', text });

describe('patient leaflet: "What is BRAND?"', () => {
  it('takes the answer word for word and stops at the next question (Myqorzo label)', () => {
    const text =
      'WHAT IS THE MYQORZO REMS? A Risk Evaluation and Mitigation Strategy (REMS) is a strategy. ' +
      'What Is MYQORZO (aficamten)? MYQORZO is a prescription medicine used to treat adults with symptomatic obstructive hypertrophic cardiomyopathy (oHCM). ' +
      'What Is the Most Serious Risk of Treatment With MYQORZO? In some patients, MYQORZO can cause heart failure.';
    expect(patientSummary(doc(text), 'Myqorzo')?.paragraphs).toEqual([
      'MYQORZO is a prescription medicine used to treat adults with symptomatic obstructive hypertrophic cardiomyopathy (oHCM).',
    ]);
  });
  it('keeps a list as separate lines and stops at "It is not known" (Beqalzi label)', () => {
    const text =
      'What is BEQALZI? BEQALZI is a prescription medicine used to treat adults with: • mantle cell lymphoma (MCL) that has come back or did not respond to previous treatment, and • who have already received at least 2 treatments for their cancer. It is not known if BEQALZI is safe and effective in children.';
    expect(patientSummary(doc(text), 'Beqalzi')?.paragraphs).toEqual([
      'BEQALZI is a prescription medicine used to treat adults with:',
      'mantle cell lymphoma (MCL) that has come back or did not respond to previous treatment, and',
      'who have already received at least 2 treatments for their cancer.',
    ]);
  });
  it('handles a two-word brand and a symbol-font bullet (Rybrevant Faspro, Exdensur)', () => {
    expect(
      patientSummary(doc('What is RYBREVANT FASPRO ? RYBREVANT FASPRO is a prescription medicine used to treat adults with non - small cell lung cancer ( NSCLC ) . Before you receive'), 'Rybrevant faspro')?.paragraphs
    ).toEqual(['RYBREVANT FASPRO is a prescription medicine used to treat adults with non-small cell lung cancer (NSCLC).']);
    expect(
      patientSummary(doc('What is EXDENSUR? EXDENSUR is a prescription medicine for severe asthma.  EXDENSUR helps prevent severe asthma attacks. It is not known'), 'Exdensur')?.paragraphs
    ).toEqual(['EXDENSUR is a prescription medicine for severe asthma.', 'EXDENSUR helps prevent severe asthma attacks.']);
  });
  it('leaves a gap when the leaflet is not in the label', () => {
    expect(patientSummary(doc('1 INDICATIONS AND USAGE ZAYNICH is indicated for…'), 'Zaynich')).toBeUndefined();
  });
  it('closes up only the spacing the PDF adds', () => {
    expect(closeUp('first - line ( COVID-19) type 2 , and')).toBe('first-line (COVID-19) type 2, and');
  });
});
