import { fetchJson } from './http.js';
import type { IngestContext } from './context.js';
import { toDateValue } from '../../src/lib/dates.js';
import type { Milestone, MilestoneType, DateValue } from '../../src/schema/index.js';

const OPENFDA_BASE = 'https://api.fda.gov/drug/drugsfda.json';

export interface ApplicationDoc {
  id?: string;
  url: string;
  date?: string;
  type?: string;
}

export interface Submission {
  submission_type?: string; // "ORIG" | "SUPPL"
  submission_number?: string;
  submission_status?: string; // "AP" (approved), "TA" (tentative approval)
  submission_status_date?: string; // "YYYYMMDD"
  submission_class_code?: string;
  submission_class_code_description?: string;
  application_docs?: ApplicationDoc[];
}

export interface DrugsFdaResult {
  application_number?: string;
  sponsor_name?: string;
  openfda?: { brand_name?: string[]; generic_name?: string[]; substance_name?: string[] };
  products?: { brand_name?: string; dosage_form?: string; marketing_status?: string }[];
  submissions?: Submission[];
}

/** openFDA reports submission dates as YYYYMMDD. */
export function parseFdaDate(raw: string | undefined): DateValue | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  return toDateValue(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
}

/**
 * Maps an openFDA submission to a timeline milestone.
 *
 * Only approved submissions become milestones — a pending or withdrawn
 * supplement is not a date on the development timeline.
 */
export function submissionToMilestone(
  s: Submission,
  applicationType: 'NDA' | 'BLA' | 'ANDA',
  sourceUrl: string
): Milestone | null {
  const date = parseFdaDate(s.submission_status_date);
  if (!date) return null;
  if (s.submission_status !== 'AP') return null;

  const isOriginal = s.submission_type === 'ORIG';
  const number = `${s.submission_type ?? 'SUPPL'}-${s.submission_number ?? '?'}`;

  const type: MilestoneType = isOriginal ? 'FDA_APPROVAL' : 'FDA_SUPPLEMENT';
  const description = s.submission_class_code_description;

  return {
    id: `fda-${number.toLowerCase()}`,
    type,
    region: 'US',
    date,
    label: isOriginal
      ? `FDA approval — original ${applicationType}`
      : `Supplement approved${description ? ` — ${description.toLowerCase()}` : ''}`,
    shortLabel: isOriginal ? 'FDA approval' : `+${description ?? 'supplement'}`,
    description,
    submissionNumber: number,
    provenance: {
      sourceUrl,
      sourceLabel: 'openFDA Drugs@FDA',
      extractedBy: 'api',
      verified: false,
    },
  };
}

export interface FdaStageResult {
  application: DrugsFdaResult;
  applicationNumber: string;
  applicationType: 'NDA' | 'BLA' | 'ANDA';
  milestones: Milestone[];
  /** Review and label PDFs from the original submission, for the docs stage. */
  documentUrls: { url: string; type: string; submission: string }[];
  queryUrl: string;
}

/**
 * Looks up an application in openFDA by application number.
 *
 * The application number is the stable key — brand-name search is ambiguous
 * (multiple applications share a brand across dosage forms and sponsors).
 */
/** The Drugs@FDA request URL for an application. Shared with the test seeder. */
export function drugsFdaUrl(
  applicationType: 'NDA' | 'BLA' | 'ANDA',
  applicationNumber: string
): string {
  const search = encodeURIComponent(
    `application_number:"${applicationType}${applicationNumber}"`
  );
  return `${OPENFDA_BASE}?search=${search}&limit=1`;
}

export async function runFdaStage(
  ctx: IngestContext,
  applicationNumber: string,
  applicationType: 'NDA' | 'BLA' | 'ANDA'
): Promise<FdaStageResult> {
  const queryUrl = drugsFdaUrl(applicationType, applicationNumber);

  const body = await fetchJson<{ results?: DrugsFdaResult[] }>(queryUrl, {
    ctx,
    kind: 'openfda',
  });

  const application = body?.results?.[0];
  if (!application) {
    throw new Error(
      `openFDA returned no application for ${applicationType}${applicationNumber}. ` +
        `Check the number, or the application may predate Drugs@FDA coverage.`
    );
  }

  const submissions = application.submissions ?? [];
  const milestones = submissions
    .map((s) => submissionToMilestone(s, applicationType, queryUrl))
    .filter((m): m is Milestone => m !== null)
    .sort((a, b) => a.date.value.localeCompare(b.date.value));

  // Reviews and labels are where the trial identifiers live.
  const documentUrls = submissions.flatMap((s) =>
    (s.application_docs ?? [])
      .filter((d) => d.url && /\.pdf$/i.test(d.url))
      .map((d) => ({
        url: d.url,
        type: d.type ?? 'Unknown',
        submission: `${s.submission_type ?? 'SUPPL'}-${s.submission_number ?? '?'}`,
      }))
  );

  return {
    application,
    applicationNumber,
    applicationType,
    milestones,
    documentUrls,
    queryUrl,
  };
}
