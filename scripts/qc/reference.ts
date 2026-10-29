import { z } from 'zod';
import type { Drug } from '../../src/schema/index.js';

/**
 * The reference set: facts about a drug that have been checked against the
 * FDA's own documents, kept apart from the pipeline's output so the output
 * can be scored against them. Every ingest run, and every change to the
 * pipeline, is measured here — accuracy on this set is what decides when the
 * human reviewer can step away.
 *
 * - `confirmed`: checked against the source (who did it is in `checkedBy`);
 *   a mismatch is a pipeline error and fails CI.
 * - `baseline`: what the pipeline produced when the entry was recorded, not
 *   yet checked. A mismatch is reported as a change to look at, not scored.
 */
export const RefStatus = z.enum(['confirmed', 'baseline']);

const Checked = {
  status: RefStatus,
  /** Who or what confirmed it, e.g. "approval letter, Claude review 2026-10". */
  checkedBy: z.string().optional(),
  note: z.string().optional(),
  /**
   * Baseline only: nights the overnight checker tried this fact and couldn't
   * confirm it. At STUCK_AFTER it stops being queued and waits for a person.
   */
  tries: z.number().int().nonnegative().optional(),
  /** The passages that confirmed it, each verified word for word against the source. */
  evidence: z.array(z.object({ sourceUrl: z.string(), quote: z.string(), page: z.number().optional() })).optional(),
};

const ReferenceIndication = z.object({
  name: z.string(),
  /** YYYY-MM-DD; null when the right answer is "no date can be proven". */
  approvalDate: z.string().nullable(),
  submission: z.string().nullable(),
  ...Checked,
});

const ReferencePivotal = z.object({
  indication: z.string(),
  /** NCT number, or the trial's id when it has none. */
  trial: z.string(),
  /** Whether the trial should be pivotal for this indication. */
  pivotal: z.boolean(),
  ...Checked,
});

export const Reference = z.object({
  slug: z.string(),
  indications: z.array(ReferenceIndication).default([]),
  pivotal: z.array(ReferencePivotal).default([]),
});
export type Reference = z.infer<typeof Reference>;

export interface RefResult {
  kind: 'approvalDate' | 'pivotal';
  key: string;
  status: z.infer<typeof RefStatus>;
  expected: string;
  actual: string;
  pass: boolean;
}

const trialKey = (t: Drug['trials'][number]) => t.nctId ?? t.id;

export function scoreAgainstReference(drug: Drug, ref: Reference): RefResult[] {
  const out: RefResult[] = [];
  for (const r of ref.indications) {
    const ind = drug.indications.find((i) => i.name === r.name);
    const expected = r.approvalDate ? `${r.approvalDate} (${r.submission})` : 'undated';
    const actual = !ind ? 'indication missing' : ind.approvalDate ? `${ind.approvalDate.value} (${ind.submissionNumber ?? '?'})` : 'undated';
    out.push({ kind: 'approvalDate', key: r.name, status: r.status, expected, actual, pass: expected === actual });
  }
  for (const r of ref.pivotal) {
    const t = drug.trials.find((x) => trialKey(x) === r.trial);
    const isPivotal = !!t?.roles.some((x) => x.indication === r.indication && x.role === 'PIVOTAL');
    out.push({
      kind: 'pivotal',
      key: `${r.indication} / ${r.trial}`,
      status: r.status,
      expected: r.pivotal ? 'pivotal' : 'not pivotal',
      actual: !t ? 'trial missing' : isPivotal ? 'pivotal' : 'not pivotal',
      pass: isPivotal === r.pivotal,
    });
  }
  return out;
}

/**
 * Records the pipeline's current answers as baseline entries, leaving every
 * confirmed entry exactly as it is — a snapshot never overwrites a checked
 * fact, the same rule as `verified` in merge.ts.
 */
export function snapshotReference(drug: Drug, existing?: Reference): Reference {
  const ref: Reference = existing ? structuredClone(existing) : { slug: drug.slug, indications: [], pivotal: [] };
  const confirmedInd = new Set(ref.indications.filter((r) => r.status === 'confirmed').map((r) => r.name));
  ref.indications = [
    ...ref.indications.filter((r) => r.status === 'confirmed'),
    ...drug.indications
      .filter((i) => !confirmedInd.has(i.name))
      .map((i) => ({
        name: i.name,
        approvalDate: i.approvalDate?.value ?? null,
        submission: i.submissionNumber ?? null,
        status: 'baseline' as const,
      })),
  ];
  const key = (indication: string, trial: string) => `${indication}\u0000${trial}`;
  const confirmedPiv = new Set(ref.pivotal.filter((r) => r.status === 'confirmed').map((r) => key(r.indication, r.trial)));
  const current = drug.trials.flatMap((t) =>
    t.roles
      .filter((r) => r.role === 'PIVOTAL' && r.indication)
      .map((r) => ({ indication: r.indication!, trial: trialKey(t), pivotal: true, status: 'baseline' as const }))
  );
  ref.pivotal = [
    ...ref.pivotal.filter((r) => r.status === 'confirmed'),
    ...current.filter((r) => !confirmedPiv.has(key(r.indication, r.trial))),
  ];
  return ref;
}
