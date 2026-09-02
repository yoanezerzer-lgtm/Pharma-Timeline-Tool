/**
 * Validates every committed drug record against the Zod schema.
 *
 * Runs in CI so malformed ingested data fails the build rather than shipping
 * to the site. Exits non-zero with a readable error on the first bad file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../src/schema/index.js';

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
}

main();
