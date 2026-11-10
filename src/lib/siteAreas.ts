import { drugIndex } from './catalog.js';
import { AREAS, areasOfDrug, filedAreas, type Area } from './areas.js';

/**
 * The site's own areas for a disease (Immunology), not MeSH's categories:
 * the owner's filing when there is one, else the areas every drug approved
 * for it shares, else any of their areas.
 */
export function siteAreas(disease: { meshId: string }): Area[] {
  // The owner's filing wins: a drug's other uses don't pull a disease into their areas (asthma isn't Immunology).
  const filed = filedAreas(disease.meshId);
  if (filed.length > 0) return AREAS.filter((a) => filed.includes(a.id));
  const drugs = drugIndex.filter((d) => d.indications.some((i) => i.diseases.some((x) => x.meshId === disease.meshId)));
  const lists = drugs.map((d) => areasOfDrug(d).filter((a) => a.id !== 'genetic' || drugs.length === 1));
  if (lists.length === 0) return [];
  const shared = lists[0].filter((a) => lists.every((l) => l.some((b) => b.id === a.id)));
  if (shared.length > 0) return shared;
  const all = new Map(lists.flat().map((a) => [a.id, a]));
  return [...all.values()];
}
