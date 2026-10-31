import type { IngestContext } from './context.js';
import { fetchJson, fetchText } from './http.js';
import { sameDisease } from './diseases.js';
import { parseResults, summaryParagraphs } from './medlineplus.js';

/**
 * Plain-language explanations of a disease from two more public-domain,
 * patient-facing sources, for diseases MedlinePlus's health topics don't
 * cover:
 *
 * - MedlinePlus Genetics (National Library of Medicine): one page per
 *   genetic condition, written for the public. Rare inherited diseases
 *   (hyperargininemia, Alexander disease) are covered here, not in the
 *   health topics.
 * - The NCI Dictionary of Cancer Terms (National Cancer Institute): a short
 *   patient definition for each cancer. NCI's text is in the public domain;
 *   credit NCI and cancer.gov.
 *
 * As with MedlinePlus, an entry counts only when its own name is the disease:
 * the MeSH term or one of MeSH's synonyms for it (the terms of its preferred
 * concept, which MeSH treats as the same meaning). A Genetics page's listed
 * other names also count: each page is about one condition, so they are its
 * synonyms, not narrower diseases.
 */

export interface PlainSource {
  title: string;
  url: string;
  paragraphs: string[];
  sourceLabel: string;
}

const SEARCH = 'https://wsearch.nlm.nih.gov/ws/query';
const GENETICS_JSON = 'https://medlineplus.gov/download/genetics/condition';
const NCI_GLOSSARY = 'https://webapis.cancer.gov/glossary/v1/Terms/Cancer.gov/Patient/en/search';

const named = (candidates: string[], names: string[]) => candidates.some((c) => names.some((n) => sameDisease(c, n)));

/** A MedlinePlus Genetics condition record (the JSON download of a condition page). */
interface GeneticsCondition {
  name?: string;
  'synonym-list'?: { synonym?: string }[] | { synonym?: string };
  'text-list'?: { text?: { 'text-role'?: string; html?: string } }[];
}

const asList = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** The condition's description paragraphs, from its JSON record. */
export function geneticsParagraphs(record: GeneticsCondition): string[] {
  const description = asList(record['text-list']).find((t) => t.text?.['text-role'] === 'description');
  return description?.text?.html ? summaryParagraphs(description.text.html) : [];
}

export function geneticsNames(record: GeneticsCondition): string[] {
  return [record.name ?? '', ...asList(record['synonym-list']).map((s) => s.synonym ?? '')].filter((n) => n.length > 0);
}

/** The condition slug of a Genetics page URL ("…/genetics/condition/arginase-1-deficiency/"). */
export function geneticsSlug(url: string): string | undefined {
  return url.match(/\/genetics\/condition\/([a-z0-9-]+)\/?$/)?.[1];
}

export async function geneticsCondition(ctx: IngestContext, names: string[]): Promise<PlainSource | undefined> {
  const xml = await fetchText(`${SEARCH}?db=ghr&term=${encodeURIComponent(names[0])}&retmax=5`, { ctx, kind: 'genetics' });
  const slugs = [...new Set(parseResults(xml ?? '').map((r) => geneticsSlug(r.url)).filter((s): s is string => !!s))];
  for (const slug of slugs.slice(0, 3)) {
    const record = await fetchJson<GeneticsCondition>(`${GENETICS_JSON}/${slug}.json`, { ctx, kind: 'genetics' });
    if (!record || !named(geneticsNames(record), names)) continue;
    const paragraphs = geneticsParagraphs(record);
    if (paragraphs.length === 0) continue;
    return {
      title: record.name!,
      url: `https://medlineplus.gov/genetics/condition/${slug}/`,
      paragraphs,
      sourceLabel: 'MedlinePlus Genetics, U.S. National Library of Medicine',
    };
  }
  return undefined;
}

/** One entry of the NCI glossary API's search answer. */
interface NciTerm {
  termName?: string;
  prettyUrlName?: string;
  definition?: { text?: string; html?: string };
}

export function nciEntry(results: NciTerm[], names: string[]): PlainSource | undefined {
  const hit = results.find((r) => r.termName && named([r.termName], names) && (r.definition?.text ?? '').trim().length > 0);
  if (!hit) return undefined;
  return {
    title: hit.termName!,
    url: `https://www.cancer.gov/publications/dictionaries/cancer-terms/def/${hit.prettyUrlName ?? encodeURIComponent(hit.termName!)}`,
    paragraphs: [hit.definition!.text!.replace(/\s+/g, ' ').trim()],
    sourceLabel: 'NCI Dictionary of Cancer Terms, National Cancer Institute',
  };
}

export async function nciDictionary(ctx: IngestContext, names: string[]): Promise<PlainSource | undefined> {
  for (const name of names) {
    const res = await fetchJson<{ results?: NciTerm[] }>(`${NCI_GLOSSARY}/${encodeURIComponent(name.toLowerCase())}?matchType=Begins&size=10`, {
      ctx,
      kind: 'nci',
    });
    const entry = nciEntry(res?.results ?? [], names);
    if (entry) return entry;
  }
  return undefined;
}
