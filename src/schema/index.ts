import { z } from 'zod';

/**
 * How a value got into the dataset, and whether a human has checked it.
 *
 * Every non-trivial field carries this. It drives two things: the citation
 * shown in the UI, and the merge rule in the ingest pipeline — a field with
 * `verified: true` is never overwritten by a later ingest run.
 */
export const ExtractionMethod = z.enum([
  'api', // structured response from openFDA or ClinicalTrials.gov
  'regex', // matched out of a document's text layer
  'rule', // derived by a documented heuristic (e.g. named in label section 14)
  'seed', // placeholder authored by hand before the first real ingest run
  'human', // entered or corrected by a person
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

export const Provenance = z.object({
  sourceUrl: z.string().url().optional(),
  /** Human-readable source label, e.g. "Medical Review, NDA 211675". */
  sourceLabel: z.string().optional(),
  /** 1-indexed page in the source PDF, when the value came from one. */
  page: z.number().int().positive().optional(),
  /** Exact sentence the value was read from, for spot-checking. */
  quote: z.string().optional(),
  extractedBy: ExtractionMethod,
  verified: z.boolean().default(false),
});
export type Provenance = z.infer<typeof Provenance>;

/**
 * A date plus how precisely it is actually known.
 *
 * ClinicalTrials.gov frequently reports month-only or year-only dates. Storing
 * the precision lets the Gantt render a soft edge instead of implying a
 * specific day that the source never claimed.
 */
export const DatePrecision = z.enum(['day', 'month', 'year']);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const DateValue = z.object({
  /** ISO 8601 date. Month precision pads to -01, year precision to -01-01. */
  value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  precision: DatePrecision,
});
export type DateValue = z.infer<typeof DateValue>;

export const Phase = z.enum([
  'EARLY_PHASE1',
  'PHASE1',
  'PHASE1_2',
  'PHASE2',
  'PHASE2_3',
  'PHASE3',
  'PHASE4',
  'NA',
]);
export type Phase = z.infer<typeof Phase>;

/**
 * What part the trial played in the marketing application.
 *
 * `NOT_IN_FILING` covers trials that are registered against the drug but were
 * not cited in the approval package — later indications, investigator-initiated
 * studies, post-approval work. Keeping them visible but distinctly labelled is
 * what makes the difference between "the program" and "everything ever run".
 */
export const TrialRole = z.enum([
  'PIVOTAL',
  'SUPPORTIVE',
  'DOSE_FINDING',
  'PK',
  'SAFETY',
  'POST_MARKETING',
  'NOT_IN_FILING',
  'UNKNOWN',
]);
export type TrialRole = z.infer<typeof TrialRole>;

export const Arm = z.object({
  label: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
  enrollment: z.number().int().nonnegative().optional(),
});

export const Publication = z.object({
  title: z.string(),
  citation: z.string().optional(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  url: z.string().url().optional(),
});

export const Population = z.object({
  minAge: z.string().optional(),
  maxAge: z.string().optional(),
  sex: z.enum(['ALL', 'FEMALE', 'MALE']).optional(),
  healthyVolunteers: z.boolean().optional(),
  /** Short plain-language inclusion/exclusion points, not the full criteria block. */
  keyCriteria: z.array(z.string()).default([]),
  /** Free-text summary, e.g. "Adults with moderate-to-severe RA and inadequate response to MTX". */
  summary: z.string().optional(),
});

export const Design = z.object({
  allocation: z.string().optional(),
  masking: z.string().optional(),
  model: z.string().optional(),
  primaryPurpose: z.string().optional(),
});

export const Enrollment = z.object({
  count: z.number().int().nonnegative(),
  type: z.enum(['ACTUAL', 'ESTIMATED']).default('ACTUAL'),
});

export const Trial = z.object({
  /** Stable local id, used for routing and cross-references. */
  id: z.string().min(1),
  nctId: z
    .string()
    .regex(/^NCT\d{8}$/)
    .optional(),
  /** Sponsor protocol number as printed in the review, e.g. "M13-549". */
  protocolNumber: z.string().optional(),
  /** Trial acronym, e.g. "SELECT-NEXT". */
  acronym: z.string().optional(),
  title: z.string(),
  briefTitle: z.string().optional(),
  phase: Phase,
  role: TrialRole.default('UNKNOWN'),
  status: z.string().optional(),
  sponsor: z.string().optional(),
  /**
   * CT.gov's own classification: INTERVENTIONAL or OBSERVATIONAL. A trial
   * supporting a marketing application is definitionally interventional — an
   * observational registry, however drug-relevant, is not the evidence an
   * approval rests on. Used as a guard against misclassifying one as pivotal.
   */
  studyType: z.string().optional(),

  startDate: DateValue.optional(),
  primaryCompletionDate: DateValue.optional(),
  completionDate: DateValue.optional(),

  enrollment: Enrollment.optional(),
  design: Design.optional(),
  population: Population.optional(),
  arms: z.array(Arm).default([]),

  primaryEndpoints: z.array(z.string()).default([]),
  secondaryEndpoints: z.array(z.string()).default([]),

  /** Whether the trial met its primary endpoint. null when not established. */
  metPrimaryEndpoint: z.boolean().nullable().default(null),
  resultsSummary: z.string().optional(),

  /** Human-authored. Empty until someone writes them; the UI omits empty sections. */
  takeaways: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),

  publications: z.array(Publication).default([]),

  /** Per-field provenance, keyed by field name (e.g. "role", "startDate"). */
  provenance: z.record(z.string(), Provenance).default({}),
});
export type Trial = z.infer<typeof Trial>;

export const MilestoneType = z.enum([
  // United States
  'IND',
  'FIRST_IN_HUMAN',
  'END_OF_PHASE2',
  'NDA_SUBMISSION',
  'BLA_SUBMISSION',
  'PRIORITY_REVIEW',
  'BREAKTHROUGH_DESIGNATION',
  'FAST_TRACK',
  'ORPHAN_DESIGNATION',
  'ADCOM',
  'PDUFA',
  'FDA_APPROVAL',
  'FDA_SUPPLEMENT',
  'FDA_WITHDRAWAL',
  // European Union — defined so adding EMA later is additive, not a migration.
  // Nothing populates these yet.
  'MAA_SUBMISSION',
  'CHMP_OPINION',
  'EC_DECISION',
  'EU_EXTENSION',
]);
export type MilestoneType = z.infer<typeof MilestoneType>;

export const Region = z.enum(['US', 'EU', 'GLOBAL']);
export type Region = z.infer<typeof Region>;

export const Milestone = z.object({
  id: z.string().min(1),
  type: MilestoneType,
  region: Region,
  date: DateValue,
  label: z.string(),
  /** Compact label for the chart, where horizontal room is scarce. Falls back to `label`. */
  shortLabel: z.string().optional(),
  description: z.string().optional(),
  /** For supplements: what the submission was for. */
  indication: z.string().optional(),
  /** e.g. "SUPPL-12". */
  submissionNumber: z.string().optional(),
  provenance: Provenance.optional(),
});
export type Milestone = z.infer<typeof Milestone>;

export const USRegulatory = z.object({
  applicationNumber: z.string(),
  applicationType: z.enum(['NDA', 'BLA', 'ANDA']),
  sponsor: z.string().optional(),
  originalApprovalDate: DateValue.optional(),
  reviewDivision: z.string().optional(),
});

/** Defined but unpopulated. EMA ingestion is deliberately deferred. */
export const EURegulatory = z.object({
  procedureNumber: z.string().optional(),
  sponsor: z.string().optional(),
  maaSubmissionDate: DateValue.optional(),
  chmpOpinionDate: DateValue.optional(),
  ecDecisionDate: DateValue.optional(),
  authorisationType: z.string().optional(),
});

export const Source = z.object({
  id: z.string().min(1),
  label: z.string(),
  url: z.string().url(),
  type: z.enum(['fda_review', 'fda_label', 'fda_letter', 'registry', 'epar', 'publication', 'other']),
  retrievedAt: z.string().optional(),
});

export const Indication = z.object({
  name: z.string(),
  approvalDate: DateValue.optional(),
  submissionNumber: z.string().optional(),
});

export const Drug = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  brandName: z.string(),
  /** International nonproprietary name, e.g. "upadacitinib". */
  inn: z.string(),
  modality: z.string(),
  sponsor: z.string(),
  /** Mechanism of action, one line. */
  mechanism: z.string().optional(),
  atcCode: z.string().optional(),

  /** Human-authored development narrative. Empty until written. */
  summary: z.string().default(''),

  indications: z.array(Indication).default([]),
  regulatory: z.object({
    us: USRegulatory,
    eu: EURegulatory.optional(),
  }),

  trials: z.array(Trial).default([]),
  milestones: z.array(Milestone).default([]),
  sources: z.array(Source).default([]),

  /** ISO timestamp of the last successful ingest run. */
  lastIngestedAt: z.string().optional(),
});
export type Drug = z.infer<typeof Drug>;

/** Parse and validate a drug record, throwing a readable error on bad data. */
export function parseDrug(input: unknown): Drug {
  return Drug.parse(input);
}
