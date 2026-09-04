import { describe, it, expect } from 'vitest';
import { categorizeEndpoint } from '../src/lib/endpoints.js';

describe('categorizeEndpoint', () => {
  it('tags a safety endpoint from real trial language', () => {
    expect(categorizeEndpoint('Number of Participants With Treatment-Emergent Adverse Events')).toBe(
      'SAFETY'
    );
    expect(categorizeEndpoint('Percentage of Participants With Serious Adverse Events')).toBe('SAFETY');
  });

  it('tags a pharmacokinetic endpoint', () => {
    expect(categorizeEndpoint('Maximum Plasma Concentration (Cmax) of Upadacitinib')).toBe('PK');
    expect(categorizeEndpoint('Area Under the Plasma Concentration-Time Curve (AUC)')).toBe('PK');
  });

  it('defaults to efficacy for an ordinary clinical response endpoint', () => {
    expect(categorizeEndpoint('Percentage of Participants Who Achieve an ACR20 Response at Week 12')).toBe(
      'EFFICACY'
    );
    expect(categorizeEndpoint('Change From Baseline in DAS28-CRP')).toBe('EFFICACY');
  });
});
