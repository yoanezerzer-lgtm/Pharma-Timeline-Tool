import { describe, it, expect } from 'vitest';
import { postedPrimaryResults, studyToTrial, type CtgovStudy } from '../scripts/ingest/ctgov.js';
import { withoutPostedResults } from '../scripts/ingest/run.js';

const study: CtgovStudy = {
  protocolSection: { identificationModule: { nctId: 'NCT02675426', acronym: 'SELECT-COMPARE' } },
  resultsSection: {
    outcomeMeasuresModule: {
      outcomeMeasures: [
        {
          type: 'PRIMARY',
          title: 'Percentage of Participants Achieving ACR20 Response at Week 12',
          timeFrame: 'Week 12',
          paramType: 'NUMBER',
          unitOfMeasure: 'percentage of participants',
          groups: [
            { id: 'OG000', title: 'Placebo' },
            { id: 'OG001', title: 'Upadacitinib 15 mg' },
          ],
          classes: [
            {
              categories: [
                {
                  measurements: [
                    { groupId: 'OG000', value: '36.4', lowerLimit: '32.7', upperLimit: '40.1' },
                    { groupId: 'OG001', value: '70.5' },
                  ],
                },
              ],
            },
          ],
          analyses: [{ groupIds: ['OG000', 'OG001'], pValue: '<0.001', statisticalMethod: 'Cochran-Mantel-Haenszel' }],
        },
        { type: 'SECONDARY', title: 'Change in DAS28-CRP', classes: [] },
      ],
    },
  },
};

describe('postedPrimaryResults', () => {
  it('copies primary outcomes verbatim and skips secondary ones', () => {
    const [outcome, ...rest] = postedPrimaryResults(study);
    expect(rest).toEqual([]);
    expect(outcome.title).toBe('Percentage of Participants Achieving ACR20 Response at Week 12');
    expect(outcome.groups).toEqual([
      { id: 'OG000', title: 'Placebo' },
      { id: 'OG001', title: 'Upadacitinib 15 mg' },
    ]);
    expect(outcome.measurements[0]).toMatchObject({ groupId: 'OG000', value: '36.4', lowerLimit: '32.7' });
    expect(outcome.analyses[0]).toMatchObject({ pValue: '<0.001', method: 'Cochran-Mantel-Haenszel' });
  });

  it('labels each measurement with its class and category when the outcome is broken down', () => {
    const broken: CtgovStudy = {
      resultsSection: {
        outcomeMeasuresModule: {
          outcomeMeasures: [
            {
              type: 'PRIMARY',
              title: 'Responders',
              groups: [{ id: 'OG000', title: 'Drug' }],
              classes: [{ title: 'Week 12', categories: [{ title: 'ACR50', measurements: [{ groupId: 'OG000', value: '45' }] }] }],
            },
          ],
        },
      },
    };
    expect(postedPrimaryResults(broken)[0].measurements[0].category).toBe('Week 12 — ACR50');
  });

  it('returns nothing for a study with no posted results', () => {
    expect(postedPrimaryResults({ protocolSection: {} })).toEqual([]);
  });
});

describe('studyToTrial posted results', () => {
  it('attaches posted results with their own provenance', () => {
    const trial = studyToTrial(study, 'https://clinicaltrials.gov/study/NCT02675426');
    expect(trial.postedResults).toHaveLength(1);
    expect(trial.provenance.postedResults).toMatchObject({
      sourceUrl: 'https://clinicaltrials.gov/study/NCT02675426?tab=results',
      extractedBy: 'api',
      verified: false,
    });
  });

  it('can be stripped back off, provenance included', () => {
    const stripped = withoutPostedResults(studyToTrial(study, 'https://clinicaltrials.gov/study/NCT02675426'));
    expect(stripped).not.toHaveProperty('postedResults');
    expect(stripped.provenance).not.toHaveProperty('postedResults');
  });
});
