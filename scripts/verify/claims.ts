import { z } from 'zod';
import type { Drug, Trial } from '../../src/schema/index.js';
import { runByApplicant } from '../ingest/roles.js';
import { getSpec } from '../ingest/registry.js';
import type { Reference } from '../qc/reference.js';
import { checkQuote, findPassages, type Passage, type SourceDoc } from './sources.js';

/**
 * One night's verification work. Code decides what to check and finds the
 * passages; the agent only reads them and answers; code then checks every
 * answer before anything is recorded. See docs/agents/nightly-verify.md.
 */

export interface DrugContext {
  drug: Drug;
  ref: Reference;
  sources: SourceDoc[];
}

export interface Claim {
  id: string;
  drug: string;
  indication: string;
  /** Reference key: NCT number, or the trial id when it has none. */
  trial: string;
  trialName: string;
  question: string;
  registry: { phase: string; studyType?: string; sponsor?: string; applicant: string };
  passages: Passage[];
}

/** Which claims are planted false ones. Written apart from the queue; the agent never reads it. */
export type AnswerKey = Record<string, 'real' | 'decoy'>;

export const Verdict = z.object({
  claim: z.string(),
  verdict: z.enum(['supported', 'contradicted', 'unclear']),
  evidence: z.array(z.object({ sourceUrl: z.string(), quote: z.string() })).default([]),
  reason: z.string().default(''),
});
export type Verdict = z.infer<typeof Verdict>;

const trialKey = (t: Trial) => t.nctId ?? t.id;
const trialName = (t: Trial) => t.acronym ?? t.labelName ?? t.nctId ?? t.id;

/** Small seeded generator, so a night's queue is reproducible from its date. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Whole drugs at a time, so each night finishes some drugs rather than
 * leaving all of them part-checked: first drugs with nothing confirmed yet,
 * then those with the fewest entries left. Ties fall in a random order seeded
 * by the date, so one stuck drug doesn't hold the same place every night.
 */
function byDrugPriority<T extends { ctx: DrugContext }>(items: T[], rand: () => number): T[] {
  const groups = new Map<DrugContext, T[]>();
  for (const x of shuffle(items, rand)) groups.set(x.ctx, [...(groups.get(x.ctx) ?? []), x]);
  const confirmed = (ctx: DrugContext) => ctx.ref.pivotal.some((r) => r.status === 'confirmed');
  return [...groups.entries()]
    .sort(([a, xs], [b, ys]) => Number(confirmed(a)) - Number(confirmed(b)) || xs.length - ys.length)
    .flatMap(([, xs]) => xs);
}

function claimFor(ctx: DrugContext, trial: Trial, indication: string, id: string): Claim {
  return {
    id,
    drug: ctx.drug.slug,
    indication,
    trial: trialKey(trial),
    trialName: trialName(trial),
    question: `Was ${trialName(trial)} (${trialKey(trial)}) one of the trials the FDA approval of ${ctx.drug.brandName} for "${indication}" rested on?`,
    registry: {
      phase: trial.phase,
      studyType: trial.studyType,
      sponsor: trial.sponsor,
      applicant: ctx.drug.regulatory.us.sponsor ?? ctx.drug.sponsor,
    },
    passages: findPassages(trial, indication, ctx.sources),
  };
}

/**
 * Up to `limit` unchecked pivotal entries, drugs with nothing confirmed yet
 * first (see byDrugPriority), plus planted false claims (about
 * one in ten, at least two): a drug's real pivotal trial paired with another
 * of its indications it has no part in, or another drug's pivotal trial.
 * Both kinds must come back "not supported"; one that comes back supported
 * voids the whole night.
 */
export function buildQueue(contexts: DrugContext[], date: string, limit = 40): { queue: Claim[]; key: AnswerKey } {
  const rand = rng(date);
  const usable = contexts.filter((c) => c.sources.some((s) => s.kind === 'label'));
  const real: { ctx: DrugContext; trial: Trial; indication: string }[] = [];
  for (const ctx of usable) {
    for (const r of ctx.ref.pivotal) {
      if (r.status !== 'baseline' || !r.pivotal) continue;
      const trial = ctx.drug.trials.find((t) => trialKey(t) === r.trial);
      if (trial) real.push({ ctx, trial, indication: r.indication });
    }
  }
  const picked = byDrugPriority(real, rand).slice(0, limit);

  const decoys: typeof picked = [];
  const wanted = Math.max(2, Math.ceil(picked.length / 10));
  const pivotalTrials = usable.flatMap((ctx) =>
    ctx.drug.trials.filter((t) => t.roles.some((r) => r.role === 'PIVOTAL')).map((trial) => ({ ctx, trial }))
  );
  for (let tries = 0; decoys.length < wanted && tries < 200 && pivotalTrials.length > 0; tries++) {
    const { ctx, trial } = pivotalTrials[Math.floor(rand() * pivotalTrials.length)];
    const sameDrug = rand() < 0.7 || usable.length < 2;
    const target = sameDrug ? ctx : usable[Math.floor(rand() * usable.length)];
    if (!sameDrug && target === ctx) continue;
    const choices = target.drug.indications.filter((i) => !trial.roles.some((r) => r.indication === i.name));
    if (choices.length === 0) continue;
    const indication = choices[Math.floor(rand() * choices.length)].name;
    if (decoys.some((d) => d.trial === trial && d.indication === indication)) continue;
    // Only plant it if the documents don't name the trial in that indication's section 14 at all.
    if (findPassages(trial, indication, target.sources).some((p) => p.inIndicationSpan)) continue;
    decoys.push({ ctx: target, trial, indication });
  }

  const all = shuffle([...picked.map((x) => ({ ...x, decoy: false })), ...decoys.map((x) => ({ ...x, decoy: true }))], rand);
  const key: AnswerKey = {};
  const queue = all.map((x, i) => {
    const id = `c${String(i + 1).padStart(3, '0')}-${Math.floor(rand() * 1e6).toString(36)}`;
    key[id] = x.decoy ? 'decoy' : 'real';
    return claimFor(x.ctx, x.trial, x.indication, id);
  });
  return { queue, key };
}

const CONFIRMATORY_PHASES = new Set(['PHASE2', 'PHASE2_3', 'PHASE3']);

/** The registry's own facts agree: a sponsor-run, interventional Phase 2/3 study. */
function registryAgrees(trial: Trial, drug: Drug): boolean {
  return (
    CONFIRMATORY_PHASES.has(trial.phase) &&
    trial.studyType?.toUpperCase() !== 'OBSERVATIONAL' &&
    runByApplicant(trial, drug.regulatory.us.sponsor ?? drug.sponsor, getSpec(drug.slug)?.knownTrialSponsors)
  );
}

type Outcome = 'confirmed' | 'rejected' | 'disagreement' | 'unclear' | 'unanswered' | 'decoy-caught' | 'decoy-missed';

interface ClaimResult {
  claim: Claim;
  outcome: Outcome;
  detail: string;
  evidence: { sourceUrl: string; quote: string }[];
}

interface ApplyResult {
  results: ClaimResult[];
  /** True when a planted false claim came back supported; nothing was recorded. */
  voided: boolean;
  /** Reference files with this night's confirmations applied (unchanged when voided). */
  refs: Map<string, Reference>;
  spotCheck: ClaimResult[];
}

export function applyVerdicts(queue: Claim[], key: AnswerKey, verdicts: Verdict[], contexts: DrugContext[], date: string): ApplyResult {
  const byDrug = new Map(contexts.map((c) => [c.drug.slug, c]));
  const results: ClaimResult[] = queue.map((claim) => {
    const v = verdicts.find((x) => x.claim === claim.id);
    const ctx = byDrug.get(claim.drug)!;
    const trial = ctx.drug.trials.find((t) => trialKey(t) === claim.trial)!;
    if (!v) return { claim, outcome: 'unanswered', detail: 'No verdict given.', evidence: [] };

    if (key[claim.id] === 'decoy') {
      return v.verdict === 'supported'
        ? { claim, outcome: 'decoy-missed', detail: 'A planted false claim was answered "supported".', evidence: v.evidence }
        : { claim, outcome: 'decoy-caught', detail: `Planted false claim, answered "${v.verdict}".`, evidence: v.evidence };
    }
    if (v.verdict === 'unclear') return { claim, outcome: 'unclear', detail: v.reason || 'The agent could not tell.', evidence: v.evidence };

    const checks = v.evidence.map((e) => ({ e, c: checkQuote(e.quote, e.sourceUrl, trial, claim.indication, ctx.sources) }));
    const failed = checks.filter((x) => !x.c.ok).map((x) => (x.c.ok ? '' : x.c.reason));
    const valid = checks.flatMap((x) => (x.c.ok ? [{ ...x.e, check: x.c }] : []));
    const evidence = valid.map(({ sourceUrl, quote }) => ({ sourceUrl, quote }));

    if (v.verdict === 'contradicted') {
      return valid.length > 0
        ? { claim, outcome: 'disagreement', detail: v.reason, evidence }
        : { claim, outcome: 'rejected', detail: `Answered "contradicted" without a verifiable quote. ${failed.join('; ')}`, evidence: [] };
    }

    const inSpan = valid.some((x) => x.check.kind === 'label' && x.check.inIndicationSpan);
    const second = valid.some((x) => x.check.kind !== 'label') || registryAgrees(trial, ctx.drug);
    if (inSpan && second) {
      const how = valid.some((x) => x.check.kind !== 'label') ? 'label section 14 and an FDA review or letter' : 'label section 14 and the registry record';
      return { claim, outcome: 'confirmed', detail: `Confirmed by ${how}.`, evidence };
    }
    const why = [
      ...failed,
      ...(inSpan ? [] : [`no verified quote from the label's section 14 under "${claim.indication}"`]),
      ...(second ? [] : ['no second source: needs an FDA review or letter quote, or a sponsor-run Phase 2/3 registry record']),
    ];
    return { claim, outcome: 'rejected', detail: why.join('; '), evidence };
  });

  const voided = results.some((r) => r.outcome === 'decoy-missed');
  const refs = new Map(contexts.map((c) => [c.drug.slug, structuredClone(c.ref)]));
  const confirmed = results.filter((r) => r.outcome === 'confirmed');
  if (!voided) {
    for (const r of confirmed) {
      const entry = refs.get(r.claim.drug)!.pivotal.find((p) => p.indication === r.claim.indication && p.trial === r.claim.trial);
      // Only ever upgrades a baseline entry; a confirmed one is never touched.
      if (!entry || entry.status !== 'baseline') continue;
      entry.status = 'confirmed';
      entry.checkedBy = `Overnight agent ${date}: ${r.detail}`;
      entry.evidence = r.evidence;
    }
  }

  const rand = rng(`${date}-spot`);
  const spotCheck = voided ? [] : shuffle(confirmed, rand).slice(0, Math.ceil(confirmed.length / 10));
  return { results, voided, refs, spotCheck };
}

export function reportMarkdown(r: ApplyResult, date: string): string {
  const count = (o: Outcome) => r.results.filter((x) => x.outcome === o).length;
  const real = r.results.filter((x) => !x.outcome.startsWith('decoy'));
  const lines = [`# Overnight verification, ${date}`, ''];
  if (r.voided) {
    lines.push('**Voided:** a planted false claim came back "supported", so nothing from tonight was recorded.', '');
  }
  lines.push(
    `- Checked: ${real.length} facts`,
    `- Confirmed: ${count('confirmed')}${r.voided ? ' (discarded)' : ''}`,
    `- Disagreements: ${count('disagreement')}`,
    `- Couldn't tell: ${count('unclear')}`,
    `- Rejected by the quote checks: ${count('rejected')}`,
    `- Planted false claims caught: ${count('decoy-caught')} of ${count('decoy-caught') + count('decoy-missed')}`,
    ''
  );
  const section = (title: string, items: ClaimResult[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const x of items) {
      lines.push(`- **${x.claim.drug}** · ${x.claim.indication} · ${x.claim.trialName} (${x.claim.trial}): ${x.detail}`);
      for (const e of x.evidence) lines.push(`  > "${e.quote}" ([source](${e.sourceUrl}))`);
    }
    lines.push('');
  };
  section('Disagreements (the data may be wrong)', r.results.filter((x) => x.outcome === 'disagreement'));
  section('Missed planted claims', r.results.filter((x) => x.outcome === 'decoy-missed'));
  section('Spot check: please confirm these quotes support the fact', r.spotCheck);
  section("Couldn't tell", r.results.filter((x) => x.outcome === 'unclear'));
  section('Rejected by the quote checks', r.results.filter((x) => x.outcome === 'rejected'));
  return lines.join('\n');
}
