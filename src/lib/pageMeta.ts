import type { Drug, Indication } from '../schema/index.js';
import type { DiseaseSummary } from './diseases.js';
import { shortIndication } from './drugs.js';

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
      'How medicines were developed: clinical trial programs and regulatory milestones, traced from FDA approval packages.',
  };
}

export function diseasesMeta(): PageMeta {
  return {
    title: withSite('Diseases'),
    description: 'Every disease with an FDA-approved medicine on this site, with each approval and the FDA’s wording.',
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
