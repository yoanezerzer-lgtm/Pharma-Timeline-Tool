import type { IngestContext } from './context.js';
import { fetchText } from './http.js';
import { sameDisease } from './diseases.js';

/**
 * A plain-language summary of a disease from MedlinePlus, the National
 * Library of Medicine's consumer health site, for readers new to it.
 *
 * Read from MedlinePlus's search service. A health topic is used only when
 * its title is the same disease as the MeSH term ("Rheumatoid Arthritis"
 * for "Arthritis, Rheumatoid"). Neither the other names it lists nor the
 * MeSH headings it is filed under count: both include narrower diseases
 * ("Dwarfism" lists Achondroplasia, "Skin Cancer" Merkel cell carcinoma),
 * and the summary is about the broader topic. A true synonym under another
 * title ("High Blood Pressure" for Hypertension) is left out with them.
 * Health topic summaries are written by NLM and free to reuse with credit.
 */

const SEARCH = 'https://wsearch.nlm.nih.gov/ws/query';

export interface MedlinePlusTopic {
  title: string;
  url: string;
  /** The summary's paragraphs and list items, as plain text, in order. */
  paragraphs: string[];
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** Summary HTML ("<p>…</p><ul><li>…</li></ul>") as plain paragraphs, list items marked "• ". */
export function summaryParagraphs(html: string): string[] {
  return decode(html)
    .replace(/<li[^>]*>/gi, '\n• ')
    // A heading ("<h3>What is RA?</h3>", or a bold lead-in question) is its own line.
    .replace(/<\/(p|li|ul|ol|h\d|div)>|<br\s*\/?>|<h\d[^>]*>/gi, '\n')
    .replace(/(\?)\s*<\/(strong|b)>/gi, '$1</$2>\n')
    .split('\n')
    .map((line) => decode(stripTags(line)).replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && line !== '•');
}

/** The health topics in a search response: each topic's title, other names, link and summary. */
export function parseResults(xml: string): { title: string; names: string[]; url: string; summary: string }[] {
  const out: { title: string; names: string[]; url: string; summary: string }[] = [];
  for (const doc of xml.matchAll(/<document\b[^>]*\burl="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g)) {
    const contents = [...doc[2].matchAll(/<content name="([^"]+)">([\s\S]*?)<\/content>/g)].map((m) => ({
      name: m[1],
      value: m[2],
    }));
    const text = (name: string) => contents.filter((c) => c.name === name).map((c) => decode(stripTags(decode(c.value))).trim());
    const [title] = text('title');
    if (!title) continue;
    out.push({
      title,
      names: [title, ...text('altTitle')],
      url: decode(doc[1]),
      summary: contents.find((c) => c.name === 'FullSummary')?.value ?? '',
    });
  }
  return out;
}

export async function medlinePlusTopic(ctx: IngestContext, term: string): Promise<MedlinePlusTopic | undefined> {
  const url = `${SEARCH}?db=healthTopics&term=${encodeURIComponent(term)}&retmax=5`;
  const xml = await fetchText(url, { ctx, kind: 'medlineplus' });
  if (!xml) return undefined;
  const topic = parseResults(xml).find((t) => sameDisease(t.title, term));
  if (!topic) return undefined;
  const paragraphs = summaryParagraphs(topic.summary);
  return paragraphs.length > 0 ? { title: topic.title, url: topic.url, paragraphs } : undefined;
}
