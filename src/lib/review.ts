import type { Drug, Trial, Provenance } from '../schema/index.js';

/**
 * The review workflow's one job: let a person turn `verified: false` into
 * `verified: true` — confirming a pipeline-extracted value, or correcting it
 * first — without hand-editing JSON. Every function here is pure (old state
 * in, new state out) so the UI layer stays a thin wrapper and the logic is
 * testable without a DOM.
 */

export interface VerificationStats {
  verified: number;
  total: number;
}

function addStats(a: VerificationStats, b: VerificationStats): VerificationStats {
  return { verified: a.verified + b.verified, total: a.total + b.total };
}

/** Every provenance record attached to a trial: its own fields, plus each role's. */
export function trialProvenances(trial: Trial): Provenance[] {
  return [...Object.values(trial.provenance), ...trial.roles.map((r) => r.provenance)];
}

export function trialStats(trial: Trial): VerificationStats {
  const provs = trialProvenances(trial);
  return { verified: provs.filter((p) => p.verified).length, total: provs.length };
}

export function drugStats(drug: Drug): VerificationStats {
  return drug.trials.map(trialStats).reduce(addStats, { verified: 0, total: 0 });
}

/** The reviewable fields on a trial: whichever ones the pipeline actually tracked. */
export function reviewableFields(trial: Trial): string[] {
  return Object.keys(trial.provenance);
}

/** A trial field's current value, read generically by name. */
export function fieldValue(trial: Trial, field: string): unknown {
  return (trial as unknown as Record<string, unknown>)[field];
}

/** Flips a tracked field's verified flag without touching its value. */
export function setFieldVerified(trial: Trial, field: string, verified: boolean): Trial {
  const existing = trial.provenance[field];
  if (!existing) return trial;
  return {
    ...trial,
    provenance: { ...trial.provenance, [field]: { ...existing, verified } },
  };
}

/**
 * Records a human correction to a field's value. Correcting a value is
 * itself a form of verification — there is no "edited but still unverified"
 * state — so this always sets `extractedBy: 'human'` and `verified: true`.
 */
export function correctField(trial: Trial, field: string, value: unknown): Trial {
  const prior = trial.provenance[field];
  return {
    ...trial,
    [field]: value,
    provenance: {
      ...trial.provenance,
      [field]: { ...prior, extractedBy: 'human', verified: true },
    },
  };
}

/** Flips one role's verified flag without touching the role or indication it names. */
export function setRoleVerified(trial: Trial, roleIndex: number, verified: boolean): Trial {
  const roles = trial.roles.map((r, i) =>
    i === roleIndex ? { ...r, provenance: { ...r.provenance, verified } } : r
  );
  return { ...trial, roles };
}

/** Records a human correction to one role's indication/role value. */
export function correctRole(
  trial: Trial,
  roleIndex: number,
  patch: { indication?: string; role: Trial['roles'][number]['role'] }
): Trial {
  const roles = trial.roles.map((r, i) =>
    i === roleIndex
      ? {
          ...r,
          ...patch,
          provenance: { ...r.provenance, extractedBy: 'human' as const, verified: true },
        }
      : r
  );
  return { ...trial, roles };
}

/** Swaps one trial into a drug record by id — how an edited trial gets back into the whole. */
export function replaceTrial(drug: Drug, trialId: string, updated: Trial): Drug {
  return { ...drug, trials: drug.trials.map((t) => (t.id === trialId ? updated : t)) };
}

/** The file content the pipeline itself writes — keeps a reviewed file diff-clean. */
export function serializeDrug(drug: Drug): string {
  return JSON.stringify(drug, null, 2) + '\n';
}
