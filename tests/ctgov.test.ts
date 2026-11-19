import { describe, it, expect } from 'vitest';
import { codeNamesFrom, postedPrimaryResults, studyIsTopical, studyMatchesDrug, studyToTrial, type CtgovStudy } from '../scripts/ingest/ctgov.js';
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

describe('codeNamesFrom', () => {
  const study = (interventions: { name: string; otherNames?: string[] }[]): CtgovStudy => ({
    protocolSection: { armsInterventionsModule: { interventions } },
  }) as CtgovStudy;

  it("takes development codes listed beside the drug's INN", () => {
    const studies = [
      study([{ name: 'Camizestrant', otherNames: ['AZD9833', 'camizestrant 75 mg'] }, { name: 'Palbociclib', otherNames: ['PD-0332991'] }]),
      study([{ name: 'AZD9833', otherNames: ['Camizestrant'] }]),
    ];
    expect(codeNamesFrom(studies, 'camizestrant')).toEqual(['AZD9833']);
  });

  it("ignores codes of other drugs in the same trial", () => {
    expect(codeNamesFrom([study([{ name: 'Letrozole', otherNames: ['CGS-20267'] }])], 'camizestrant')).toEqual([]);
  });

  it("takes a combination's code only from an intervention naming every ingredient", () => {
    const studies = [
      study([{ name: 'Doravirine/Islatravir', otherNames: ['MK-8591A'] }]),
      study([{ name: 'Doravirine', otherNames: ['MK-1439'] }, { name: 'Islatravir', otherNames: ['MK-8591'] }]),
    ];
    expect(codeNamesFrom(studies, 'doravirine + islatravir')).toEqual(['MK-8591A']);
  });

  it("skips a combination entry that lists another drug's code too (Incyte NCT04509700)", () => {
    const studies = [
      study([
        { name: 'Parsaclisib', otherNames: ['INCB050465'] },
        { name: 'parsaclisib + ruxolitinib', otherNames: ['INCB050465', 'INCB018424'] },
      ]),
      study([{ name: 'ruxolitinib cream', otherNames: ['INCB018424'] }]),
    ];
    expect(codeNamesFrom(studies, 'ruxolitinib')).toEqual(['INCB018424']);
  });
});

describe('studyIsTopical', () => {
  const study = (title: string, interventions: { name: string; description?: string }[]): CtgovStudy => ({
    protocolSection: { identificationModule: { briefTitle: title }, armsInterventionsModule: { interventions } },
  }) as CtgovStudy;

  it('tells a cream study from an oral one of the same ingredient (real Incyte records)', () => {
    expect(studyIsTopical(study('TRuE AD2 - An Efficacy and Safety Study of Ruxolitinib Cream in Adolescents and Adults With Atopic Dermatitis', [{ name: 'Ruxolitinib cream' }]))).toBe(true);
    expect(studyIsTopical(study('A Study of INCB018424 Phosphate Cream in Subjects With Vitiligo', [{ name: 'INCB018424' }]))).toBe(true);
    expect(studyIsTopical(study('Study of Ruxolitinib in Pancreatic Cancer Patients (Janus 1)', [{ name: 'Ruxolitinib', description: 'Ruxolitinib tablets taken by mouth' }]))).toBe(false);
    expect(studyIsTopical(study('COntrolled MyeloFibrosis Study With ORal JAK Inhibitor Treatment: The COMFORT-I Trial', [{ name: 'Ruxolitinib' }]))).toBe(false);
  });
});

describe('studyMatchesDrug', () => {
  const study = (interventions: string[], briefTitle = ''): CtgovStudy => ({
    protocolSection: { identificationModule: { briefTitle }, armsInterventionsModule: { interventions: interventions.map((name) => ({ name })) } },
  }) as CtgovStudy;

  it('needs every ingredient of a combination', () => {
    expect(studyMatchesDrug(study(['Cefepime-Zidebactam']), ['cefepime + zidebactam'])).toBe(true);
    expect(studyMatchesDrug(study(['Cefepime-Tazobactam']), ['cefepime + zidebactam'])).toBe(false);
    expect(studyMatchesDrug(study(['Doravirine', 'Lamivudine']), ['doravirine + islatravir'])).toBe(false);
    expect(studyMatchesDrug(study(['Dupilumab']), ['dupilumab'])).toBe(true);
  });
});
