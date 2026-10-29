/**
 * Sorts a refresh's changes into routine ones, safe to publish once every
 * check passes, and ones a person should look at first.
 *
 *   npx tsx scripts/ingest/classify.ts <base-ref>
 *
 * Compares each changed data/drugs file with <base-ref>. Prints a short
 * report and ends with a line "routine=true" or "routine=false".
 *
 * Routine: registry updates to a trial's status, dates, size or text, newly
 * read document facts (review office, company, drug class, label sections)
 * and new source documents. Needs a look: an approved use or its date
 * changing, a trial's role changing, a trial added or dropped, a new FDA
 * milestone, or any change to data/reference.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Json = unknown;

const ROUTINE_DRUG_FIELDS = new Set(['lastIngestedAt', 'regulatory', 'pharmacology', 'sources', 'mechanism', 'modality']);
const REVIEW_TRIAL_FIELDS = new Set(['roles', 'nctId', 'id']);

const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

export function classifyDrug(before: Record<string, Json>, after: Record<string, Json>): { review: string[]; routine: string[] } {
  const review: string[] = [];
  const routine: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[key], after[key])) continue;
    if (key === 'trials') {
      const trials = (v: Json) => new Map(((v ?? []) as { id: string }[]).map((t) => [t.id, t as Record<string, Json>]));
      const [a, b] = [trials(before.trials), trials(after.trials)];
      for (const id of a.keys()) if (!b.has(id)) review.push(`trial dropped: ${id}`);
      for (const id of b.keys()) if (!a.has(id)) review.push(`trial added: ${id}`);
      for (const [id, t] of b) {
        const old = a.get(id);
        if (!old) continue;
        for (const field of new Set([...Object.keys(old), ...Object.keys(t)])) {
          if (same(old[field], t[field])) continue;
          (REVIEW_TRIAL_FIELDS.has(field) ? review : routine).push(`trial ${id}: ${field}`);
        }
      }
    } else {
      (ROUTINE_DRUG_FIELDS.has(key) ? routine : review).push(key);
    }
  }
  return { review, routine };
}

function main(): void {
  const base = process.argv[2] ?? 'origin/main';
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1e9 });
  const changed = git('diff', '--name-only', base, '--', 'data').split('\n').filter(Boolean);
  const lines: string[] = [];
  let routine = true;
  for (const file of changed) {
    if (!file.startsWith('data/drugs/')) {
      routine = false;
      lines.push(`- ${file}: changed (needs a look)`);
      continue;
    }
    let before: Record<string, Json> = {};
    try {
      before = JSON.parse(git('show', `${base}:${file}`));
    } catch {
      routine = false;
      lines.push(`- ${file}: new drug (needs a look)`);
      continue;
    }
    const after = JSON.parse(readFileSync(file, 'utf8'));
    const { review, routine: minor } = classifyDrug(before, after);
    const slug = file.replace(/^data\/drugs\/|\.json$/g, '');
    if (review.length > 0) {
      routine = false;
      lines.push(`- ${slug}: needs a look (${[...new Set(review)].join('; ')})`);
    } else if (minor.some((m) => m !== 'lastIngestedAt')) {
      lines.push(`- ${slug}: routine (${[...new Set(minor.filter((m) => m !== 'lastIngestedAt'))].slice(0, 6).join('; ')})`);
    }
  }
  console.log(lines.length > 0 ? lines.join('\n') : 'No changes beyond the refresh date.');
  console.log(`routine=${routine}`);
}

if (process.argv[1]?.endsWith('classify.ts')) main();
