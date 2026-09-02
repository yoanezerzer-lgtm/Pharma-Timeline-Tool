import { Drug } from '../schema/index.js';
import type { Drug as DrugType } from '../schema/index.js';

/**
 * Loads every committed drug record at build time and validates it.
 *
 * Validation runs here as well as in CI so a malformed record fails loudly in
 * dev rather than rendering a half-empty page.
 */
const modules = import.meta.glob<{ default: unknown }>('../../data/drugs/*.json', {
  eager: true,
});

export const drugs: DrugType[] = Object.entries(modules)
  .map(([path, mod]) => {
    const result = Drug.safeParse(mod.default);
    if (!result.success) {
      throw new Error(
        `Invalid drug record ${path}:\n` +
          result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
    return result.data;
  })
  .sort((a, b) => a.brandName.localeCompare(b.brandName));

export function getDrug(slug: string): DrugType | undefined {
  return drugs.find((d) => d.slug === slug);
}

/** True when no field on the record has been human-verified yet. */
export function isFullyUnverified(drug: DrugType): boolean {
  const provenances = [
    ...drug.trials.flatMap((t) => Object.values(t.provenance)),
    ...drug.milestones.map((m) => m.provenance).filter((p) => p !== undefined),
  ];
  return provenances.length > 0 && provenances.every((p) => !p.verified);
}
