/**
 * npm run compare-rules -- [--base <ref>] [--head <ref>] [--only slug,slug] [--raw <dir>] [--out <file>]
 *
 * Re-derives approval dates per use and trial roles for every drug with
 * saved FDA text, once with the base ref's rules and once with the new ones,
 * and prints what changes. No network. --base defaults to where the branch
 * left origin/main. The saved text comes from the
 * `diag/raw-text-<slug>` branches (scripts/compare-rules/fetch-raw.sh puts
 * it in data/raw). --head defaults to the working tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Trial } from '../../src/schema/index.js';
import { getSpec } from '../ingest/registry.js';

/** The drug's names its registry entry lists (ingredient, brand, codes), when it has one. */
const registryNames = (slug: string) => getSpec(slug)?.interventionNames;
import { deriveFacts, diffFacts, formatReport, type DrugInput, type DrugResult, type RuleModules, type SourceDoc } from './facts.js';

const root = resolve(import.meta.dirname, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** The ref's rule code, unpacked under node_modules so its imports (zod) resolve. */
function checkoutRef(ref: string): string {
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
  const dir = join(root, 'node_modules', '.cache', 'compare-rules', sha);
  if (!existsSync(join(dir, 'scripts', 'ingest', 'roles.ts'))) {
    mkdirSync(dir, { recursive: true });
    execFileSync('sh', ['-c', `git archive "${sha}" scripts src | tar -x -C "${dir}"`], { cwd: root });
  }
  return dir;
}

async function loadModules(dir: string): Promise<RuleModules> {
  const load = (p: string) => import(pathToFileURL(join(dir, p)).href);
  const [roles, dates, registry] = await Promise.all([
    load('scripts/ingest/roles.ts'),
    load('scripts/ingest/indicationDates.ts'),
    load('scripts/ingest/registry.ts'),
  ]);
  return {
    roles,
    dates,
    knownTrialSponsors: (slug) => registry.getSpec?.(slug)?.knownTrialSponsors,
  };
}

/** The record's FDA documents with their saved text: "Label (SUPPL-79)" → docs/<file>.txt. */
export function readDrug(slug: string, rawDir: string): DrugInput | undefined {
  const docsDir = join(rawDir, slug, 'docs');
  if (!existsSync(docsDir)) return undefined;
  // The record of the run that saved the text, when there is one: the
  // published record can predate the newest label (a new approval).
  const published = JSON.parse(readFileSync(join(root, 'data', 'drugs', `${slug}.json`), 'utf8'));
  const own = join(rawDir, slug, 'record.json');
  const record = existsSync(own) ? JSON.parse(readFileSync(own, 'utf8')) : published;
  const docs: SourceDoc[] = [];
  for (const s of record.sources ?? []) {
    const m = /^(.+?) \(([^)]+)\)$/.exec(s.label ?? '');
    if (!m || !s.url) continue;
    let file: string;
    try {
      file = join(docsDir, `${basename(new URL(s.url).pathname)}.txt`);
    } catch {
      continue;
    }
    if (!existsSync(file)) continue;
    docs.push({ type: m[1], submission: m[2], url: s.url, text: readFileSync(file, 'utf8') });
  }
  return {
    slug,
    name: record.brandName ?? slug,
    sponsor: record.regulatory?.us?.sponsor ?? record.sponsor,
    drugNames: [record.inn, record.brandName, ...(registryNames(slug) ?? [])].filter(Boolean),
    // Every trial either record has: the site's, and any the run newly found.
    trials: mergeTrials(published.trials ?? [], record === published ? [] : record.trials ?? []),
    milestones: record.milestones ?? [],
    docs,
  };
}

export function mergeTrials(a: Trial[], b: Trial[]): Trial[] {
  const key = (t: Trial) => t.nctId ?? t.id;
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((t) => !seen.has(key(t)))];
}

async function main() {
  const headRef = arg('head');
  // By default, where this branch left main: main's later changes are not this branch's.
  const baseRef = arg('base') ?? git('merge-base', 'origin/main', headRef ?? 'HEAD');
  const rawDir = resolve(arg('raw') ?? join(root, 'data', 'raw'));
  const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);

  const before = await loadModules(checkoutRef(baseRef));
  const after = await loadModules(headRef ? checkoutRef(headRef) : root);

  const slugs = (only ?? readdirSync(join(root, 'data', 'drugs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))).sort();
  const results: DrugResult[] = [];
  // Sorted by name, as a reader looks them up.
  const missing: string[] = [];
  for (const slug of slugs) {
    const drug = readDrug(slug, rawDir);
    if (!drug || drug.docs.length === 0) {
      missing.push(slug);
      continue;
    }
    try {
      results.push({ name: drug.name, lines: diffFacts(drug.name, deriveFacts(before, drug), deriveFacts(after, drug)) });
    } catch (err) {
      results.push({ name: drug.name, lines: [], error: `could not compare: ${(err as Error).message}` });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  const describe = (ref: string) => {
    const short = git('rev-parse', '--short', ref);
    return /^[0-9a-f]{7,40}$/.test(ref) ? short : `${ref} (${short})`;
  };
  const report = formatReport(results, {
    base: describe(baseRef),
    head: headRef ? describe(headRef) : `working tree at ${git('rev-parse', '--short', 'HEAD')}`,
    missing,
  });
  const out = arg('out');
  if (out) writeFileSync(out, report);
  process.stdout.write(report);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
