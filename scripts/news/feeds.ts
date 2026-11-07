import { fetchText, htmlToText, type SourceContext } from '../readouts/sources.js';

/**
 * Where news about a drug is looked for. A feed only suggests addresses:
 * every link is then opened and its date, headline and mention of the drug
 * are read from the page itself (cli.ts).
 *
 * - Bing News search (RSS): recent news from any outlet, by drug name.
 *   GlobeNewswire's own keyword feed refuses automated requests (403), so
 *   its releases come through the search.
 * - Fierce Pharma and Fierce Biotech front-page feeds: their latest stories,
 *   kept when the headline or summary names the drug.
 *
 * A feed that refuses or changes shape gives nothing; the run goes on.
 */

export interface FeedItem {
  url: string;
  title: string;
  description: string;
  feed: string;
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

/** Bing wraps each address in a click-tracking link; the real one is its `url` parameter. */
export function unwrapLink(link: string): string {
  const raw = htmlToText(link).trim();
  try {
    const u = new URL(raw);
    if (/(^|\.)bing\.com$/.test(u.hostname)) return u.searchParams.get('url') ?? raw;
  } catch {
    // not a URL: returned as is and dropped later
  }
  return raw;
}

/** The items of an RSS 2.0 or Atom feed. */
export function parseFeed(xml: string, feed: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  return blocks
    .map((b) => {
      const atomHref = /<link\b[^>]*href=["']([^"']+)["']/i.exec(b)?.[1];
      const link = tag(b, 'link') || atomHref || '';
      return {
        url: unwrapLink(link),
        title: htmlToText(tag(b, 'title')),
        description: htmlToText(htmlToText(tag(b, 'description') || tag(b, 'summary'))),
        feed,
      };
    })
    .filter((i) => /^https?:\/\//.test(i.url));
}

const quoted = (names: string[]) => names.filter(Boolean).map((n) => `"${n}"`).join(' OR ');

export async function searchFeeds(names: { brand: string; inn: string }, ctx: SourceContext): Promise<FeedItem[]> {
  const terms = quoted([names.brand, names.inn]);
  const sites = '(site:prnewswire.com OR site:businesswire.com OR site:globenewswire.com OR site:fiercepharma.com OR site:fiercebiotech.com)';
  const feeds: [string, string][] = [
    // An "A OR B" query on its own comes back empty (trial run, 7 Nov), so
    // each name is searched alone; with the site filter, OR works.
    ...[names.brand, names.inn]
      .filter((n) => n.length >= 4)
      .map((n): [string, string] => ['Bing News', `https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(n)}`]),
    ['Bing News (wires)', `https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(`(${terms}) ${sites}`)}`],
  ];
  const out: FeedItem[] = [];
  for (const [name, url] of feeds) {
    const xml = await fetchText(url, ctx);
    const items = xml ? parseFeed(xml, name) : [];
    ctx.log(`    ${name}: ${items.length} item(s)`);
    out.push(...items);
  }
  return out;
}

/** Fierce's latest stories, read once per run and shared by every drug. */
export async function latestFierce(ctx: SourceContext): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  for (const [name, url] of [
    ['Fierce Pharma', 'https://www.fiercepharma.com/rss/xml'],
    ['Fierce Biotech', 'https://www.fiercebiotech.com/rss/xml'],
  ]) {
    const xml = await fetchText(url, ctx);
    const items = xml ? parseFeed(xml, name) : [];
    ctx.log(`  ${name} feed: ${items.length} item(s)`);
    out.push(...items);
  }
  return out;
}
