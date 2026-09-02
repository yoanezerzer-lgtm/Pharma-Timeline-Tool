import type { CtgovStudy } from '../../scripts/ingest/ctgov.js';

/**
 * Fixture registry records for the dress rehearsal.
 *
 * These mirror the shape ClinicalTrials.gov v2 actually returns, trimmed to the
 * fields the pipeline reads.
 */
export function makeStudy(opts: {
  nctId: string;
  orgStudyId: string;
  acronym?: string;
  phases: string[];
  startDate: string;
  primaryCompletionDate?: string;
  completionDate?: string;
  enrollment: number;
  title: string;
  intervention?: string;
}): CtgovStudy {
  return {
    protocolSection: {
      identificationModule: {
        nctId: opts.nctId,
        acronym: opts.acronym,
        briefTitle: opts.title,
        officialTitle: opts.title,
        orgStudyIdInfo: { id: opts.orgStudyId },
        secondaryIdInfos: [],
      },
      statusModule: {
        overallStatus: 'COMPLETED',
        startDateStruct: { date: opts.startDate, type: 'ACTUAL' },
        primaryCompletionDateStruct: opts.primaryCompletionDate
          ? { date: opts.primaryCompletionDate, type: 'ACTUAL' }
          : undefined,
        completionDateStruct: opts.completionDate
          ? { date: opts.completionDate, type: 'ACTUAL' }
          : undefined,
      },
      sponsorCollaboratorsModule: { leadSponsor: { name: 'AbbVie' } },
      designModule: {
        phases: opts.phases,
        enrollmentInfo: { count: opts.enrollment, type: 'ACTUAL' },
        designInfo: {
          allocation: 'RANDOMIZED',
          interventionModel: 'PARALLEL',
          primaryPurpose: 'TREATMENT',
          maskingInfo: { masking: 'DOUBLE' },
        },
      },
      armsInterventionsModule: {
        interventions: [{ name: opts.intervention ?? 'Upadacitinib', type: 'DRUG' }],
        armGroups: [{ label: 'Upadacitinib 15 mg', type: 'EXPERIMENTAL' }],
      },
      eligibilityModule: {
        minimumAge: '18 Years',
        sex: 'ALL',
        healthyVolunteers: opts.phases.includes('PHASE1'),
      },
      outcomesModule: {
        primaryOutcomes: [{ measure: 'ACR20 response at Week 12' }],
        secondaryOutcomes: [{ measure: 'DAS28-CRP < 2.6 at Week 12' }],
      },
    },
  };
}

/**
 * Studies keyed by every identifier they can be looked up under, mimicking the
 * registry's `query.id` behaviour (NCT ID, sponsor protocol number, acronym).
 */
export const STUDIES_BY_IDENTIFIER: Record<string, CtgovStudy> = {};

function register(study: CtgovStudy, identifiers: string[]): void {
  for (const id of identifiers) STUDIES_BY_IDENTIFIER[id] = study;
}

// Named in label section 14 -> must come out PIVOTAL.
const selectCompare = makeStudy({
  nctId: 'NCT02629159', orgStudyId: 'M13-545', acronym: 'SELECT-COMPARE',
  phases: ['PHASE3'], startDate: '2015-12', primaryCompletionDate: '2017-11',
  completionDate: '2021-06', enrollment: 1629,
  title: 'Upadacitinib versus placebo and adalimumab in rheumatoid arthritis',
});
register(selectCompare, ['NCT02629159', 'M13-545', 'SELECT-COMPARE']);

const selectNext = makeStudy({
  nctId: 'NCT02675426', orgStudyId: 'M14-465', acronym: 'SELECT-NEXT',
  phases: ['PHASE3'], startDate: '2015-12', primaryCompletionDate: '2017-01',
  enrollment: 661, title: 'Upadacitinib in csDMARD inadequate responders',
});
register(selectNext, ['NCT02675426', 'M14-465', 'SELECT-NEXT']);

const selectMono = makeStudy({
  nctId: 'NCT02706951', orgStudyId: 'M13-549', acronym: 'SELECT-MONOTHERAPY',
  phases: ['PHASE3'], startDate: '2016-03', primaryCompletionDate: '2017-06',
  enrollment: 648, title: 'Upadacitinib monotherapy versus methotrexate',
});
register(selectMono, ['NCT02706951', 'M13-549', 'SELECT-MONOTHERAPY']);

const selectEarly = makeStudy({
  nctId: 'NCT02706873', orgStudyId: 'M13-542', acronym: 'SELECT-EARLY',
  phases: ['PHASE3'], startDate: '2016-03', enrollment: 947,
  title: 'Upadacitinib in methotrexate-naive rheumatoid arthritis',
});
register(selectEarly, ['NCT02706873', 'M13-542', 'SELECT-EARLY']);

const selectBeyond = makeStudy({
  nctId: 'NCT02706847', orgStudyId: 'M14-653', acronym: 'SELECT-BEYOND',
  phases: ['PHASE3'], startDate: '2016-03', enrollment: 499,
  title: 'Upadacitinib in bDMARD inadequate responders',
});
register(selectBeyond, ['NCT02706847', 'M14-653', 'SELECT-BEYOND']);

// Cited in the review but NOT in label section 14 -> supporting roles.
const balanceI = makeStudy({
  nctId: 'NCT01960855', orgStudyId: 'M13-537', acronym: 'BALANCE-I',
  phases: ['PHASE2'], startDate: '2013-10', enrollment: 276,
  title: 'Dose-ranging study of upadacitinib after anti-TNF failure',
});
register(balanceI, ['NCT01960855', 'M13-537', 'BALANCE-I']);

const balanceII = makeStudy({
  nctId: 'NCT02066389', orgStudyId: 'M13-550', acronym: 'BALANCE-II',
  phases: ['PHASE2'], startDate: '2014-02', enrollment: 300,
  title: 'Dose-ranging study of upadacitinib on background methotrexate',
});
register(balanceII, ['NCT02066389', 'M13-550', 'BALANCE-II']);

const phase1 = makeStudy({
  nctId: 'NCT01234567', orgStudyId: 'M13-838',
  phases: ['PHASE1'], startDate: '2012-09', enrollment: 56,
  title: 'Pharmacokinetics of upadacitinib in healthy volunteers',
});
register(phase1, ['NCT01234567', 'M13-838']);

/** Registered against the drug but cited nowhere in the approval package. */
export const registryOnly = makeStudy({
  nctId: 'NCT03569293', orgStudyId: 'M16-045', acronym: 'Measure Up 1',
  phases: ['PHASE3'], startDate: '2018-08', enrollment: 847,
  title: 'Upadacitinib in moderate to severe atopic dermatitis',
});

/** A study for a different drug entirely — must never be attributed to Rinvoq. */
export const otherDrugStudy = makeStudy({
  nctId: 'NCT09999999', orgStudyId: 'X99-999',
  phases: ['PHASE3'], startDate: '2016-01', enrollment: 100,
  title: 'A study of adalimumab', intervention: 'Adalimumab',
});

/** Everything the intervention search returns. */
export const ALL_REGISTERED: CtgovStudy[] = [
  selectCompare, selectNext, selectMono, selectEarly, selectBeyond,
  balanceI, balanceII, phase1, registryOnly,
];
