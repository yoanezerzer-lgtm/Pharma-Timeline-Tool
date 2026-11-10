import type { Drug, Indication, Trial } from '../schema/index.js';
import type { DiseaseSummary } from './diseases.js';
import { shortIndication, trialShortName } from './drugs.js';

/**
 * Each page's title and description, as search engines and browser tabs
 * show them. Used at build time to write one HTML file per page (see
 * vite.config.ts) and in the browser when a reader moves between pages.
 * Descriptions are built from the record's own words (the FDA label, the
 * patient leaflet, MedlinePlus); nothing here is written for the page.
 */

export const SITE_NAME = 'Drug Development Timelines';

export interface PageMeta {
  title: string;
  description: string;
}

/** Cut at a word boundary; search engines show about 155 characters. */
export function clip(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,;:]+$/, '')}…`;
}

const withSite = (title: string) => `${title} | ${SITE_NAME}`;

export function homeMeta(): PageMeta {
  return {
    title: SITE_NAME,
    description:
      'Each FDA drug approval traced to the clinical trials behind it: dates, the FDA’s own wording and a source for every fact.',
  };
}

export function drugsMeta(): PageMeta {
  return {
    title: withSite('Drugs'),
    description: 'Every drug on the site in one sortable table: company, therapeutic area, what it is approved for and its first FDA approval.',
  };
}

export function notFoundMeta(): PageMeta {
  return { title: withSite('Page not found'), description: homeMeta().description };
}

export function aboutMeta(): PageMeta {
  return {
    title: withSite('About the data'),
    description:
      'Where every fact on this site comes from (FDA documents, ClinicalTrials.gov, MeSH, MedlinePlus, the NCI dictionary) and how each one is checked against its source.',
  };
}

export function diseasesMeta(): PageMeta {
  return {
    title: withSite('Diseases'),
    description: 'Every disease with an FDA-approved drug on this site in one sortable table: therapeutic area, approved drugs, first and latest FDA approval.',
  };
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const names = (drug: Pick<Drug, 'brandName' | 'inn'>) =>
  drug.brandName.toLowerCase() === drug.inn.toLowerCase() ? drug.brandName : `${drug.brandName} (${drug.inn})`;

export function drugMeta(drug: Pick<Drug, 'brandName' | 'inn' | 'indications' | 'pharmacology'>): PageMeta {
  const leaflet = drug.pharmacology?.patientSummary?.paragraphs.join(' ') || undefined;
  const uses = drug.indications.map((i) => shortIndication(i, 60));
  const fallback = uses.length
    ? `${names(drug)}: FDA-approved uses (${uses.join('; ')}), the clinical trials behind each approval, and how it works.`
    : `${names(drug)}: FDA approval history, clinical trials and how it works.`;
  return {
    title: withSite(`${names(drug)}: FDA approvals and clinical trials`),
    description: clip(leaflet ?? fallback),
  };
}

export function indicationMeta(drug: Pick<Drug, 'brandName' | 'inn'>, indication: Pick<Indication, 'name' | 'displayName'>): PageMeta {
  return {
    title: withSite(`${drug.brandName}, ${shortIndication(indication, 90)}: trials and FDA approval`),
    description: clip(`FDA-approved use of ${names(drug)}: ${sentence(indication.name)} The clinical trials behind this approval, with dates and sources.`),
  };
}

/** A trial's own page: its short name, the drug and the approved use it backs. */
export function trialMeta(
  drug: Pick<Drug, 'brandName' | 'inn'>,
  indication: Pick<Indication, 'name' | 'displayName'>,
  trial: Trial,
  siblings: readonly Trial[],
): PageMeta {
  const name = trialShortName(trial, siblings);
  const nct = trial.nctId && !name.includes(trial.nctId) ? ` (${trial.nctId})` : '';
  return {
    title: withSite(`${name}${nct}: ${drug.brandName} trial, ${shortIndication(indication, 70)}`),
    description: clip(`${sentence(trial.title)} A clinical trial of ${names(drug)}, with its dates, design and sources.`),
  };
}

export function diseaseMeta(disease: Pick<DiseaseSummary, 'name' | 'approvals'>): PageMeta {
  const brands = [...new Set(disease.approvals.map((a) => a.brandName))];
  return {
    title: withSite(`${disease.name}: FDA-approved drugs and approval timeline`),
    description: clip(
      `FDA approvals for ${disease.name}${brands.length ? `: ${brands.join(', ')}` : ''}. Each approval on a timeline, with the FDA’s wording and sources.`
    ),
  };
}

/** Sets the browser tab's title and the page description while a page is open. */
export function applyMeta(meta: PageMeta): void {
  if (typeof document === 'undefined') return;
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
}
