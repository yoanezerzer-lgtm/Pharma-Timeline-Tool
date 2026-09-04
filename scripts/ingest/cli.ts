/**
 * Command-line wrapper around the ingestion pipeline.
 *
 * This file owns argument parsing, printing, and exit codes. All decisions
 * live in run.ts, which is testable without a network or a terminal.
 */
import { getSpec, DRUG_SPECS } from './registry.js';
import { runIngest, ALL_STEPS } from './run.js';

interface Args {
  slug: string;
  steps: Set<string>;
  refresh: boolean;
  maxLookups: number;
  dryRun: boolean;
}

function usage(): never {
  console.error(
    'Usage: npm run ingest -- --drug <slug> [--steps fda,docs,codes,ctgov,merge]\n' +
      '                        [--refresh] [--max-lookups N] [--dry-run]\n' +
      `Known drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const slug = get('--drug');
  if (!slug) usage();

  return {
    slug,
    steps: new Set(
      get('--steps')?.split(',').map((s) => s.trim()) ?? ALL_STEPS
    ),
    refresh: argv.includes('--refresh'),
    maxLookups: Number(get('--max-lookups') ?? 3000),
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const spec = getSpec(args.slug);
  if (!spec) {
    console.error(`Unknown drug "${args.slug}". Add it to scripts/ingest/registry.ts.`);
    console.error(`Known drugs: ${DRUG_SPECS.map((d) => d.slug).join(', ')}`);
    process.exit(1);
  }

  const knownApplication =
    spec.applicationType && spec.applicationNumber
      ? `${spec.applicationType} ${spec.applicationNumber}`
      : 'application number not yet known — resolving by brand name';
  console.log(`\nIngesting ${spec.brandName} (${spec.inn}) — ${knownApplication}\n`);

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
