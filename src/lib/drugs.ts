import type { Drug as DrugType, Trial, Indication, TrialRole, Milestone, DateValue } from '../schema/index.js';

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

/** What to show for an indication: a person's short name if one was set, else the label's wording. */
export function indicationLabel(i: { name: string; displayName?: string }): string {
  return i.displayName || i.name;
}

/**
 * The indication in a few words for a list: a person's short name, else the
 * label's own heading when it is one ("Rheumatoid Arthritis"), else the
 * label's sentence cut at a word with "…". Always the FDA's words, never
 * reworded; the full wording goes in a tooltip and on the drug page.
 */
export function shortIndication(i: { name: string; displayName?: string }, max = 60): string {
  if (i.displayName) return i.displayName;
  if (i.name.length <= max) return i.name;
  const cut = i.name.slice(0, max + 1).replace(/[\s,;(]+\S*$/, '');
  return `${cut}…`;
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

/**
 * Whole months from the latest primary completion among an indication's
 * pivotal trials to that indication's approval: from the last patient's
 * primary-endpoint assessment to the decision. Undefined when either end is
 * missing or only known to the year, or when the primary completion falls
 * after approval (a long-term extension still running, not the data the
 * filing used).
 */
export function primaryCompletionToApprovalMonths(trials: Trial[], indicationName: string, approval?: DateValue): number | undefined {
  if (!approval || approval.precision === 'year') return undefined;
  const completions = trials
    .filter((t) => roleFor(t, indicationName) === 'PIVOTAL')
    .map((t) => t.primaryCompletionDate)
    .filter((d): d is DateValue => !!d && d.precision !== 'year' && d.value <= approval.value);
  if (completions.length === 0) return undefined;
  const last = completions.reduce((a, b) => (b.value > a.value ? b : a));
  const [ay, am] = approval.value.split('-').map(Number);
  const [ly, lm] = last.value.split('-').map(Number);
  return (ay - ly) * 12 + (am - lm);
}

/** A trial's short name: the registry acronym, else what the label calls it, else its protocol number. */
export function trialShortName(t: Pick<Trial, 'acronym' | 'labelName' | 'protocolNumber' | 'nctId' | 'id'>): string {
  return t.acronym ?? t.labelName ?? t.protocolNumber ?? t.nctId ?? t.id;
}
