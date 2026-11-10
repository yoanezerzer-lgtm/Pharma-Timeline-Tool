/**
 * `npm run precedent [-- --only D003876] [--refresh]`
 *
 * Writes data/precedent/<meshId>.json for every disease on the site: the
 * FDA review time (receipt to approval) of comparable approvals, with the
 * source of every value. Read by code from:
 * - openFDA Drugs@FDA: approval date, NDA/BLA, review priority, submission
 *   class, orphan flag (`submission_property_type`);
 * - openFDA labels: other novel products (new molecular entities and
 *   original BLAs) whose indications name the disease, with the sentence;
 * - the FDA approval letter: the date the FDA received the application, and
 *   whether it was an accelerated approval, each with the letter's words.
 *   Letters come from the local cache (data/raw/), the drug's
 *   diag/raw-text-<slug> branch, or a download.
 * A value the sources don't give stays empty. Responses are cached under
 * data/raw/_precedent/ (git-ignored).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Drug } from '../../src/schema/index.js';
import { severityOf, severityOfText, summarizeDiseases, type DiseaseSummary } from '../../src/lib/diseases.js';
import { naturalTerm } from '../../src/lib/plainText.js';
import { toDateValue } from '../../src/lib/dates.js';
import {
  acceleratedFromLetter,
  letterIsFor,
  PrecedentFile,
  receiptFromLetter,
  type PrecedentProduct,
  type ValueSource,
} from '../../src/lib/reviewTime.js';
import { makeContext, DEFAULT_RAW_DIR } from '../ingest/context.js';
import { fetchJson } from '../ingest/http.js';
import { runDocsStage } from '../ingest/docs.js';

const OUT_DIR = join(process.cwd(), 'data', 'precedent');
const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');
const DRUGSFDA = 'https://api.fda.gov/drug/drugsfda.json';
const LABEL = 'https://api.fda.gov/drug/label.json';

interface Submission {
  submission_type?: string;
  submission_number?: string;
  submission_status?: string;
  submission_status_date?: string;
  review_priority?: string;
  submission_class_code?: string;
  submission_class_code_description?: string;
  submission_property_type?: { code?: string }[];
  application_docs?: { url: string; type?: string }[];
}
interface Application {
  application_number: string;
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  products?: { brand_name?: string }[];
  submissions?: Submission[];
}
interface Listing<T> {
  meta?: { last_updated?: string };
  results?: T[];
}

const ctx = makeContext('_precedent', { refresh: process.argv.includes('--refresh') });
const q = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
const recordUrl = (app: string) => `${DRUGSFDA}?search=application_number:${app.replace(' ', '')}`;
const fdaDate = (raw?: string) => (raw && /^\d{8}$/.test(raw) ? toDateValue(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`) : undefined);
const https = (url: string) => url.replace(/^http:\/\//, 'https://');

let openFdaUpdated: string | undefined;

async function applications(apps: string[]): Promise<Map<string, Application>> {
  const out = new Map<string, Application>();
  for (let i = 0; i < apps.length; i += 20) {
    const chunk = apps.slice(i, i + 20).map((a) => a.replace(' ', ''));
    const url = `${DRUGSFDA}?search=${chunk.map((a) => `application_number:${a}`).join('+')}&limit=100`;
    const res = await fetchJson<Listing<Application>>(url, { ctx, kind: 'drugsfda' });
    openFdaUpdated ??= res?.meta?.last_updated;
    for (const r of res?.results ?? []) out.set(r.application_number, r);
  }
  return out;
}

/** Text of an approval letter: local cache, then the drug's raw-text branch, then a download. */
async function letterText(slug: string, url: string): Promise<string | undefined> {
  const name = basename(new URL(url).pathname);
  const local = join(DEFAULT_RAW_DIR, slug, 'docs', `${name}.txt`);
  if (existsSync(local)) return readFileSync(local, 'utf8');
  if (slug !== '_precedent') {
    const ref = `refs/remotes/origin/diag/raw-text-${slug}`;
    try {
      execFileSync('git', ['rev-parse', '-q', '--verify', ref], { stdio: 'ignore' });
    } catch {
      try {
        execFileSync('git', ['fetch', '-q', 'origin', `diag/raw-text-${slug}:${ref}`], { stdio: 'ignore' });
      } catch {
        /* no branch */
      }
    }
    try {
      return execFileSync('git', ['show', `${ref}:data/raw/${slug}/docs/${name}.txt`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      /* not on the branch */
    }
  }
  const [doc] = await runDocsStage({ ...ctx, slug }, [{ url: https(url), type: 'Letter', submission: '' }]);
  return doc?.text;
}

function fromLetter(text: string | undefined, url: string, label: string): Pick<PrecedentProduct, 'receiptDate' | 'accelerated'> {
  if (!text || text.replace(/<<<PAGE \d+>>>/g, '').trim().length < 200) return {};
  const source = (quote?: string): ValueSource => ({ url: https(url), label, quote });
  const receipt = receiptFromLetter(text);
  const acc = acceleratedFromLetter(text);
  return {
    receiptDate: receipt && { value: receipt.date, source: source(receipt.quote) },
    accelerated: { value: acc.value, source: source(acc.quote) },
  };
}

/** The openFDA facts of one submission, each pointing at the application's record. */
function submissionFacts(app: string, s: Submission): Partial<PrecedentProduct> {
  const id = `${s.submission_type}-${s.submission_number}`;
  const source: ValueSource = { url: recordUrl(app), label: `openFDA Drugs@FDA, ${app} ${id}` };
  const date = fdaDate(s.submission_status_date);
  const prio = s.review_priority === 'PRIORITY' || s.review_priority === 'STANDARD' ? s.review_priority : undefined;
  return {
    submission: id,
    approvalDate: date && { value: date, source },
    reviewPriority: prio && { value: prio, source },
    submissionClass: s.submission_class_code_description ? { value: s.submission_class_code_description, source } : undefined,
    orphan: s.submission_property_type?.some((p) => p.code === 'Orphan') ? { value: true, source } : undefined,
  };
}

const approved = (subs: Submission[] | undefined) => (subs ?? []).filter((s) => s.submission_status === 'AP');
const label = (s: Submission) => `${s.submission_type}-${s.submission_number}`;

/** Phrases to search label indications for: MeSH's term in natural order, and the page's name. */
export function searchPhrases(d: Pick<DiseaseSummary, 'term' | 'name'>): string[] {
  const forms = [naturalTerm(d.term), d.name].map((s) => s.toLowerCase().replace(/\bneoplasms\b/, 'cancer'));
  return [...new Set(forms)];
}

async function forDisease(d: DiseaseSummary, drugs: Drug[]): Promise<PrecedentFile> {
  const phrases = searchPhrases(d);
  const products: PrecedentProduct[] = [];
  const siteApps = new Set(d.uses.map((u) => u.application.replace(' ', '')));
  const allSiteApps = new Set(drugs.map((x) => `${x.regulatory.us.applicationType}${x.regulatory.us.applicationNumber}`));
  const records = await applications([...siteApps]);

  // The first approval of each use on the site.
  for (const u of d.uses) {
    const step = u.steps[0];
    const rec = records.get(u.application.replace(' ', ''));
    const [type] = u.application.split(' ');
    if (!step || (type !== 'NDA' && type !== 'BLA')) continue;
    const subs = approved(rec?.submissions);
    const sub = subs.find((s) => step.submissions.includes(label(s))) ?? subs.find((s) => step.date && fdaDate(s.submission_status_date)?.value === step.date.value);
    const drug = drugs.find((x) => x.slug === u.drugSlug)!;
    const letterUrl = step.sourceUrl && /ltr\.pdf$/i.test(step.sourceUrl) ? step.sourceUrl : sub?.application_docs?.find((x) => x.type === 'Letter' && letterIsFor(x.url, label(sub)))?.url;
    const facts = sub ? submissionFacts(u.application, sub) : {};
    const id = facts.submission ?? step.submissions[0] ?? '';
    products.push({
      brandName: u.brandName,
      inn: u.inn,
      application: u.application,
      applicationType: type,
      severity: severityOf(u),
      site: { drugSlug: u.drugSlug, indicationSlug: u.indicationSlug },
      ...facts,
      submission: id,
      ...(letterUrl && letterIsFor(letterUrl, id) ? fromLetter(await letterText(drug.slug, letterUrl), letterUrl, `FDA approval letter, ${u.application} ${id}`) : {}),
    });
  }

  // Other novel products whose label names the disease.
  const search = `indications_and_usage:(${phrases.map((p) => `"${q(p)}"`).join('+')})`;
  const counted = await fetchJson<{ results?: { term: string }[] }>(`${LABEL}?search=${search}&count=openfda.application_number.exact&limit=1000`, { ctx, kind: 'label-count' });
  const others = (counted?.results ?? []).map((r) => r.term).filter((a) => /^(NDA|BLA)\d+$/.test(a) && !allSiteApps.has(a));
  for (const [appNo, rec] of await applications(others)) {
    const orig = approved(rec.submissions).find((s) => s.submission_type === 'ORIG');
    const type = appNo.slice(0, 3) as 'NDA' | 'BLA';
    if (!orig || (type === 'NDA' && orig.submission_class_code !== 'TYPE 1')) continue;
    const app = `${type} ${appNo.slice(3)}`;
    const lab = await fetchJson<{ results?: { set_id?: string; indications_and_usage?: string[]; openfda?: { brand_name?: string[]; generic_name?: string[] } }[] }>(
      `${LABEL}?search=openfda.application_number:"${appNo}"&limit=1`,
      { ctx, kind: 'label' },
    );
    const l = lab?.results?.[0];
    const text = (l?.indications_and_usage ?? []).join(' ').replace(/\s+/g, ' ');
    const sentence = text.split(/(?<=\.)\s+(?=[A-Z0-9])/).find((s) => phrases.some((p) => s.toLowerCase().includes(p)));
    if (!sentence) continue;
    const facts = submissionFacts(app, orig);
    const letterUrl = orig.application_docs?.find((x) => x.type === 'Letter' && letterIsFor(x.url, facts.submission!))?.url;
    products.push({
      brandName: titleCase(l?.openfda?.brand_name?.[0] ?? rec.openfda?.brand_name?.[0] ?? rec.products?.[0]?.brand_name ?? app),
      inn: (l?.openfda?.generic_name?.[0] ?? rec.openfda?.generic_name?.[0])?.toLowerCase(),
      application: app,
      applicationType: type,
      originalOnly: true,
      severity: severityOfText([sentence]),
      indication: {
        value: sentence,
        source: {
          url: l?.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${l.set_id}` : `${LABEL}?search=openfda.application_number:"${appNo}"`,
          label: `Current label, ${app} (openFDA)`,
          quote: sentence,
        },
      },
      ...facts,
      submission: facts.submission!,
      ...(letterUrl ? fromLetter(await letterText('_precedent', letterUrl), letterUrl, `FDA approval letter, ${app} ${facts.submission}`) : {}),
    });
  }

  // A receipt after the approval means the letter is about something else: leave a gap.
  for (const p of products) {
    if (p.receiptDate && p.approvalDate && p.receiptDate.value.value > p.approvalDate.value.value) delete p.receiptDate;
  }
  products.sort((a, b) => (a.approvalDate?.value.value ?? '9999').localeCompare(b.approvalDate?.value.value ?? '9999'));
  return PrecedentFile.parse({
    meshId: d.meshId,
    term: d.term,
    searched: phrases,
    retrievedAt: new Date().toISOString().slice(0, 10),
    openFdaUpdated,
    products,
  });
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

async function main(): Promise<void> {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const drugs = readdirSync(DRUGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => Drug.parse(JSON.parse(readFileSync(join(DRUGS_DIR, f), 'utf8'))));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const d of summarizeDiseases(drugs)) {
    if (only && d.meshId !== only) continue;
    const file = await forDisease(d, drugs);
    writeFileSync(join(OUT_DIR, `${d.meshId}.json`), JSON.stringify(file, null, 2) + '\n');
    const both = file.products.filter((p) => p.receiptDate && p.approvalDate).length;
    console.log(`  ${d.meshId} ${d.name}: ${file.products.length} products, ${both} with both dates`);
  }
}

if (process.argv[1]?.endsWith('cli.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
