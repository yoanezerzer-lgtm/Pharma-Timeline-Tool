import { fetchJson } from './http.js';
import type { IngestContext } from './context.js';
import { toDateValue } from '../../src/lib/dates.js';
import type { Milestone, MilestoneType, DateValue } from '../../src/schema/index.js';

const OPENFDA_BASE = 'https://api.fda.gov/drug/drugsfda.json';

interface ApplicationDoc {
  id?: string;
  url: string;
  date?: string;
  type?: string;
}

interface Submission {
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
  openfda?: { brand_name?: string[]; generic_name?: string[]; substance_name?: string[]; pharm_class_epc?: string[] };
  products?: {
    brand_name?: string;
    dosage_form?: string;
    route?: string;
    marketing_status?: string;
    active_ingredients?: { name?: string; strength?: string }[];
  }[];
  submissions?: Submission[];
}

/** openFDA reports submission dates as YYYYMMDD. */
function parseFdaDate(raw: string | undefined): DateValue | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  return toDateValue(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
}

/**
 * Maps an openFDA submission to a timeline milestone.
 *
 * Only approved submissions become milestones — a pending or withdrawn
 * supplement is not a date on the development timeline.
 */
function submissionToMilestone(
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

/** Salt and hydrate words FDA names carry and trial registries usually don't: "pritelivir mesylate". */
const SALT = /\s+(?:mono|di|tri|hemi|sesqui)?(?:mesylate|mesilate|hydrochloride|hydrobromide|fumarate|maleate|tartrate|bitartrate|citrate|besylate|tosylate|succinate|phosphate|sulfate|acetate|bromide|chloride|sodium|potassium|calcium|magnesium|meglumine|tromethamine|oxalate|malate|lactate|nitrate|benzoate|hydrate)\b.*$/i;

/**
 * The INN as trial registries write it, from FDA's name for the active
 * ingredient: without a salt ("pritelivir mesylate" → "pritelivir") or a
 * biologic's four-letter suffix ("risankizumab-rzaa" → "risankizumab").
 */
export function innOf(fdaName: string): string {
  return fdaName.toLowerCase().replace(/-[a-z]{4}$/, '').replace(SALT, '').trim();
}

/**
 * A combination's ingredients, one by one ("cefepime and zidebactam" →
 * cefepime, zidebactam): registries name a combination many ways
 * ("Cefepime-Zidebactam", "WCK 5222"), so trials are matched on all of
 * them together. A single-ingredient name gives nothing back.
 */
export function ingredientsOf(inn: string): string[] {
  const parts = inn.split(/,\s*|\s+and\s+/).filter(Boolean);
  return parts.length > 1 ? parts : [];
}

/** The name trials are matched on: a combination as "cefepime + zidebactam", every ingredient required (see ctgov.ts). */
export function trialMatchName(inn: string): string {
  const parts = ingredientsOf(inn);
  return parts.length > 0 ? parts.join(' + ') : inn;
}

/** The ClinicalTrials.gov search for a drug: every ingredient of a combination must appear ("cefepime AND zidebactam"). */
export function registrySearchTerm(inn: string): string {
  const parts = ingredientsOf(inn);
  return parts.length > 0 ? parts.join(' AND ') : inn;
}

/** "a", "a and b", "a, b and c": how FDA labels list a product's active ingredients. */
function listed(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The generic name of the approved product, every active ingredient
 * included: "ZAYNICH (cefepime and zidebactam)", not "cefepime". Each
 * ingredient FDA lists for the product is cut to its INN on its own (salts
 * and suffixes off, see innOf), so a salt word in the first ingredient no
 * longer drops the rest. Falls back to openFDA's generic_name, split on
 * "and" or commas ("DORAVIRINE, ISLATRAVIR"), when the product lists none.
 */
export function genericNameOf(application: DrugsFdaResult): string {
  const ingredients = (application.products?.[0]?.active_ingredients ?? []).map((a) => a.name ?? '').filter(Boolean);
  const raw = ingredients.length > 0 ? ingredients : application.openfda?.generic_name?.slice(0, 1) ?? [];
  const parts = raw.flatMap((n) => n.split(/\s*,\s*|\s+and\s+|\s*\+\s*/i)).map(innOf).filter(Boolean);
  return listed([...new Set(parts)]);
}

/** "KEYTRUDA" → "Keytruda"; a name already in mixed case is kept as written. */
/**
 * The brand as the label writes it: openFDA's capitals cased word by word
 * ("RYBREVANT FASPRO" → "Rybrevant Faspro"), without the FDA's trailing
 * product tag ("LIFYORLI (COPACKAGED)" → "Lifyorli"). A name already in mixed
 * case is kept as given.
 */
export function brandCase(name: string): string {
  const bare = name.replace(/\s*\([^()]*\)\s*$/, '').trim() || name.trim();
  if (bare !== bare.toUpperCase()) return bare;
  return bare.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * A drug's identity from its FDA application, for any field the spec leaves
 * blank: brand name and active ingredient from the approved product,
 * sponsor from the application, and the FDA's Established Pharmacologic
 * Class ("Programmed Death Receptor-1 Blocking Antibody") as its mechanism.
 * Modality is the application type, the one thing the record states plainly.
 */
export function identityFromApplication(
  spec: { brandName: string; inn: string; sponsor: string; modality: string; mechanism?: string; interventionNames: string[] },
  application: DrugsFdaResult,
  applicationType: 'NDA' | 'BLA' | 'ANDA'
): typeof spec {
  const product = application.products?.[0];
  const brandName = spec.brandName || (product?.brand_name ? brandCase(product.brand_name) : '');
  const inn = spec.inn || genericNameOf(application);
  const epc = application.openfda?.pharm_class_epc?.[0]?.replace(/\s*\[EPC\]$/, '');
  return {
    ...spec,
    brandName,
    inn,
    sponsor: spec.sponsor || application.sponsor_name || '',
    modality: spec.modality || (applicationType === 'BLA' ? 'Biologic (BLA)' : 'Drug (NDA)'),
    mechanism: spec.mechanism ?? epc,
    interventionNames:
      spec.interventionNames.filter(Boolean).length > 0 ? spec.interventionNames : [trialMatchName(inn), brandName].filter(Boolean),
  };
}
