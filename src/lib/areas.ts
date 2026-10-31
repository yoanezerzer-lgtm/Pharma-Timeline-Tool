import areaFile from '../../data/areas/areas.json';

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

/** The owner-approved areas of a drug, in the list's order; empty when not yet sorted. */
export function areasOfDrug(slug: string): Area[] {
  const ids = byDrug[slug] ?? [];
  return AREAS.filter((a) => ids.includes(a.id));
}
