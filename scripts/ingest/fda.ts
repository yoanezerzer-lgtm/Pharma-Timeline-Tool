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
 * in general (multiple applications can share a brand across dosage forms and
 * sponsors). It's still the right fallback when the number isn't known up
 * front: see drugsFdaUrlByBrand below.
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

/**
 * The Drugs@FDA request URL for a brand name, when the application number
 * isn't known up front — the common case for a newly approved drug, where
 * a press release names the drug but not its NDA/BLA number.
 *
 * Searches `products.brand_name`, not `openfda.brand_name`. The `openfda.*`
 * fields are a *derived* cross-reference built from a separate labeling (SPL)
 * feed, which can lag days to weeks behind a fresh approval — confirmed
 * directly against Mimrylo, approved a week before this was first tried,
 * whose `openfda.brand_name` search came back empty even though the
 * application itself was already in Drugs@FDA. `products[].brand_name` is
 * part of the raw submission record and is populated at approval time.
 */
export function drugsFdaUrlByBrand(brandName: string): string {
  const search = encodeURIComponent(`products.brand_name:"${brandName}"`);
  return `${OPENFDA_BASE}?search=${search}&limit=1`;
}

/** Splits openFDA's own "NDA218330"-shaped application_number into its parts. */
function parseApplicationNumber(
  raw: string
): { type: 'NDA' | 'BLA' | 'ANDA'; number: string } | null {
  const m = /^(NDA|BLA|ANDA)(\d+)$/.exec(raw);
  return m ? { type: m[1] as 'NDA' | 'BLA' | 'ANDA', number: m[2] } : null;
}

export async function runFdaStage(
  ctx: IngestContext,
  applicationNumber: string | undefined,
  applicationType: 'NDA' | 'BLA' | 'ANDA' | undefined,
  brandName: string
): Promise<FdaStageResult> {
  const lookupUrl =
    applicationNumber && applicationType
      ? drugsFdaUrl(applicationType, applicationNumber)
      : drugsFdaUrlByBrand(brandName);

  const body = await fetchJson<{ results?: DrugsFdaResult[] }>(lookupUrl, {
    ctx,
    kind: 'openfda',
  });

  const application = body?.results?.[0];
  if (!application) {
    throw new Error(
      applicationNumber && applicationType
        ? `openFDA returned no application for ${applicationType}${applicationNumber}. ` +
          `Check the number, or the application may predate Drugs@FDA coverage.`
        : `openFDA returned no application for brand name "${brandName}". Check the spelling, ` +
          `or add the exact applicationNumber/applicationType to the registry entry instead.`
    );
  }

  // When we looked up by brand, recover the real application number/type
  // from the result — everything downstream (queryUrl, milestones) needs it.
  let resolvedNumber = applicationNumber;
  let resolvedType = applicationType;
  if (!resolvedNumber || !resolvedType) {
    const parsed = application.application_number
      ? parseApplicationNumber(application.application_number)
      : null;
    if (!parsed) {
      throw new Error(
        `openFDA found an application for brand name "${brandName}" but its own ` +
          `application_number ("${application.application_number ?? 'missing'}") didn't parse ` +
          `as NDA/BLA/ANDA + digits. Add applicationNumber/applicationType to the registry ` +
          `entry directly instead.`
      );
    }
    resolvedNumber = parsed.number;
    resolvedType = parsed.type;
  }
  const queryUrl =
    applicationNumber && applicationType ? lookupUrl : drugsFdaUrl(resolvedType, resolvedNumber);

  const submissions = application.submissions ?? [];
  const milestones = submissions
    .map((s) => submissionToMilestone(s, resolvedType, queryUrl))
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
    applicationNumber: resolvedNumber,
    applicationType: resolvedType,
    milestones,
    documentUrls,
    queryUrl,
  };
}
