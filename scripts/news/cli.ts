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
const ROOT = process.cwd();
const NEWS_DIR = join(ROOT, 'data', 'news');

/** The page's own headline: its og:title, else its <title> without the site name. */
export function headlineOf(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const t = og ? htmlToText(og) : titleOf(html);
  return t.replace(/\s+[|–—-]\s+(Fierce \w+|PR Newswire|Business Wire|GlobeNewswire.*)$/i, '').trim();
}

/** The address without tracking parameters or a fragment, so one page is one link. */
export function cleanUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|mc_|cmp|ref$|src$|tc$)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

function load(slug: string): NewsLink[] {
  const path = join(NEWS_DIR, `${slug}.json`);
  return existsSync(path) ? NewsFile.parse(JSON.parse(readFileSync(path, 'utf8'))).links : [];
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

  let added = 0;
  for (const slug of slugs) {
    const drug = Drug.parse(JSON.parse(readFileSync(join(ROOT, 'data', 'drugs', `${slug}.json`), 'utf8')));
    const names = drugNames(drug.brandName, drug.inn);
    const companies = companiesOf(drug);
    const ctx: SourceContext = { cacheDir: join(ROOT, 'data', 'raw', slug, 'news'), refresh, log };
    log(`${slug} (${names.brand} / ${names.inn})`);

    const items: FeedItem[] = [
      ...(await searchFeeds(names, ctx)),
      ...fierce.filter((i) => namesDrug({ title: i.title, text: i.description }, names)),
    ];
    const known = load(slug);
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
      const html = await fetchText(url, ctx);
      if (!html) continue;
      const title = headlineOf(html);
      const date = extractPublishedDate(html);
      if (!title || !date) {
        log(`    - ${url}: no ${title ? 'date' : 'headline'} on the page`);
        continue;
      }
      if (!namesDrug({ title, text: htmlToText(html) }, names)) {
        log(`    - ${url}: page doesn't name the drug`);
        continue;
      }
      found.push({ url, source, title, date, checkedAt: now });
      log(`    + ${date} ${source}: ${title}`);
    }

    const links = sortLinks([...known, ...found]).slice(0, MAX_LINKS);
    added += found.length;
    // Nothing new: the file is left alone, so a quiet week makes no commit.
    if (found.length === 0) continue;
    mkdirSync(NEWS_DIR, { recursive: true });
    const file: NewsFile = { slug, updatedAt: now, links };
    writeFileSync(join(NEWS_DIR, `${slug}.json`), `${JSON.stringify(NewsFile.parse(file), null, 2)}\n`);
  }
  log(`\n${added} new link(s) across ${slugs.length} drug(s).`);
}

if (process.argv[1]?.endsWith('cli.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
