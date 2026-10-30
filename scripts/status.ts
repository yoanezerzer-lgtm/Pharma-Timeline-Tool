/**
 * Where the data stands, in plain words, for the weekly digest:
 *
 *   npm run -s status
 *
 * How many drugs are checked, which facts are stuck waiting for a person,
 * and which facts the documents haven't given yet. Reads only committed files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../src/schema/index.js';
import { Reference } from './qc/reference.js';
import { STUCK_AFTER } from './verify/claims.js';
import { checkState, checkStats } from '../src/lib/summary.js';

const ROOT = process.cwd();
const drugs = readdirSync(join(ROOT, 'data', 'drugs'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const drug = Drug.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'drugs', f), 'utf8')));
    let ref: Reference | undefined;
    try {
      ref = Reference.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'reference', f), 'utf8')));
    } catch {
      ref = undefined;
    }
    return { drug, ref };
  });

const states = drugs.map(({ drug, ref }) => ({ drug, state: checkState(checkStats(ref)) }));
const count = (s: string) => states.filter((x) => x.state === s).length;
const lines = [
  `# Data status`,
  '',
  `${drugs.length} drugs: ${count('checked')} checked, ${count('partial')} partly checked, ${count('unchecked')} not yet checked.`,
  '',
];

const stuck = drugs.flatMap(({ drug, ref }) =>
  (ref?.pivotal ?? [])
    .filter((p) => p.status === 'baseline' && (p.tries ?? 0) >= STUCK_AFTER)
    .map((p) => `- ${drug.brandName}: ${p.trial} for "${p.indication}"`)
);
lines.push(`## Stuck facts (tried ${STUCK_AFTER} nights, need a person): ${stuck.length}`, '', ...stuck, '');

const gap = (title: string, missing: (d: Drug) => boolean) => {
  const names = drugs.filter(({ drug }) => missing(drug)).map(({ drug }) => drug.brandName);
  lines.push(`- ${title}: ${names.length === 0 ? 'none' : names.join(', ')}`);
};
lines.push('## Not yet in the documents', '');
gap('No FDA review office', (d) => !d.regulatory.us.reviewOffice);
gap('No company name from the label', (d) => !d.regulatory.us.labelCompany);
gap('No drug class', (d) => !d.pharmacology?.drugClass);
gap('No label sections 12.1-12.3', (d) => !d.pharmacology?.sections.length);
gap('An approved use with no disease matched', (d) => d.indications.some((i) => !i.diseases?.length));
gap('A disease with no MedlinePlus summary', (d) => d.indications.some((i) => (i.diseases ?? []).some((x) => !x.summary)));
gap('An approved use with no pivotal trial', (d) =>
  d.indications.some((i) => !d.trials.some((t) => t.roles.some((r) => r.role === 'PIVOTAL' && r.indication === i.name)))
);
console.log(lines.join('\n'));
