/**
 * Quality control over every committed drug record.
 *
 *   npm run qc                       report; exits non-zero on any error
 *   npm run qc -- --json qc.json     also write the findings as JSON
 *   npm run qc -- --snapshot <slug>  record current answers as reference baseline
 *   npm run qc -- --known            rewrite scripts/qc/known-errors.json from today's errors
 *
 * Fails on: a rule-check error, or a mismatch against a *confirmed*
 * reference fact. Warnings and baseline changes are reported, not blocking.
 *
 * Errors listed in scripts/qc/known-errors.json are real errors already on
 * the site, waiting for a pipeline fix (docs/HANDOFF.md lists them). They are
 * reported but don't block, so a new rule can go in before the data it
 * catches is fixed; the same error anywhere else still fails.
 *
 * Where the ingest's saved text is present (data/raw/<slug>/docs, unpacked
 * from diag/raw-text-<slug>; `npm run qc:fetch-raw`), the labels are also
 * checked against the uses dated to them. Without it that check is skipped.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../../src/schema/index.js';
import { checkDrug, type Finding } from './checks.js';
import { checkLabelDates, rawTextPath } from './labelDates.js';
import { Reference, scoreAgainstReference, snapshotReference, type RefResult } from './reference.js';

const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');
const REF_DIR = join(process.cwd(), 'data', 'reference');
const RAW_DIR = process.env.QC_RAW_DIR ?? join(process.cwd(), 'data', 'raw');
const KNOWN_FILE = join(process.cwd(), 'scripts', 'qc', 'known-errors.json');

/** One error already on the site: "<slug> <code> <path>". */
const knownKey = (slug: string, f: Finding) => `${slug} ${f.code} ${f.path}`;

function loadKnown(): Set<string> {
  return existsSync(KNOWN_FILE) ? new Set(JSON.parse(readFileSync(KNOWN_FILE, 'utf8')) as string[]) : new Set();
}

function labelFindings(drug: Drug): { findings: Finding[]; read: number } {
  if (!existsSync(join(RAW_DIR, drug.slug, 'docs'))) return { findings: [], read: 0 };
  let read = 0;
  const findings = checkLabelDates(drug, (url) => {
    const path = rawTextPath(RAW_DIR, drug.slug, url);
    if (!existsSync(path)) return undefined;
    read++;
    return readFileSync(path, 'utf8');
  });
  return { findings, read };
}

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
  let labelsRead = 0;
  const reports: DrugReport[] = slugs.map((slug) => {
    const drug = loadDrug(slug);
    const ref = loadReference(slug);
    const labels = labelFindings(drug);
    labelsRead += labels.read;
    return { slug, findings: [...checkDrug(drug), ...labels.findings], reference: ref ? scoreAgainstReference(drug, ref) : [] };
  });

  if (args.includes('--known')) {
    const keys = reports.flatMap((r) => r.findings.filter((f) => f.severity === 'error').map((f) => knownKey(r.slug, f))).sort();
    writeFileSync(KNOWN_FILE, JSON.stringify(keys, null, 2) + '\n');
    console.log(`Wrote scripts/qc/known-errors.json (${keys.length} errors).`);
    return;
  }
  const known = loadKnown();
  const seen = new Set<string>();

  const all = reports.flatMap((r) => r.reference);
  const confirmed = all.filter((r) => r.status === 'confirmed');
  const lines: string[] = ['# Data QC report', ''];
  lines.push('| | Accuracy on confirmed facts |', '|---|---|');
  for (const kind of ['approvalDate', 'pivotal'] as const) {
    const c = confirmed.filter((r) => r.kind === kind);
    lines.push(`| ${kind === 'approvalDate' ? 'Indication approval dates' : 'Pivotal trials'} | ${pct(c.filter((r) => r.pass).length, c.length)} |`);
  }
  lines.push(`| **All** | **${pct(confirmed.filter((r) => r.pass).length, confirmed.length)}** |`, '');
  lines.push(
    labelsRead > 0
      ? `Labels checked against the uses dated to them: ${labelsRead} (saved text present).`
      : 'Labels not checked against the uses dated to them: no saved text here (`npm run qc:fetch-raw`).',
    ''
  );

  let errors = 0;
  for (const r of reports) {
    const isKnown = (f: Finding) => known.has(knownKey(r.slug, f)) && (seen.add(knownKey(r.slug, f)), true);
    const errs = r.findings.filter((f) => f.severity === 'error' && !isKnown(f));
    const knownErrs = r.findings.filter((f) => f.severity === 'error' && known.has(knownKey(r.slug, f)));
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const wrong = r.reference.filter((x) => !x.pass && x.status === 'confirmed');
    const changed = r.reference.filter((x) => !x.pass && x.status === 'baseline');
    errors += errs.length + wrong.length;
    lines.push(`## ${r.slug}`, '');
    if (errs.length + knownErrs.length + warns.length + wrong.length + changed.length === 0) {
      lines.push('No findings.', '');
      continue;
    }
    for (const x of wrong) lines.push(`- **error** reference-mismatch \`${x.key}\`: expected ${x.expected}, got ${x.actual}`);
    for (const f of errs) lines.push(`- **error** ${f.code} \`${f.path}\`: ${f.message}`);
    for (const f of knownErrs) lines.push(`- known error, awaiting a pipeline fix: ${f.code} \`${f.path}\`: ${f.message}`);
    for (const x of changed) lines.push(`- changed \`${x.key}\`: baseline ${x.expected}, now ${x.actual}`);
    for (const f of warns) lines.push(`- warn ${f.code} \`${f.path}\`: ${f.message}`);
    lines.push('');
  }
  const gone = [...known].filter((k) => !seen.has(k) && (labelsRead > 0 || !k.includes(' dated-to-label-without-use ')));
  if (gone.length > 0) {
    lines.push('## Known errors no longer found', '', 'Fixed; take them out of `scripts/qc/known-errors.json`:', '');
    for (const k of gone) lines.push(`- \`${k}\``);
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
