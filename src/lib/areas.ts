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

/**
 * A drug's areas, in the list's order: the owner-approved ones, plus the
 * rule-based ones its records qualify for ("Genetic diseases" when one of its
 * diseases is filed by MeSH as inherited). Empty when not yet sorted.
 */
export function areasOfDrug(d: Pick<DrugSummary, 'slug' | 'indications'>): Area[] {
  const ids = new Set(byDrug[d.slug] ?? []);
  if (d.indications.some((i) => i.diseases.some((x) => x.inherited))) ids.add('genetic');
  return AREAS.filter((a) => ids.has(a.id));
}
