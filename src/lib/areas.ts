import areaFile from '../../data/areas/areas.json';
import type { DrugSummary } from './summary.js';

/**
 * Therapeutic areas as people use them ("Oncology", "Immunology"). The names
 * and each drug's areas were chosen by the owner (data/areas/areas.json);
 * areas with a `rule` are filled from official records instead.
 */
export interface Area {
  id: string;
  name: string;
  /** How a rule-based area is filled ("FDA orphan-drug status for the approved use"). */
  rule?: string;
}

export const AREAS: Area[] = areaFile.areas;

const byDrug = areaFile.drugs as Record<string, string[]>;

/** How the owner files a disease (data/areas/areas.json "diseases"), by MeSH id. */
interface DiseaseFiling {
  /** Areas every drug approved for this disease belongs to. */
  areas?: string[];
  /** Kept out of the "Genetic diseases" rule even though MeSH lists it as inherited. */
  notGenetic?: boolean;
}

const byDisease = (areaFile as { diseases?: Record<string, DiseaseFiling> }).diseases ?? {};

/** The areas the owner files a disease under (by MeSH id); empty when not filed. */
export function filedAreas(meshId: string): string[] {
  return byDisease[meshId]?.areas ?? [];
}

/** MeSH's category for inherited diseases, as shown on the disease list. */
export const INHERITED_CATEGORY = 'Congenital, Hereditary, and Neonatal Diseases and Abnormalities';

/** Whether a disease counts for "Genetic diseases": MeSH lists it as inherited and the owner hasn't excluded it. */
export function countsAsGenetic(x: { meshId: string; inherited?: boolean }): boolean {
  return !!x.inherited && !byDisease[x.meshId]?.notGenetic;
}

/**
 * A disease's MeSH categories as the site shows them: without the inherited
 * category when the owner has kept the disease out of "Genetic diseases".
 */
export function shownCategories(meshId: string, categories: string[]): string[] {
  return byDisease[meshId]?.notGenetic ? categories.filter((c) => c !== INHERITED_CATEGORY) : categories;
}

/**
 * A drug's areas, in the list's order: the owner-approved ones, plus the
 * rule-based ones its records qualify for ("Genetic diseases" when one of its
 * diseases is filed by MeSH as inherited, unless the owner excluded it), plus
 * the areas the owner files its diseases under (atopic dermatitis: Immunology).
 * Empty when not yet sorted.
 */
export function areasOfDrug(d: Pick<DrugSummary, 'slug' | 'indications'>): Area[] {
  const ids = new Set(byDrug[d.slug] ?? []);
  const diseases = d.indications.flatMap((i) => i.diseases);
  if (diseases.some(countsAsGenetic)) ids.add('genetic');
  for (const x of diseases) for (const a of byDisease[x.meshId]?.areas ?? []) ids.add(a);
  return AREAS.filter((a) => ids.has(a.id));
}
