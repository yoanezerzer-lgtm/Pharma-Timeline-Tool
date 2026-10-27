/**
 * Overnight verification of the reference set's unchecked entries.
 *
 *   npm run verify -- queue [--limit 40] [--date YYYY-MM-DD]
 *       Writes .verify/queue.json (claims plus the passages that name each
 *       trial) for the agent to answer, and .verify/key.json, which the
 *       agent must not read.
 *   npm run verify -- apply [--date YYYY-MM-DD]
 *       Checks .verify/verdicts.json against the documents, records what
 *       passes in data/reference/, and writes .verify/report.md.
 *
 * Source text is read from data/raw/<slug>/docs/, as fetched from the
 * ingest workflow's diag/raw-text-<slug>-* branches.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Drug } from '../../src/schema/index.js';
import { Reference } from '../qc/reference.js';
import { applyVerdicts, buildQueue, reportMarkdown, Verdict, type AnswerKey, type Claim, type DrugContext } from './claims.js';
import { loadSources } from './sources.js';

const ROOT = process.cwd();
const OUT = join(ROOT, '.verify');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function contexts(): DrugContext[] {
  return readdirSync(join(ROOT, 'data', 'reference'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.replace(/\.json$/, '');
      const drug = Drug.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'drugs', f), 'utf8')));
      const ref = Reference.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'reference', f), 'utf8')));
      return { drug, ref, sources: loadSources(drug, join(ROOT, 'data', 'raw', slug, 'docs')) };
    });
}

function main(): void {
  const cmd = process.argv[2];
  const date = arg('date') ?? new Date().toISOString().slice(0, 10);
  mkdirSync(OUT, { recursive: true });
  const ctxs = contexts();

  if (cmd === 'queue') {
    for (const c of ctxs) console.log(`  ${c.drug.slug}: ${c.sources.length} source documents loaded`);
    const { queue, key } = buildQueue(ctxs, date, Number(arg('limit') ?? 40));
    writeFileSync(join(OUT, 'queue.json'), JSON.stringify(queue, null, 2) + '\n');
    writeFileSync(join(OUT, 'key.json'), JSON.stringify(key) + '\n');
    console.log(`Wrote ${queue.length} claims to .verify/queue.json.`);
    return;
  }

  if (cmd === 'apply') {
    const queue = JSON.parse(readFileSync(join(OUT, 'queue.json'), 'utf8')) as Claim[];
    const key = JSON.parse(readFileSync(join(OUT, 'key.json'), 'utf8')) as AnswerKey;
    const path = join(OUT, 'verdicts.json');
    const verdicts = existsSync(path) ? z.array(Verdict).parse(JSON.parse(readFileSync(path, 'utf8'))) : [];
    const result = applyVerdicts(queue, key, verdicts, ctxs, date);
    if (!result.voided) {
      for (const [slug, ref] of result.refs) {
        writeFileSync(join(ROOT, 'data', 'reference', `${slug}.json`), JSON.stringify(ref, null, 2) + '\n');
      }
    }
    const report = reportMarkdown(result, date);
    writeFileSync(join(OUT, 'report.md'), report + '\n');
    console.log(report);
    return;
  }

  console.error('Usage: npm run verify -- queue|apply [--limit N] [--date YYYY-MM-DD]');
  process.exit(2);
}

main();
