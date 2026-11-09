import { describe, expect, it } from 'vitest';
import { severityOf, severityOfText } from '../src/lib/diseases.js';
import { approvalKindLabel } from '../src/lib/copy.js';

const use = (indication: string, ...texts: string[]) => ({
  indication,
  steps: texts.map((text) => ({ text, submissions: [], kind: 'new' as const })),
});

describe('severityOf', () => {
  it('reads the severity from the FDA wording', () => {
    expect(severityOf(use('Atopic Dermatitis', 'Atopic Dermatitis', 'Patients with moderate-to-severe atopic dermatitis (AD) aged ≥ 6 to < 12 years.'))).toBe('moderate-to-severe');
    expect(severityOf(use('For the topical treatment of adults and pediatric patients 2 years of age and older with mild to moderate atopic dermatitis.'))).toBe('mild-to-moderate');
    expect(severityOf(use('For treatment of moderate to severe atopic dermatitis.'))).toBe('moderate-to-severe');
  });

  it('says "not stated" rather than guess', () => {
    expect(severityOf(use('Atopic Dermatitis', 'Atopic Dermatitis'))).toBe('not-stated');
  });
});

describe('approvalKindLabel', () => {
  it('uses the industry terms', () => {
    expect(approvalKindLabel('new', 'ORIG-1')).toBe('Original approval');
    expect(approvalKindLabel('new', 'SUPPL-4')).toBe('New indication');
    expect(approvalKindLabel('expansion', 'SUPPL-12')).toBe('Label expansion');
    expect(approvalKindLabel('revision', 'SUPPL-3')).toBe('Indication revised');
  });
});

describe('severityOfText', () => {
  it('reads the first severity the FDA wording names, else none', () => {
    expect(severityOfText(['Moderate-to-severe atopic dermatitis in adults'])).toBe('moderate-to-severe');
    expect(severityOfText(['Mild to moderate atopic dermatitis'])).toBe('mild-to-moderate');
    expect(severityOfText(['Atopic dermatitis'])).toBe('not-stated');
  });
});
