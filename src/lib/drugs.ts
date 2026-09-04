import { Drug } from '../schema/index.js';
import type { Drug as DrugType, Trial, Indication, TrialRole } from '../schema/index.js';

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
    ...drug.trials.flatMap((t) => t.roles.map((r) => r.provenance)),
    ...drug.milestones.map((m) => m.provenance).filter((p) => p !== undefined),
  ];
  return provenances.length > 0 && provenances.every((p) => !p.verified);
}

export function getIndication(drug: DrugType, slug: string): Indication | undefined {
  return drug.indications.find((i) => i.slug === slug);
}

/** A trial's role for one specific indication, or undefined if it played no part in it. */
export function roleFor(trial: Trial, indicationName: string): TrialRole | undefined {
  return trial.roles.find((r) => r.indication === indicationName)?.role;
}

/** Every trial that was pivotal or supportive for this specific indication. */
export function trialsForIndication(drug: DrugType, indicationName: string): Trial[] {
  return drug.trials.filter((t) => t.roles.some((r) => r.indication === indicationName));
}

/**
 * A trial-wide summary role for display contexts that aren't indication-scoped
 * (the drug-level Gantt bar color, the "in filing at all" count). Prefers the
 * most significant role across every indication the trial supports; a trial
 * with no recorded role at all reads as `NOT_IN_FILING`, matching the old
 * single-role model's meaning for a trial never cited in any approval.
 */
const ROLE_RANK: TrialRole[] = [
  'PIVOTAL',
  'SUPPORTIVE',
  'DOSE_FINDING',
  'PK',
  'SAFETY',
  'POST_MARKETING',
  'NOT_IN_FILING',
  'UNKNOWN',
];

export function summaryRole(trial: Trial): TrialRole {
  if (trial.roles.length === 0) return 'NOT_IN_FILING';
  let best: TrialRole = 'UNKNOWN';
  for (const r of trial.roles) {
    if (ROLE_RANK.indexOf(r.role) < ROLE_RANK.indexOf(best)) best = r.role;
  }
  return best;
}
