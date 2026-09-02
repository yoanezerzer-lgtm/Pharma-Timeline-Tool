import { fetchJson } from './http.js';
import type { IngestContext } from './context.js';
import { toDateValue } from '../../src/lib/dates.js';
import type { Trial, Phase } from '../../src/schema/index.js';

const CTGOV_BASE = 'https://clinicaltrials.gov/api/v2/studies';

export interface CtgovDateStruct {
  date?: string;
  type?: string;
}

export interface CtgovStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      acronym?: string;
      briefTitle?: string;
      officialTitle?: string;
      orgStudyIdInfo?: { id?: string };
      secondaryIdInfos?: { id?: string; type?: string }[];
    };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: CtgovDateStruct;
      primaryCompletionDateStruct?: CtgovDateStruct;
      completionDateStruct?: CtgovDateStruct;
    };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    designModule?: {
      phases?: string[];
      enrollmentInfo?: { count?: number; type?: string };
      designInfo?: {
        allocation?: string;
        interventionModel?: string;
        primaryPurpose?: string;
        maskingInfo?: { masking?: string };
      };
    };
    armsInterventionsModule?: {
      interventions?: { name?: string; type?: string; otherNames?: string[] }[];
      armGroups?: { label?: string; type?: string; description?: string }[];
    };
    eligibilityModule?: {
      minimumAge?: string;
      maximumAge?: string;
      sex?: string;
      healthyVolunteers?: boolean;
    };
    outcomesModule?: {
      primaryOutcomes?: { measure?: string }[];
      secondaryOutcomes?: { measure?: string }[];
    };
  };
}

interface CtgovResponse {
  studies?: CtgovStudy[];
  totalCount?: number;
  nextPageToken?: string;
}

/**
 * Collapses ClinicalTrials.gov's phase array into a single lane.
 *
 * The registry reports a phase 1/2 study as ["PHASE1","PHASE2"], so the pair
 * has to be recognised rather than taking the first element.
 */
export function mapPhase(phases: string[] | undefined): Phase {
  if (!phases || phases.length === 0) return 'NA';
  const set = new Set(phases.map((p) => p.toUpperCase()));
  if (set.has('PHASE1') && set.has('PHASE2')) return 'PHASE1_2';
  if (set.has('PHASE2') && set.has('PHASE3')) return 'PHASE2_3';
  if (set.has('EARLY_PHASE1')) return 'EARLY_PHASE1';
  if (set.has('PHASE1')) return 'PHASE1';
  if (set.has('PHASE2')) return 'PHASE2';
  if (set.has('PHASE3')) return 'PHASE3';
  if (set.has('PHASE4')) return 'PHASE4';
  return 'NA';
}

/** Every identifier a study is known by — the join keys back to the review text. */
export function studyIdentifiers(study: CtgovStudy): string[] {
  const id = study.protocolSection?.identificationModule;
  const ids = [
    id?.nctId,
    id?.acronym,
    id?.orgStudyIdInfo?.id,
    ...(id?.secondaryIdInfos ?? []).map((s) => s.id),
  ];
  return ids.filter((s): s is string => !!s);
}

/** True when the study's interventions mention the drug, by INN or brand. */
export function studyMatchesDrug(study: CtgovStudy, names: string[]): boolean {
  const needles = names.map((n) => n.toLowerCase()).filter(Boolean);
  if (needles.length === 0) return false;
  const interventions = study.protocolSection?.armsInterventionsModule?.interventions ?? [];
  const haystack = interventions
    .flatMap((i) => [i.name, ...(i.otherNames ?? [])])
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  // Fall back to titles: some records name the drug only in the title.
  const idm = study.protocolSection?.identificationModule;
  haystack.push((idm?.briefTitle ?? '').toLowerCase(), (idm?.officialTitle ?? '').toLowerCase());
  return needles.some((n) => haystack.some((h) => h.includes(n)));
}

function slugifyId(study: CtgovStudy): string {
  const id = study.protocolSection?.identificationModule;
  const base = id?.acronym ?? id?.orgStudyIdInfo?.id ?? id?.nctId ?? 'trial';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Converts a registry record into a Trial, leaving role and narrative unset. */
export function studyToTrial(study: CtgovStudy, sourceUrl: string): Trial {
  const ps = study.protocolSection;
  const idm = ps?.identificationModule;
  const status = ps?.statusModule;
  const design = ps?.designModule;
  const elig = ps?.eligibilityModule;
  const outcomes = ps?.outcomesModule;

  const prov = (field: string) => [
    field,
    {
      sourceUrl,
      sourceLabel: 'ClinicalTrials.gov',
      extractedBy: 'api' as const,
      verified: false,
    },
  ];

  const enrollmentCount = design?.enrollmentInfo?.count;

  return {
    id: slugifyId(study),
    nctId: idm?.nctId,
    protocolNumber: idm?.orgStudyIdInfo?.id,
    acronym: idm?.acronym,
    title: idm?.officialTitle ?? idm?.briefTitle ?? 'Untitled study',
    briefTitle: idm?.briefTitle,
    phase: mapPhase(design?.phases),
    role: 'UNKNOWN',
    status: status?.overallStatus,
    sponsor: ps?.sponsorCollaboratorsModule?.leadSponsor?.name,

    startDate: toDateValue(status?.startDateStruct?.date),
    primaryCompletionDate: toDateValue(status?.primaryCompletionDateStruct?.date),
    completionDate: toDateValue(status?.completionDateStruct?.date),

    enrollment:
      enrollmentCount !== undefined
        ? {
            count: enrollmentCount,
            type: design?.enrollmentInfo?.type === 'ESTIMATED' ? 'ESTIMATED' : 'ACTUAL',
          }
        : undefined,

    design: {
      allocation: design?.designInfo?.allocation,
      masking: design?.designInfo?.maskingInfo?.masking,
      model: design?.designInfo?.interventionModel,
      primaryPurpose: design?.designInfo?.primaryPurpose,
    },

    population: {
      minAge: elig?.minimumAge,
      maxAge: elig?.maximumAge,
      sex: elig?.sex === 'FEMALE' || elig?.sex === 'MALE' ? elig.sex : 'ALL',
      healthyVolunteers: elig?.healthyVolunteers,
      keyCriteria: [],
    },

    arms: (ps?.armsInterventionsModule?.armGroups ?? []).map((a) => ({
      label: a.label ?? 'Arm',
      type: a.type,
      description: a.description,
    })),

    primaryEndpoints: (outcomes?.primaryOutcomes ?? [])
      .map((o) => o.measure)
      .filter((m): m is string => !!m),
    secondaryEndpoints: (outcomes?.secondaryOutcomes ?? [])
      .map((o) => o.measure)
      .filter((m): m is string => !!m),

    metPrimaryEndpoint: null,
    takeaways: [],
    limitations: [],
    publications: [],

    provenance: Object.fromEntries(
      ['phase', 'startDate', 'primaryCompletionDate', 'enrollment', 'design'].map(prov)
    ),
  };
}

/**
 * Resolves an arbitrary identifier via the registry's `query.id` field, which
 * searches NCT IDs, sponsor protocol numbers, secondary IDs, and acronyms.
 *
 * This is what lets the code resolver use a deliberately loose regex: a token
 * that is not a real study identifier simply returns nothing.
 */
/** The identifier-lookup URL. Shared with the test seeder. */
export function lookupByIdUrl(identifier: string): string {
  return `${CTGOV_BASE}?query.id=${encodeURIComponent(identifier)}&pageSize=5&format=json`;
}

/** The intervention-search URL for one page. Shared with the test seeder. */
export function searchByInterventionUrl(intervention: string, pageToken?: string): string {
  return (
    `${CTGOV_BASE}?query.intr=${encodeURIComponent(intervention)}` +
    `&pageSize=100&format=json${pageToken ? `&pageToken=${pageToken}` : ''}`
  );
}

export async function lookupById(
  ctx: IngestContext,
  identifier: string
): Promise<CtgovStudy[]> {
  const url = lookupByIdUrl(identifier);
  const body = await fetchJson<CtgovResponse>(url, { ctx, kind: 'ctgov-id' });
  return body?.studies ?? [];
}

/** Every registered study naming the drug as an intervention, paged through. */
export async function searchByIntervention(
  ctx: IngestContext,
  intervention: string
): Promise<CtgovStudy[]> {
  const studies: CtgovStudy[] = [];
  let pageToken: string | undefined;

  do {
    const url = searchByInterventionUrl(intervention, pageToken);
    const body = await fetchJson<CtgovResponse>(url, { ctx, kind: 'ctgov-search' });
    if (!body) break;
    studies.push(...(body.studies ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  return studies;
}

export function ctgovStudyUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${nctId}`;
}
