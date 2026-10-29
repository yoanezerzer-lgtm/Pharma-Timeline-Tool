/**
 * Command-line wrapper around the ingestion pipeline.
 *
 * This file owns argument parsing, printing, and exit codes. All decisions
 * live in run.ts, which is testable without a network or a terminal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../../src/schema/index.js';
import { getSpec, DRUG_SPECS, type DrugSpec } from './registry.js';
import { runIngest, ALL_STEPS } from './run.js';

interface NewDrugArgs {
  brandName?: string;
  inn?: string;
  sponsor?: string;
  modality?: string;
  mechanism?: string;
  applicationNumber?: string;
  applicationType?: string;
}

interface Args {
  slug: string;
  steps: Set<string>;
  refresh: boolean;
  maxLookups: number;
  dryRun: boolean;
  newDrug: NewDrugArgs;
}

function usage(): never {
  console.error(
    'Usage: npm run ingest -- --drug <slug> [--steps fda,docs,codes,ctgov,merge]\n' +
      '                        [--refresh] [--max-lookups N] [--dry-run]\n' +
      '\n' +
      "  To ingest a drug that isn't in the registry yet, also pass:\n" +
      '    --brand-name <name> --inn <name> --sponsor <name> --modality <name>\n' +
      '    [--mechanism <text>] [--application-number <n> --application-type NDA|BLA|ANDA]\n' +
      '\n' +
      `Known drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    const value = i >= 0 ? argv[i + 1] : undefined;
    // Form inputs (GitHub Actions workflow_dispatch) arrive as empty strings
    // when left blank, not as absent flags — treat both the same way.
    return value === '' ? undefined : value;
  };

  const slug = get('--drug');
  if (!slug) usage();

  return {
    slug,
    steps: new Set(get('--steps')?.split(',').map((s) => s.trim()) ?? ALL_STEPS),
    refresh: argv.includes('--refresh'),
    maxLookups: Number(get('--max-lookups') ?? 3000),
    dryRun: argv.includes('--dry-run'),
    newDrug: {
      brandName: get('--brand-name'),
      inn: get('--inn'),
      sponsor: get('--sponsor'),
      modality: get('--modality'),
      mechanism: get('--mechanism'),
      applicationNumber: get('--application-number'),
      applicationType: get('--application-type'),
    },
  };
}

/**
 * Builds a DrugSpec from CLI flags for a drug that isn't in registry.ts yet,
 * so a genuinely new drug can be ingested without a code change first — see
 * the GitHub Actions workflow_dispatch form in .github/workflows/ingest.yml.
 * This is still the same deterministic pipeline: no field here is inferred,
 * every one is either given here or read from the FDA application.
 */
function buildNewSpec(slug: string, args: NewDrugArgs): DrugSpec {
  // Either names the FDA application; everything else comes from its record (see identityFromApplication).
  if (!args.brandName && !args.applicationNumber) {
    console.error(
      `"${slug}" isn't on the site yet. To add it, pass --brand-name, or --application-type ` +
        `and --application-number.\n\nKnown drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`
    );
    process.exit(1);
  }

  const { applicationNumber, applicationType } = args;
  if (Boolean(applicationNumber) !== Boolean(applicationType)) {
    console.error(
      '--application-number and --application-type must be given together, or not at all ' +
        '(leave both blank for a newly approved drug — the pipeline resolves the application by brand name).'
    );
    process.exit(1);
  }
  if (applicationType && !['NDA', 'BLA', 'ANDA'].includes(applicationType)) {
    console.error(`--application-type must be NDA, BLA, or ANDA — got "${applicationType}".`);
    process.exit(1);
  }

  return {
    slug,
    brandName: args.brandName ?? '',
    inn: args.inn ?? '',
    modality: args.modality ?? '',
    sponsor: args.sponsor ?? '',
    mechanism: args.mechanism,
    applicationNumber,
    applicationType: applicationType as DrugSpec['applicationType'],
    // The INN and brand name are always valid ClinicalTrials.gov intervention
    // terms; blank ones are filled from the FDA record. Development code names
    // (e.g. "ABT-494") can be added to registry.ts if early trials use them.
    interventionNames: [args.inn ?? '', args.brandName ?? ''].filter(Boolean),
  };
}

/**
 * A drug already on the site but not in registry.ts (added through the
 * workflow form) re-runs from its own committed record, so a refresh needs
 * nothing but its slug.
 */
function specFromRecord(slug: string, dir = join(process.cwd(), 'data', 'drugs')): DrugSpec | undefined {
  const path = join(dir, `${slug}.json`);
  if (!existsSync(path)) return undefined;
  const drug = Drug.parse(JSON.parse(readFileSync(path, 'utf8')));
  return {
    slug: drug.slug,
    brandName: drug.brandName,
    inn: drug.inn,
    modality: drug.modality,
    sponsor: drug.sponsor,
    mechanism: drug.mechanism,
    applicationNumber: drug.regulatory.us.applicationNumber,
    applicationType: drug.regulatory.us.applicationType,
    interventionNames: [drug.inn, drug.brandName],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const spec = getSpec(args.slug) ?? specFromRecord(args.slug.toLowerCase()) ?? buildNewSpec(args.slug.toLowerCase(), args.newDrug);

  const knownApplication =
    spec.applicationType && spec.applicationNumber
      ? `${spec.applicationType} ${spec.applicationNumber}`
      : 'application number not yet known — resolving by brand name';
  console.log(`\nIngesting ${spec.brandName || spec.slug}${spec.inn ? ` (${spec.inn})` : ''} — ${knownApplication}\n`);

  const result = await runIngest({
    spec,
    steps: args.steps,
    refresh: args.refresh,
    maxLookups: args.maxLookups,
    dryRun: args.dryRun,
    log: (message) => console.log(message),
  });

  if (result.conflicts.length > 0) {
    console.log(
      `\n  ${result.conflicts.length} conflict(s) against human-verified values — ` +
        `kept the verified value:`
    );
    for (const c of result.conflicts) {
      console.log(
        `    ${c.trialId}.${c.field}: kept ${JSON.stringify(c.keptValue)}, ` +
          `ingest offered ${JSON.stringify(c.incomingValue)}`
      );
    }
  }

  if (result.written) {
    console.log(`\nWrote ${result.outPath}\n`);
  } else {
    console.log('\n--dry-run: no files written.\n');
  }
}

main().catch((err: Error) => {
  console.error(`\nIngest failed: ${err.message}\n`);
  process.exit(1);
});
