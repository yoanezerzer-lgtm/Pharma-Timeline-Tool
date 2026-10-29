/**
 * New drugs to add: first approvals of new medicines, from FDA's own record.
 *
 * Reads openFDA Drugs@FDA for original applications approved in a date
 * range and keeps new molecular entities (an NDA whose original submission
 * is classed "Type 1") and original biologics (BLAs), leaving out generics,
 * new formulations of known drugs and biosimilars. Prints a list the
 * add-drugs workflow ingests one by one.
 *
 *   npm run -s novel -- --from 2025-01-01 [--to 2026-10-29] [--limit 50]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DrugsFdaResult } from './fda.js';

export interface NewApproval {
  slug: string;
  applicationType: 'NDA' | 'BLA';
  applicationNumber: string;
  brandName: string;
  /** As FDA writes it, suffix and all: "risankizumab-rzaa". */
  genericName: string;
  approved: string;
}

const OPENFDA = 'https://api.fda.gov/drug/drugsfda.json';

/** A drug's site slug from its generic name: "risankizumab-rzaa" → "risankizumab". */
export function slugFor(genericName: string): string {
  return genericName
    .toLowerCase()
    .replace(/-[a-z]{4}$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

const ymd = (d: string) => d.replace(/-/g, '');

/**
 * The applications whose original submission is a first approval of a new
 * medicine within [from, to]. Biosimilars are told apart afterwards (see
 * isBiosimilar), since the application record doesn't say.
 */
export function newMedicines(results: DrugsFdaResult[], from: string, to: string): NewApproval[] {
  const out: NewApproval[] = [];
  for (const r of results) {
    const m = r.application_number?.match(/^(NDA|BLA)(\d+)$/);
    if (!m) continue;
    const orig = r.submissions?.find((s) => s.submission_type === 'ORIG' && s.submission_status === 'AP');
    const date = orig?.submission_status_date;
    if (!orig || !date || date < ymd(from) || date > ymd(to)) continue;
    // An NDA's original submission is classed by novelty; "Type 1" is a new molecular entity.
    if (m[1] === 'NDA' && !/^TYPE 1\b/i.test(orig.submission_class_code ?? '')) continue;
    const generic = r.openfda?.generic_name?.[0] ?? r.products?.[0]?.active_ingredients?.[0]?.name;
    if (!generic) continue;
    out.push({
      slug: slugFor(generic),
      applicationType: m[1] as 'NDA' | 'BLA',
      applicationNumber: m[2],
      brandName: r.products?.[0]?.brand_name ?? '',
      genericName: generic,
      approved: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    });
  }
  return out.sort((a, b) => b.approved.localeCompare(a.approved));
}

/**
 * A biosimilar shares its reference product's name before the four-letter
 * suffix ("adalimumab-aaty" for Humira's adalimumab), so it is a BLA whose
 * base name already belongs to an earlier-approved application.
 */
export function isBiosimilar(candidate: NewApproval, sameName: DrugsFdaResult[]): boolean {
  if (candidate.applicationType !== 'BLA') return false;
  return sameName.some((r) => {
    if (r.application_number === `BLA${candidate.applicationNumber}`) return false;
    const orig = r.submissions?.find((s) => s.submission_type === 'ORIG' && s.submission_status === 'AP');
    return !!orig?.submission_status_date && orig.submission_status_date < ymd(candidate.approved);
  });
}

async function getJson(url: string): Promise<{ results?: DrugsFdaResult[]; meta?: { results?: { total?: number } } }> {
  const res = await fetch(url, { headers: { 'user-agent': 'pharma-timeline-tool' } });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const from = arg('--from') ?? '2025-01-01';
  const to = arg('--to') ?? new Date().toISOString().slice(0, 10);
  const limit = Number(arg('--limit') ?? 50);

  const search = encodeURIComponent(`submissions.submission_type:"ORIG" AND submissions.submission_status_date:[${ymd(from)} TO ${ymd(to)}]`);
  const results: DrugsFdaResult[] = [];
  for (let skip = 0; skip < 25000; skip += 1000) {
    const page = await getJson(`${OPENFDA}?search=${search}&limit=1000&skip=${skip}`);
    results.push(...(page.results ?? []));
    if ((page.results?.length ?? 0) < 1000) break;
  }

  const onSite = (slug: string) => existsSync(join(process.cwd(), 'data', 'drugs', `${slug}.json`));
  const picked: NewApproval[] = [];
  const seen = new Set<string>();
  for (const c of newMedicines(results, from, to)) {
    if (picked.length >= limit) break;
    if (seen.has(c.slug) || onSite(c.slug)) continue;
    seen.add(c.slug);
    if (c.applicationType === 'BLA') {
      // The whole name without the suffix, so "nivolumab and relatlimab" isn't taken for nivolumab.
      const base = c.genericName.toLowerCase().replace(/-[a-z]{4}$/, '');
      const same = await getJson(`${OPENFDA}?search=${encodeURIComponent(`openfda.generic_name:"${base}"`)}&limit=100`);
      if (isBiosimilar(c, same.results ?? [])) continue;
    }
    picked.push(c);
  }
  console.error(`${results.length} applications with an original submission in range; ${picked.length} new medicines picked.`);
  console.log(JSON.stringify(picked));
}

if (process.argv[1]?.endsWith('novel.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
