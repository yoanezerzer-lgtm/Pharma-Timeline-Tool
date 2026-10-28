import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Release } from './select.js';

/**
 * Where trial readouts are announced, searched by trial name:
 *
 * - SEC full-text search: 8-K filings (and their press-release exhibits)
 *   from US-listed companies. Dated, structured, free.
 * - Candidate links: release pages someone (the overnight agent, or a
 *   person) found by searching the web. Newswire and company search pages
 *   refuse or return nothing to automated requests (confirmed on PR
 *   Newswire and GlobeNewswire), but a single release page can be read.
 *   Code reads the date and the quote from the page itself, so a candidate
 *   is only ever a link, never a value.
 *
 * Every response is cached under data/raw/<slug>/readouts/ so a run can be
 * repeated and the text it read can be inspected later.
 */

const SEC_UA = process.env.SEC_USER_AGENT ?? 'pharma-timeline-tool github.com/yoanezerzer-lgtm/Pharma-Timeline-Tool';
const BROWSER_UA = 'Mozilla/5.0 (compatible; pharma-timeline-tool; +https://github.com/yoanezerzer-lgtm/Pharma-Timeline-Tool)';

export interface SourceContext {
  cacheDir: string;
  refresh: boolean;
  log: (m: string) => void;
}

let last = 0;
async function throttle(ms = 250): Promise<void> {
  const wait = last + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function fetchText(url: string, ctx: SourceContext, ua = BROWSER_UA): Promise<string | undefined> {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const path = join(ctx.cacheDir, `${key}.json`);
  if (!ctx.refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { status: number; body?: string };
    return cached.body;
  }
  let status = 0;
  let body: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
      status = res.status;
      if (res.ok) body = await res.text();
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      status = -1;
      ctx.log(`    ! ${url}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!body) ctx.log(`    ! ${url}: HTTP ${status}`);
  mkdirSync(ctx.cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify({ url, status, body }));
  return body;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', reg: '®', trade: '™', copy: '©' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The page's own publication date, from its metadata; never guessed from the body. */
export function extractPublishedDate(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|publish[-_]?date|date|dc\.date|DC\.date\.issued)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|date)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    const d = m?.[1].match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (d) return d;
  }
  return undefined;
}

function titleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? htmlToText(m[1]).slice(0, 200) : '';
}

export interface Window {
  from: string;
  to: string;
}

interface EdgarHit {
  _id: string;
  _source: { ciks?: string[]; adsh?: string; file_date?: string; form?: string; display_names?: string[] };
}

/** SEC full-text search over 8-K filings in the window. */
export async function searchEdgar(query: string, w: Window, ctx: SourceContext, max = 8): Promise<Release[]> {
  const url =
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}` +
    `&forms=8-K&dateRange=custom&startdt=${w.from}&enddt=${w.to}`;
  const body = await fetchText(url, ctx, SEC_UA);
  if (!body) return [];
  let hits: EdgarHit[] = [];
  try {
    hits = (JSON.parse(body) as { hits?: { hits?: EdgarHit[] } }).hits?.hits ?? [];
  } catch {
    ctx.log(`    ! SEC search returned non-JSON for "${query}"`);
    return [];
  }
  const out: Release[] = [];
  for (const h of hits.slice(0, max)) {
    const [adsh, file] = h._id.split(':');
    const cik = h._source.ciks?.[0];
    if (!adsh || !file || !cik || !h._source.file_date) continue;
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, '')}/${file}`;
    const html = await fetchText(docUrl, ctx, SEC_UA);
    if (!html) continue;
    out.push({ url: docUrl, source: 'SEC 8-K', date: h._source.file_date, title: `${h._source.display_names?.[0] ?? 'SEC filing'} (${h._source.form ?? '8-K'})`, text: htmlToText(html) });
  }
  return out;
}

const SOURCE_NAMES: [RegExp, string][] = [
  [/(^|\.)prnewswire\.com$/, 'PR Newswire'],
  [/(^|\.)businesswire\.com$/, 'Business Wire'],
  [/(^|\.)globenewswire\.com$/, 'GlobeNewswire'],
  [/(^|\.)sec\.gov$/, 'SEC filing'],
];

function sourceName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return SOURCE_NAMES.find(([p]) => p.test(host))?.[1] ?? host;
}

/** One release page, read as published: its own date, title and text. Undefined when it can't be read or carries no date. */
export async function fetchRelease(url: string, ctx: SourceContext): Promise<Release | undefined> {
  const html = await fetchText(url, ctx);
  if (!html) return undefined;
  const date = extractPublishedDate(html);
  if (!date) {
    ctx.log(`    ! no publication date on ${url}`);
    return undefined;
  }
  return { url, source: sourceName(url), date, title: titleOf(html), text: htmlToText(html) };
}
