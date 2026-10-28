/**
 * Finds each pivotal trial's readout, the first public announcement of its
 * primary result, and records it on the drug's committed record.
 *
 *   npm run readouts -- <slug> [--refresh] [--trial <trial id>]
 *
 * Reads SEC full-text search and the candidate release links in
 * data/readouts/candidates/<slug>.json. Needs network access, so it runs on
 * GitHub Actions (.github/workflows/readouts.yml). Writes the
 * record in place and a run summary to data/raw/<slug>/readouts/summary.json.
 * A verified readout is never changed; a trial with no release found keeps
 * whatever it had.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Trial } from '../../src/schema/index.js';
import { pickReadout, type Release } from './select.js';
import { z } from 'zod';
import { fetchRelease, searchEdgar, type SourceContext, type Window } from './sources.js';

/**
 * Release links to check for a drug, one file per drug in
 * data/readouts/candidates/<slug>.json: [{ "trial": "<trial id, acronym or
 * NCT number>", "url": "https://…" }]. Usually found by the overnight agent
 * searching the web. Only the link is taken from here: the date and quote
 * are read from the page.
 */
const Candidates = z.array(z.object({ trial: z.string(), url: z.string().url(), foundBy: z.string().optional() }));

function loadCandidates(slug: string): z.infer<typeof Candidates> {
  const path = join(process.cwd(), 'data', 'readouts', 'candidates', `${slug}.json`);
  return existsSync(path) ? Candidates.parse(JSON.parse(readFileSync(path, 'utf8'))) : [];
}

const MONTH = 30.44 * 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function searchName(t: Trial): string | undefined {
  const name = [t.acronym, t.labelName].find((n) => n && n.replace(/[^A-Za-z0-9]/g, '').length >= 4);
  // Registry acronyms sometimes space their hyphens ("SELECT - PsA 1"); releases don't.
  return name?.replace(/\s*-\s*/g, '-') ?? t.nctId;
}

interface TrialSummary {
  trial: string;
  query?: string;
  window?: Window;
  found: Record<string, number>;
  readout?: { date: string; url: string; quote?: string };
  kept?: string;
  note?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) {
    console.error('Usage: npm run readouts -- <slug> [--refresh] [--trial <id>]');
    process.exit(2);
  }
  const only = args.includes('--trial') ? args[args.indexOf('--trial') + 1] : undefined;
  const path = join(process.cwd(), 'data', 'drugs', `${slug}.json`);
  const drug = Drug.parse(JSON.parse(readFileSync(path, 'utf8')));
  const rawDir = join(process.cwd(), 'data', 'raw', slug, 'readouts');
  const ctx: SourceContext = { cacheDir: join(rawDir, 'cache'), refresh: args.includes('--refresh'), log: (m) => console.log(m) };
  const candidates = loadCandidates(slug);
  const approvalOf = new Map(drug.indications.map((i) => [i.name, i.approvalDate?.value]));

  const summary: TrialSummary[] = [];
  const pivotal = drug.trials.filter((t) => t.roles.some((r) => r.role === 'PIVOTAL') && (!only || t.id === only));
  console.log(`${drug.brandName}: ${pivotal.length} pivotal trials`);

  for (const t of pivotal) {
    const s: TrialSummary = { trial: t.acronym ?? t.labelName ?? t.nctId ?? t.id, found: {} };
    summary.push(s);
    if (t.provenance.readoutDate?.verified) {
      s.note = 'verified readout kept';
      continue;
    }
    const query = searchName(t);
    const pc = t.primaryCompletionDate;
    if (!query || !pc) {
      s.note = !query ? 'no name to search for' : 'no primary completion date';
      continue;
    }
    const approvals = t.roles.filter((r) => r.role === 'PIVOTAL').map((r) => (r.indication ? approvalOf.get(r.indication) : undefined)).filter((d): d is string => !!d);
    const end = approvals.length > 0 ? approvals.sort().at(-1)! : iso(Math.min(Date.parse(pc.value) + 36 * MONTH, Date.now()));
    const window: Window = { from: iso(Date.parse(pc.value) - 31 * 86400000), to: end };
    if (window.from > window.to) {
      // A primary completion after the approval is a still-running extension's
      // planned date, not the data the approval used: nothing to search for.
      s.note = `primary completion ${pc.value} is after approval ${end}`;
      continue;
    }
    s.query = query;
    s.window = window;
    console.log(`  ${s.trial}: "${query}" ${window.from} → ${window.to}`);

    const releases: Release[] = [];
    try {
      const found = await searchEdgar(query, window, ctx);
      s.found.SEC = found.length;
      releases.push(...found);
    } catch (err) {
      s.found.SEC = -1;
      console.log(`    ! SEC: ${(err as Error).message}`);
    }
    const mine = candidates.filter((c) => [t.id, t.acronym, t.labelName, t.nctId].includes(c.trial));
    let read = 0;
    for (const c of mine) {
      const r = await fetchRelease(c.url, ctx);
      if (r) {
        read++;
        releases.push(r);
      }
    }
    if (mine.length > 0) s.found.candidates = read;

    // The text of every release considered, for checking a pick (or a miss) by hand.
    mkdirSync(join(rawDir, 'texts'), { recursive: true });
    for (const r of releases) {
      const name = createHash('sha1').update(r.url).digest('hex').slice(0, 12);
      writeFileSync(join(rawDir, 'texts', `${name}.txt`), `${r.url}\n${r.source} · ${r.date} · ${r.title}\n\n${r.text}\n`);
    }

    const readout = pickReadout(t, releases, { approvalDate: end });
    if (readout) {
      t.readoutDate = readout.date;
      t.provenance.readoutDate = readout.provenance;
      s.readout = { date: readout.date.value, url: readout.provenance.sourceUrl!, quote: readout.provenance.quote };
      console.log(`    → ${readout.date.value} ${readout.provenance.sourceUrl}`);
    } else if (t.readoutDate) {
      s.kept = t.readoutDate.value;
      console.log(`    → none found; kept ${t.readoutDate.value}`);
    } else {
      console.log('    → none found');
    }
  }

  writeFileSync(path, JSON.stringify(drug, null, 2) + '\n');
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const hits = summary.filter((s) => s.readout).length;
  console.log(`\nReadouts found for ${hits} of ${summary.length} pivotal trials.`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
