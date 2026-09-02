import type { Drug, Trial, Provenance } from '../../src/schema/index.js';

/**
 * Merges a freshly ingested record onto whatever is already committed.
 *
 * The governing rule: a field whose provenance says `verified: true` is never
 * overwritten. Re-running ingestion has to be safe, and it is only safe if it
 * cannot silently destroy a human correction — otherwise the first surprising
 * overwrite makes the whole dataset untrustworthy.
 *
 * Conflicts against verified values are reported, not applied.
 */

export interface Conflict {
  trialId: string;
  field: string;
  keptValue: unknown;
  incomingValue: unknown;
}

export interface MergeResult {
  drug: Drug;
  conflicts: Conflict[];
  addedTrials: string[];
  updatedTrials: string[];
  /** Trials in the existing record that the new run did not find. */
  droppedTrials: string[];
}

/** Fields on a Trial that ingestion may write, and that provenance can protect. */
const MERGEABLE_FIELDS = [
  'nctId',
  'protocolNumber',
  'acronym',
  'title',
  'briefTitle',
  'phase',
  'role',
  'status',
  'sponsor',
  'startDate',
  'primaryCompletionDate',
  'completionDate',
  'enrollment',
  'design',
  'population',
  'arms',
  'primaryEndpoints',
  'secondaryEndpoints',
] as const;

/** Human-authored fields ingestion never touches, verified or not. */
const HUMAN_ONLY_FIELDS = [
  'takeaways',
  'limitations',
  'resultsSummary',
  'metPrimaryEndpoint',
  'publications',
] as const;

function isVerified(p: Provenance | undefined): boolean {
  return p?.verified === true;
}

function mergeTrial(
  existing: Trial,
  incoming: Trial
): { trial: Trial; conflicts: Conflict[]; changed: boolean } {
  const merged: Trial = { ...existing };
  const conflicts: Conflict[] = [];
  let changed = false;

  for (const field of MERGEABLE_FIELDS) {
    const incomingValue = incoming[field];
    if (incomingValue === undefined) continue;

    const existingValue = existing[field];
    const same = JSON.stringify(existingValue) === JSON.stringify(incomingValue);

    if (isVerified(existing.provenance[field])) {
      // A person has signed off on this value. Keep it, and surface the
      // disagreement so someone can decide which source is wrong.
      if (!same) {
        conflicts.push({
          trialId: existing.id,
          field,
          keptValue: existingValue,
          incomingValue,
        });
      }
      continue;
    }

    if (!same) {
      (merged as Record<string, unknown>)[field] = incomingValue;
      changed = true;
    }
  }

  // Carry human-authored content forward untouched.
  for (const field of HUMAN_ONLY_FIELDS) {
    (merged as Record<string, unknown>)[field] = existing[field];
  }

  // Provenance: keep verified entries, take incoming for everything else.
  const provenance: Record<string, Provenance> = { ...incoming.provenance };
  for (const [field, prov] of Object.entries(existing.provenance)) {
    if (isVerified(prov)) provenance[field] = prov;
  }
  merged.provenance = provenance;

  return { trial: merged, conflicts, changed };
}

/** Matches trials across runs by any stable identifier, falling back to id. */
function trialKey(t: Trial): string {
  return (t.nctId ?? t.protocolNumber ?? t.acronym ?? t.id).toLowerCase();
}

export function mergeDrug(existing: Drug | null, incoming: Drug): MergeResult {
  if (!existing) {
    return {
      drug: incoming,
      conflicts: [],
      addedTrials: incoming.trials.map((t) => t.id),
      updatedTrials: [],
      droppedTrials: [],
    };
  }

  const existingByKey = new Map(existing.trials.map((t) => [trialKey(t), t]));
  const conflicts: Conflict[] = [];
  const addedTrials: string[] = [];
  const updatedTrials: string[] = [];
  const matchedKeys = new Set<string>();

  const trials: Trial[] = incoming.trials.map((inc) => {
    const key = trialKey(inc);
    const prior = existingByKey.get(key);
    if (!prior) {
      addedTrials.push(inc.id);
      return inc;
    }
    matchedKeys.add(key);
    const { trial, conflicts: c, changed } = mergeTrial(prior, inc);
    conflicts.push(...c);
    if (changed) updatedTrials.push(trial.id);
    return trial;
  });

  // Keep trials the new run did not return. A registry query that misses a
  // study should not delete curated work; the run reports them instead.
  const dropped = existing.trials.filter((t) => !matchedKeys.has(trialKey(t)));
  trials.push(...dropped);

  return {
    drug: {
      ...incoming,
      // Human-authored drug-level prose survives re-ingestion.
      summary: existing.summary || incoming.summary,
      trials,
    },
    conflicts,
    addedTrials,
    updatedTrials,
    droppedTrials: dropped.map((t) => t.id),
  };
}
