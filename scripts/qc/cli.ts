/**
 * Quality control over every committed drug record.
 *
 *   npm run qc                       report; exits non-zero on any error
 *   npm run qc -- --json qc.json     also write the findings as JSON
 *   npm run qc -- --snapshot <slug>  record current answers as reference baseline
 *
 * Fails on: a rule-check error, or a mismatch against a *confirmed*
 * reference fact. Warnings and baseline changes are reported, not blocking.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../../src/schema/index.js';
import { checkDrug, type Finding } from './checks.js';
import { Reference, scoreAgainstReference, snapshotReference, type RefResult } from './reference.js';

const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');
const REF_DIR = join(process.cwd(), 'data', 'reference');

function loadDrug(slug: string): Drug {
  return Drug.parse(JSON.parse(readFileSync(join(DRUGS_DIR, `${slug}.json`), 'utf8')));
}

function loadReference(slug: string): Reference | undefined {
  const path = join(REF_DIR, `${slug}.json`);
  return existsSync(path) ? Reference.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
}

function snapshot(slug: string): void {
  const ref = snapshotReference(loadDrug(slug), loadReference(slug));
  mkdirSync(REF_DIR, { recursive: true });
  writeFileSync(join(REF_DIR, `${slug}.json`), JSON.stringify(ref, null, 2) + '\n');
  console.log(`Wrote data/reference/${slug}.json (${ref.indications.length} indications, ${ref.pivotal.length} pivotal entries).`);
}

interface DrugReport {
  slug: string;
  findings: Finding[];
  reference: RefResult[];
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`;
}

function main(): void {
  const args = process.argv.slice(2);
  const snap = args.indexOf('--snapshot');
  if (snap >= 0) return snapshot(args[snap + 1]);
  const jsonIdx = args.indexOf('--json');

  const slugs = readdirSync(DRUGS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const reports: DrugReport[] = slugs.map((slug) => {
    const drug = loadDrug(slug);
    const ref = loadReference(slug);
    return { slug, findings: checkDrug(drug), reference: ref ? scoreAgainstReference(drug, ref) : [] };
  });

  const all = reports.flatMap((r) => r.reference);
  const confirmed = all.filter((r) => r.status === 'confirmed');
  const lines: string[] = ['# Data QC report', ''];
  lines.push('| | Accuracy on confirmed facts |', '|---|---|');
  for (const kind of ['approvalDate', 'pivotal'] as const) {
    const c = confirmed.filter((r) => r.kind === kind);
    lines.push(`| ${kind === 'approvalDate' ? 'Indication approval dates' : 'Pivotal trials'} | ${pct(c.filter((r) => r.pass).length, c.length)} |`);
  }
  lines.push(`| **All** | **${pct(confirmed.filter((r) => r.pass).length, confirmed.length)}** |`, '');

  let errors = 0;
  for (const r of reports) {
    const errs = r.findings.filter((f) => f.severity === 'error');
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const wrong = r.reference.filter((x) => !x.pass && x.status === 'confirmed');
    const changed = r.reference.filter((x) => !x.pass && x.status === 'baseline');
    errors += errs.length + wrong.length;
    lines.push(`## ${r.slug}`, '');
    if (errs.length + warns.length + wrong.length + changed.length === 0) {
      lines.push('No findings.', '');
      continue;
    }
    for (const x of wrong) lines.push(`- **error** reference-mismatch \`${x.key}\`: expected ${x.expected}, got ${x.actual}`);
    for (const f of errs) lines.push(`- **error** ${f.code} \`${f.path}\`: ${f.message}`);
    for (const x of changed) lines.push(`- changed \`${x.key}\`: baseline ${x.expected}, now ${x.actual}`);
    for (const f of warns) lines.push(`- warn ${f.code} \`${f.path}\`: ${f.message}`);
    lines.push('');
  }
  console.log(lines.join('\n'));

  if (jsonIdx >= 0) writeFileSync(args[jsonIdx + 1], JSON.stringify(reports, null, 2) + '\n');
  if (errors > 0) {
    console.error(`${errors} error(s).`);
    process.exit(1);
  }
}

main();
