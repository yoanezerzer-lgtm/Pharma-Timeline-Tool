/**
 * Keeps the answer key and the work it grades apart, on every pull request:
 *
 * - A confirmed reference entry may not be changed or removed, unless the PR
 *   carries the `correct-reference` label (a person's call, never the
 *   overnight agent's).
 * - New confirmations go in a PR that touches nothing but data/reference/,
 *   so a pipeline change can never be graded against facts it just wrote.
 *
 *   tsx scripts/qc/guard.ts <base-ref>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Reference } from './reference.js';

type Entry = Reference['indications'][number] | Reference['pivotal'][number];

function entries(ref: Reference | undefined): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of ref?.indications ?? []) m.set(`indication:${e.name}`, e);
  for (const e of ref?.pivotal ?? []) m.set(`pivotal:${e.indication}:${e.trial}`, e);
  return m;
}

/** The answer itself, without who checked it or how. */
const answer = (e: Entry) => JSON.stringify('approvalDate' in e ? [e.approvalDate, e.submission] : [e.pivotal]);

export interface GuardInput {
  base: Map<string, Reference>;
  head: Map<string, Reference>;
  changedFiles: string[];
  allowCorrection: boolean;
}

export function guardReference({ base, head, changedFiles, allowCorrection }: GuardInput): string[] {
  const problems: string[] = [];
  const outsideReference = changedFiles.filter((f) => !f.startsWith('data/reference/'));
  for (const slug of new Set([...base.keys(), ...head.keys()])) {
    const before = entries(base.get(slug));
    const after = entries(head.get(slug));
    for (const [k, b] of before) {
      if (b.status !== 'confirmed') continue;
      const a = after.get(k);
      if (!allowCorrection && (!a || a.status !== 'confirmed' || answer(a) !== answer(b))) {
        problems.push(`${slug}: confirmed fact ${k} was ${a ? 'changed' : 'removed'}. Only a person can correct one (label the PR correct-reference).`);
      }
    }
    for (const [k, a] of after) {
      const b = before.get(k);
      if (a.status === 'confirmed' && b?.status !== 'confirmed' && outsideReference.length > 0) {
        problems.push(`${slug}: ${k} is newly confirmed in a PR that also changes ${outsideReference.slice(0, 3).join(', ')}. Confirm facts in a PR of their own.`);
      }
    }
  }
  return problems;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function main(): void {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error('Usage: tsx scripts/qc/guard.ts <base-ref>');
    process.exit(2);
  }
  const dir = 'data/reference';
  const parse = (s: string) => Reference.parse(JSON.parse(s));
  const base = new Map<string, Reference>();
  let baseFiles: string[] = [];
  try {
    baseFiles = git('ls-tree', '--name-only', `${baseRef}:${dir}`).split('\n').filter((f) => f.endsWith('.json'));
  } catch {
    // No reference set on the base branch yet.
  }
  for (const f of baseFiles) {
    base.set(f.replace(/\.json$/, ''), parse(git('show', `${baseRef}:${dir}/${f}`)));
  }
  const head = new Map<string, Reference>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    head.set(f.replace(/\.json$/, ''), parse(readFileSync(join(dir, f), 'utf8')));
  }
  const changedFiles = git('diff', '--name-only', `${baseRef}...HEAD`).split('\n').filter(Boolean);
  const problems = guardReference({ base, head, changedFiles, allowCorrection: process.env.ALLOW_REFERENCE_CORRECTION === 'true' });
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('Reference set guard: ok.');
}

if (process.argv[1]?.endsWith('guard.ts')) main();
