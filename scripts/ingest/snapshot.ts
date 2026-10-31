import type { IngestContext } from './context.js';
import { fetchText } from './http.js';

/**
 * The FDA's Drug Trials Snapshot for a new medicine: a plain-language page,
 * written by the FDA for the public, on what the drug is for, how it is used,
 * who took part in the trials that supported its approval, what those trials
 * showed, and its side effects. Public domain.
 *
 * Read word for word: each section's heading (the Snapshot's own question,
 * "What are the benefits of this drug?") and its paragraphs. Nothing is
 * rephrased. A Snapshot describes the original approval only.
 */

export interface SnapshotSection {
  heading: string;
  paragraphs: string[];
}

export interface Snapshot {
  url: string;
  sections: SnapshotSection[];
}

const BASES = [
  'https://www.fda.gov/drugs/drug-trials-snapshots/drug-trials-snapshots-',
  'https://www.fda.gov/drugs/drug-approvals-and-databases/drug-trials-snapshots-',
];

/** The page names a Snapshot may go by: the full brand ("rybrevant-faspro"), then its first word ("awiqli"). */
export function snapshotSlugs(brandName: string): string[] {
  const full = brandName
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const first = full.split('-')[0];
  return [...new Set([full, first])].filter((s) => s.length > 1);
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/**
 * The Snapshot's sections from its page HTML. A heading is a line the page
 * sets as a heading or in bold that asks a question ("How is this drug
 * used?") or names a part ("DRUG", "BENEFITS"); its section runs to the next.
 * Tables (the demographic breakdowns) and the page's navigation are left out.
 */
export function parseSnapshot(html: string): SnapshotSection[] {
  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html;
  const text = main
    .replace(/<(script|style|nav|table|figure|noscript)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => `\n\u0001${inner}\n`)
    .replace(/<p\b[^>]*>\s*<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>\s*<\/p>/gi, (_, __, inner: string) => `\n\u0001${inner}\n`)
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?(p|div|ul|ol|li|section|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const sections: SnapshotSection[] = [];
  for (const raw of decode(text).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line === '•') continue;
    if (line.startsWith('\u0001')) {
      const heading = line.slice(1).trim();
      if (heading) sections.push({ heading, paragraphs: [] });
      continue;
    }
    sections.at(-1)?.paragraphs.push(line);
  }
  // Keep the Snapshot's own sections: those asking a question about the drug, with something under them.
  return sections.filter((s) => s.paragraphs.length > 0 && /\?$/.test(s.heading));
}

/** Every address a brand's Snapshot may live at, in the order tried. */
export function snapshotUrls(brandName: string): string[] {
  return snapshotSlugs(brandName).flatMap((slug) => BASES.map((base) => `${base}${slug}`));
}

export async function drugTrialsSnapshot(ctx: IngestContext, brandName: string): Promise<Snapshot | undefined> {
  for (const url of snapshotUrls(brandName)) {
    const html = await fetchText(url, { ctx, kind: 'snapshot' });
    if (!html) continue;
    const sections = parseSnapshot(html);
    if (sections.length > 0) return { url, sections };
  }
  return undefined;
}
