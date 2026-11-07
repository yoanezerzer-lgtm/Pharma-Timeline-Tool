import { z } from 'zod';
import { normalizeSponsor } from './company.js';

/**
 * Company news and press releases about a drug: links only, never their text
 * (owner, 7 Nov 2026). Only pages with no paywall: the company's own site,
 * the newswires companies publish on, and Fierce Pharma (with its sister
 * site Fierce Biotech, same publisher, also free). Found and checked by
 * `scripts/news/cli.ts`; one file per drug in data/news/<slug>.json.
 */

export const NewsLink = z.object({
  url: z.string().url(),
  /** Who published it: "PR Newswire", "Fierce Pharma", or the company's site ("abbvie.com"). */
  source: z.string(),
  /** The page's own headline, used as the link's text. */
  title: z.string().min(1),
  /** The page's own publication date (its metadata), YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** When the pipeline last opened the page and found it as recorded. */
  checkedAt: z.string(),
});
export type NewsLink = z.infer<typeof NewsLink>;

export const NewsFile = z.object({
  slug: z.string(),
  /** When a link was last added. */
  updatedAt: z.string(),
  /** When the drug was last searched, links found or not; the least recent go first. */
  searchedAt: z.string().optional(),
  links: z.array(NewsLink),
});
export type NewsFile = z.infer<typeof NewsFile>;

const NO_PAYWALL: [RegExp, string][] = [
  [/(^|\.)prnewswire\.com$/, 'PR Newswire'],
  [/(^|\.)businesswire\.com$/, 'Business Wire'],
  [/(^|\.)globenewswire\.com$/, 'GlobeNewswire'],
  [/(^|\.)fiercepharma\.com$/, 'Fierce Pharma'],
  [/(^|\.)fiercebiotech\.com$/, 'Fierce Biotech'],
];

// Words that describe a company rather than name it (see company.ts).
const GENERIC = new Set(
  'pharms pharm pharma pharmaceutical pharmaceuticals biotech biotechnology biopharma bioscience biosciences therapeutics theraps therap labs lab laboratories research development healthcare health holdings international operations medicines us usa ab ag bio anti infect'.split(
    ' '
  )
);

/** The registrable name of a host: "news.abbvie.com" → "abbvie", "ir.cytokinetics.com" → "cytokinetics". */
function siteName(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  const tld2 = parts.length >= 3 && /^(co|com)$/.test(parts[parts.length - 2]);
  return parts[parts.length - (tld2 ? 3 : 2)] ?? '';
}

/**
 * Whether a host is the company's own site: its name is the company's first
 * distinctive word ("abbvie", "lilly" for Eli Lilly) or all of them run
 * together ("novonordisk"). Only the first, so "sciences.com" isn't Gilead's.
 */
export function isCompanySite(host: string, companies: string[]): boolean {
  const site = siteName(host.toLowerCase());
  if (site.length < 3) return false;
  return companies.some((c) => {
    const words = normalizeSponsor(c)
      .split(/[\s-]+/)
      .filter((w) => w.length >= 3 && !GENERIC.has(w));
    const first = words.find((w) => w.length >= 4) ?? words[0];
    return site === first || (words.length > 1 && words.join('') === site);
  });
}

/** Every name the drug's company goes by in its record: sponsor, FDA applicant, the label's company. */
export function companiesOf(drug: {
  sponsor: string;
  regulatory: { us: { sponsor?: string; labelCompany?: { name: string } } };
}): string[] {
  return [drug.sponsor, drug.regulatory.us.sponsor, drug.regulatory.us.labelCompany?.name].filter((c): c is string => Boolean(c));
}

/** Who published a page, when it is a site we may link to; undefined otherwise. */
export function allowedSource(url: string, companies: string[]): string | undefined {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    host = u.hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const wire = NO_PAYWALL.find(([p]) => p.test(host));
  if (wire) return wire[1];
  return isCompanySite(host, companies) ? host.replace(/^www\./, '').split('.').slice(-2).join('.') : undefined;
}

/** The names a page may use for the drug: the brand without "(copackaged)" or a pen name, and the ingredient. */
export function drugNames(brandName: string, inn: string): { brand: string; inn: string } {
  const brand = brandName
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(flextouch|kwikpen|pen|autoinjector)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { brand, inn: inn.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim() };
}

function wordPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\u00a0-]+');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i');
}

/**
 * Whether a page is about the drug: its own headline or its own one-line
 * summary names the brand or the ingredient. A name only further down the
 * page (an earnings report, a round-up, a "related stories" box) isn't
 * enough: the trial run on 7 Nov let in Amgen's and Halozyme's quarterly
 * results for Keytruda that way.
 */
export function namesDrug(page: { title: string; summary: string }, names: { brand: string; inn: string }): boolean {
  const lead = `${page.title}\n${page.summary}`;
  return [names.brand, names.inn].some((n) => n.length >= 4 && wordPattern(n).test(lead));
}

/** Newest first; one link per address. */
export function sortLinks(links: NewsLink[]): NewsLink[] {
  const byUrl = new Map<string, NewsLink>();
  for (const l of links) {
    const prev = byUrl.get(l.url);
    if (!prev || l.checkedAt > prev.checkedAt) byUrl.set(l.url, l);
  }
  return [...byUrl.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
