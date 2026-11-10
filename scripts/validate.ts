/**
 * Validates every committed drug record against the Zod schema.
 *
 * Runs in CI so malformed ingested data fails the build rather than shipping
 * to the site. Exits non-zero with a readable error on the first bad file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../src/schema/index.js';
import { allowedSource, companiesOf, NewsFile } from '../src/lib/news.js';
import { PrecedentFile } from '../src/lib/reviewTime.js';

const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');

function main(): void {
  const files = readdirSync(DRUGS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No drug records found in data/drugs/');
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8'));
    const result = Drug.safeParse(raw);
    if (result.success) {
      const d = result.data;
      const unverified = d.trials.filter((t) =>
        Object.values(t.provenance).some((p) => !p.verified)
      ).length;
      console.log(
        `  ok  ${file} — ${d.trials.length} trials, ${d.milestones.length} milestones` +
          (unverified ? ` (${unverified} with unverified fields)` : '')
      );
    } else {
      failed++;
      console.error(`FAIL  ${file}`);
      for (const issue of result.error.issues) {
        console.error(`      ${issue.path.join('.')}: ${issue.message}`);
      }
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} of ${files.length} drug record(s) failed validation.`);
    process.exit(1);
  }
  console.log(`\nAll ${files.length} drug record(s) valid.`);
  validateNews(new Set(files.map((f) => f.replace(/\.json$/, ''))));
  validatePrecedent();
}

/** News links: the right shape, for a drug we have, and only on sites with no paywall. */
function validateNews(slugs: Set<string>): void {
  const dir = join(process.cwd(), 'data', 'news');
  if (!existsSync(dir)) return;
  const problems: string[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    const result = NewsFile.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (!result.success) {
      problems.push(`${file}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    if (!slugs.has(slug) || result.data.slug !== slug) {
      problems.push(`${file}: no drug record "${slug}"`);
      continue;
    }
    const drug = Drug.parse(JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8')));
    const companies = companiesOf(drug);
    for (const l of result.data.links) {
      if (!allowedSource(l.url, companies)) problems.push(`${file}: ${l.url} is not on an allowed site`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL  news/${p}`);
    process.exit(1);
  }
  console.log(`All ${files.length} news file(s) valid.`);
}

/**
 * Review-time precedent files (npm run precedent): schema, file name, and
 * every letter quote naming a date that it actually says.
 */
function validatePrecedent(): void {
  const dir = join(process.cwd(), 'data', 'precedent');
  if (!existsSync(dir)) return;
  const problems: string[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const result = PrecedentFile.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (!result.success) {
      problems.push(`${file}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    if (`${result.data.meshId}.json` !== file) problems.push(`${file}: meshId is ${result.data.meshId}`);
    for (const p of result.data.products) {
      const r = p.receiptDate;
      if (r && !r.source.quote) problems.push(`${file}: ${p.brandName} receipt date has no quote`);
    }
  }
  if (problems.length > 0) {
    console.error(`\nPrecedent files with problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`All ${files.length} precedent file(s) valid.`);
}

main();
