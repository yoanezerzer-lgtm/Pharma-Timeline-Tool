import type { DateValue, Drug } from '../schema/index.js';
import { trialsForIndication } from './drugs.js';
import { drugStats, drugPendingChangeCount, type VerificationStats } from './review.js';
import { sameCompany } from './company.js';

/**
 * Everything the landing page and review index need about a drug, computed
 * at build time (see vite.config.ts) so those pages never download the full
 * records — which run to hundreds of KB each, mostly trials only the
 * indication and review pages ever show.
 */
export interface DrugSummary {
  slug: string;
  brandName: string;
  inn: string;
  sponsor: string;
  /**
   * The company to list the drug under: the name its label prints, else the
   * applicant's, with one spelling per company across all drugs (see
   * mergeCompanies).
   */
  company: string;
  /** The FDA office that reviews it, without "Office of" ("Oncologic Diseases"); unset when no letter names one. */
  office?: string;
  /** Therapeutic areas: the MeSH disease categories of its approved uses ("Neoplasms"), sorted. */
  areas: string[];
  firstApproval?: DateValue;
  modality: string;
  mechanism?: string;
  trialCount: number;
  indications: {
    name: string;
    displayName?: string;
    slug: string;
    approvalDate?: DateValue;
    trialCount: number;
    diseases: { meshId: string; term: string; inherited?: boolean }[];
  }[];
  verification: VerificationStats;
  /** Pivotal-trial facts in data/reference: how many the checker has confirmed against FDA documents. */
  checked: CheckStats;
  pendingChanges: number;
}

export interface CheckStats {
  confirmed: number;
  total: number;
}

export type CheckState = 'unchecked' | 'partial' | 'checked';

/** A drug counts as checked only once every pivotal-trial fact is confirmed; nothing confirmed is "not yet checked". */
export function checkState({ confirmed, total }: CheckStats): CheckState {
  if (confirmed === 0) return 'unchecked';
  return confirmed < total ? 'partial' : 'checked';
}

/** Counts a reference file's pivotal entries (an unparsed file: only these two fields are read). */
export function checkStats(ref: { pivotal?: { status?: string }[] } | undefined): CheckStats {
  const pivotal = ref?.pivotal ?? [];
  return { confirmed: pivotal.filter((p) => p.status === 'confirmed').length, total: pivotal.length };
}

export function summarize(drug: Drug, checked: CheckStats = { confirmed: 0, total: 0 }): DrugSummary {
  return {
    slug: drug.slug,
    brandName: drug.brandName,
    inn: drug.inn,
    sponsor: drug.sponsor,
    company: drug.regulatory.us.labelCompany?.name ?? drug.regulatory.us.sponsor ?? drug.sponsor,
    office: drug.regulatory.us.reviewOffice?.name.replace(/^Office of /, ''),
    areas: [...new Set(drug.indications.flatMap((i) => (i.diseases ?? []).flatMap((d) => d.areas)))].sort(),
    firstApproval: firstApproval(drug),
    modality: drug.modality,
    mechanism: drug.mechanism,
    trialCount: drug.trials.length,
    indications: drug.indications.map((i) => ({
      name: i.name,
      displayName: i.displayName,
      slug: i.slug,
      approvalDate: i.approvalDate,
      trialCount: trialsForIndication(drug, i.name).length,
      diseases: (i.diseases ?? []).map((d) => ({ meshId: d.meshId, term: d.term, inherited: d.inherited })),
    })),
    verification: drugStats(drug),
    checked,
    pendingChanges: drugPendingChangeCount(drug),
  };
}

function firstApproval(drug: Drug): DateValue | undefined {
  const dates = [drug.regulatory.us.originalApprovalDate, ...drug.indications.map((i) => i.approvalDate)].filter(
    (d): d is DateValue => !!d
  );
  return dates.sort((a, b) => a.value.localeCompare(b.value))[0];
}

/** Commonest first, ties alphabetically, so the choice doesn't depend on file order. */
function commonest(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0][0];
}

/**
 * One spelling per company ("ABBVIE", "AbbVie Inc." → "AbbVie Inc."), using
 * the same test the pipeline uses to tell a sponsor's own trials apart. A
 * name a label printed beats openFDA's abbreviation of it.
 */
export function mergeCompanies<T extends { company: string; labelPrinted: boolean }>(drugs: T[]): string[] {
  const groups: number[][] = [];
  drugs.forEach((d, i) => {
    const g = groups.find((members) => members.some((j) => sameCompany(drugs[j].company, d.company)));
    if (g) g.push(i);
    else groups.push([i]);
  });
  const names: string[] = new Array(drugs.length);
  for (const members of groups) {
    const printed = members.filter((j) => drugs[j].labelPrinted).map((j) => drugs[j].company);
    const name = commonest(printed.length > 0 ? printed : members.map((j) => drugs[j].company));
    for (const j of members) names[j] = name;
  }
  return names;
}

/** Office names as letters print them differ in a comma ("Endocrinology, and Nephrology"); one spelling each. */
export function mergeAreas(areas: (string | undefined)[]): (string | undefined)[] {
  const key = (a: string) => a.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
  const byKey = new Map<string, string[]>();
  for (const a of areas) if (a) byKey.set(key(a), [...(byKey.get(key(a)) ?? []), a]);
  return areas.map((a) => a && commonest(byKey.get(key(a))!));
}
