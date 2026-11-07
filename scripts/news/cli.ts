/**
 * Finds company news and press releases about each drug and records links
 * to them in data/news/<slug>.json, newest first.
 *
 *   npm run news -- [slug ...] [--refresh]
 *
 * Links only, never the article's text, and only on sites with no paywall
 * (src/lib/news.ts). Each address a feed suggests is opened, and kept only
 * when the page itself gives a publication date and names the drug; the
 * headline and date are read from the page, never from the feed. Links found
 * on earlier runs are kept, so the list grows week by week.
 *
 * Needs network access: runs on GitHub Actions (.github/workflows/news.yml).
 * What it read is cached under data/raw/<slug>/news/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../../src/schema/index.js';
import { allowedSource, companiesOf, drugNames, namesDrug, NewsFile, sortLinks, type NewsLink } from '../../src/lib/news.js';
import { extractPublishedDate, fetchText, htmlToText, titleOf, type SourceContext } from '../readouts/sources.js';
import { latestFierce, searchFeeds, type FeedItem } from './feeds.js';

const MAX_LINKS = 20;
/** Pages opened per drug per run; the rest wait for next week. */
const MAX_PAGES = 30;
/**
 * Minutes after which no new drug is started, so the run always finishes
 * and publishes what it found; the drugs it didn't reach go first next time.
 */
const BUDGET_MINUTES = Number(process.env.NEWS_BUDGET_MINUTES ?? 40);
const ROOT = process.cwd();
const NEWS_DIR = join(ROOT, 'data', 'news');

/** A <meta> tag's content by its property or name, either attribute order, quotes kept apart so "Takeda's" survives. */
function meta(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
    const k = attr('property') ?? attr('name');
    if ((k?.[1] ?? k?.[2])?.toLowerCase() !== key) continue;
    const c = attr('content');
    const v = c?.[1] ?? c?.[2];
    if (v) return htmlToText(v);
  }
  return undefined;
}

/** The page's own one-line summary (its og:description or description). */
export function summaryOf(html: string): string {
  return meta(html, 'og:description') ?? meta(html, 'description') ?? '';
}

/** The page's own headline: its og:title, else its <title> without the site name. */
export function headlineOf(html: string): string {
  const og = meta(html, 'og:title');
  const t = og ?? titleOf(html);
  return t.replace(/\s+[|–—-]\s+(Fierce \w+|PR Newswire|Business Wire|GlobeNewswire.*)$/i, '').trim();
}

/** The address without tracking parameters or a fragment, so one page is one link. */
export function cleanUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|mc_|cmp|ref$|src$|tc$)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

function loadFile(slug: string): NewsFile | undefined {
  const path = join(NEWS_DIR, `${slug}.json`);
  return existsSync(path) ? NewsFile.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
}

/** Never searched first, then the longest ago. */
export function searchOrder(slugs: string[], searchedAt: (slug: string) => string | undefined): string[] {
  return [...slugs].sort((a, b) => (searchedAt(a) ?? '').localeCompare(searchedAt(b) ?? '') || a.localeCompare(b));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const only = args.filter((a) => !a.startsWith('--'));
  const slugs = only.length
    ? only
    : readdirSync(join(ROOT, 'data', 'drugs')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const log = (m: string) => console.log(m);
  const now = new Date().toISOString();
  const fierce = await latestFierce({ cacheDir: join(ROOT, 'data', 'raw', '_news'), refresh, log });

  const started = Date.now();
  const ordered = only.length ? slugs : searchOrder(slugs, (slug) => loadFile(slug)?.searchedAt);
  let added = 0;
  let searched = 0;
  for (const slug of ordered) {
    if (Date.now() - started > BUDGET_MINUTES * 60000) {
      log(`\nTime budget of ${BUDGET_MINUTES} minutes used: ${ordered.length - searched} drug(s) wait for the next run.`);
      break;
    }
    searched++;
    const drug = Drug.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'drugs', `${slug}.json`), 'utf8')));
    const names = drugNames(drug.brandName, drug.inn);
    const companies = companiesOf(drug);
    const ctx: SourceContext = { cacheDir: join(ROOT, 'data', 'raw', slug, 'news'), refresh, log };
    log(`${slug} (${names.brand} / ${names.inn})`);

    const items: FeedItem[] = [
      ...(await searchFeeds(names, ctx)),
      ...fierce.filter((i) => namesDrug({ title: i.title, summary: i.description }, names)),
    ];
    const previous = loadFile(slug);
    const known = previous?.links ?? [];
    let opened = 0;
    const seen = new Set(known.map((l) => l.url));
    const found: NewsLink[] = [];
    for (const item of items) {
      let url: string;
      try {
        url = cleanUrl(item.url);
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      const source = allowedSource(url, companies);
      if (!source) continue;
      if (++opened > MAX_PAGES) break;
      const html = await fetchText(url, ctx);
      if (!html) continue;
      const title = headlineOf(html);
      const date = extractPublishedDate(html);
      if (!title || !date) {
        log(`    - ${url}: no ${title ? 'date' : 'headline'} on the page`);
        continue;
      }
      if (!namesDrug({ title, summary: summaryOf(html) }, names)) {
        log(`    - ${url}: headline and summary don't name the drug`);
        continue;
      }
      found.push({ url, source, title, date, checkedAt: now });
      log(`    + ${date} ${source}: ${title}`);
    }

    const links = sortLinks([...known, ...found]).slice(0, MAX_LINKS);
    added += found.length;
    mkdirSync(NEWS_DIR, { recursive: true });
    const file: NewsFile = {
      slug,
      updatedAt: found.length ? now : (previous?.updatedAt ?? now),
      searchedAt: now,
      links,
    };
    writeFileSync(join(NEWS_DIR, `${slug}.json`), `${JSON.stringify(NewsFile.parse(file), null, 2)}\n`);
    log(`  (${Math.round((Date.now() - started) / 60000)} min)`);
  }
  log(`\n${added} new link(s) across ${searched} of ${ordered.length} drug(s).`);
}

if (process.argv[1]?.endsWith('cli.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
