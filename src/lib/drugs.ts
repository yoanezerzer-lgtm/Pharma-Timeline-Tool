import type { Drug as DrugType, Trial, Indication, TrialRole, Milestone } from '../schema/index.js';

// Pure helpers only — no data loading here, so the build-time index in
// vite.config.ts can import this module too. Loading lives in catalog.ts.

export const ROLE_LABEL: Record<TrialRole, string> = {
  PIVOTAL: 'Pivotal',
  SUPPORTIVE: 'Supportive',
  DOSE_FINDING: 'Dose-finding',
  PK: 'Pharmacokinetics',
  SAFETY: 'Safety',
  POST_MARKETING: 'Post-marketing',
  NOT_IN_FILING: 'Not in original filing',
  UNKNOWN: 'Unclassified',
};

/** True when no field on the record has been human-verified yet. */
export function isFullyUnverified(drug: DrugType): boolean {
  const provenances = [
    ...drug.trials.flatMap((t) => Object.values(t.provenance)),
    ...drug.trials.flatMap((t) => t.roles.map((r) => r.provenance)),
    ...drug.milestones.map((m) => m.provenance).filter((p) => p !== undefined),
  ];
  return provenances.length > 0 && provenances.every((p) => !p.verified);
}

/** What to show for an indication: a person's short name if one was set, else the label's wording. */
export function indicationLabel(i: { name: string; displayName?: string }): string {
  return i.displayName || i.name;
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

/**
 * Filters out supplements that aren't a new approved use — labeling wording
 * changes, manufacturing (CMC) updates, and (confirmed against the real
 * Drugs@FDA "Supplements" table) even most "Efficacy" supplements, which
 * cover things like "Efficacy-New Patient Population" or "Efficacy-Labeling
 * Change With Clinical Data" — an existing indication's label being updated
 * with new trial data, not a new one being added. openFDA's own
 * `submission_class_code_description` (carried through as
 * `Milestone.description`) distinguishes exactly one class that means "this
 * added a new indication": "Efficacy-New Indication". A milestone with no
 * `description` at all (hand-authored seed data, or an openFDA record
 * missing the field) is kept rather than guessed at — there's no positive
 * signal here that it's noise.
 */
export function isMeaningfulMilestone(m: Milestone): boolean {
  if (m.type !== 'FDA_SUPPLEMENT') return true;
  if (!m.description) return true;
  return /new indication/i.test(m.description);
}
