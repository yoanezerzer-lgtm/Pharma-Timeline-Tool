import type { Disease, Trial } from '../../src/schema/index.js';
import type { IngestContext } from './context.js';
import { fetchJson } from './http.js';
import { ABBREVIATIONS } from './approvals.js';
import { medlinePlusTopic } from './medlineplus.js';
import { geneticsCondition, nciDictionary, type PlainSource } from './plainSources.js';

/**
 * Which disease each approved use is for, as a MeSH term, so disease pages
 * can put every approval for one disease side by side.
 *
 * The term comes from ClinicalTrials.gov, where the National Library of
 * Medicine assigns MeSH terms to each trial's conditions. An approved use's
 * disease is a term on one of its pivotal trials that the FDA's wording
 * names ("Arthritis, Rheumatoid" for "Rheumatoid Arthritis"), keeping the
 * most specific when several are named ("Arthritis" gives way). A term the
 * wording doesn't name is never used, however the trials are tagged: the
 * registry's tags can be wrong (one Keytruda lymphoma trial carries
 * "Parkinson Disease 4"). Anything else is left unmatched.
 *
 * Its definition and therapeutic areas (MeSH's top-level disease
 * categories, e.g. "Neoplasms") are read from NLM's MeSH service.
 */

const MESH = 'https://id.nlm.nih.gov/mesh';

// Words MeSH and the FDA use interchangeably for a malignancy.
const SAME_WORD: Record<string, string> = { carcinoma: 'cancer', neoplasm: 'cancer', tumor: 'cancer', tumour: 'cancer' };

/** The FDA's abbreviations spelled out ("NSCLC"), so the wording can be read against MeSH's full terms. */
function expand(wording: string): string {
  return wording.replace(/[A-Za-z][A-Za-z-]*[A-Z][A-Za-z-]*/g, (w) => (ABBREVIATIONS[w] ? `${w} ${ABBREVIATIONS[w]}` : w));
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
      .map((w) => w.replace(/(?<=[a-z]{3})s$/, ''))
      .map((w) => SAME_WORD[w] ?? w)
  );

/** Whether the FDA's wording names the term: every word of it appears ("Arthritis, Rheumatoid" in "Rheumatoid Arthritis"). */
/** Whether two names are the same disease: the same words in any order ("Rheumatoid Arthritis", "Arthritis, Rheumatoid"). */
export function sameDisease(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
}

export function namesTerm(wording: string, term: string): boolean {
  const have = words(expand(wording));
  const need = [...words(term)];
  return need.length > 0 && need.every((w) => have.has(w));
}

export interface MatchedTerm {
  id: string;
  term: string;
  trials: Trial[];
  /** The FDA's own words that are one of MeSH's names for the term, when matched that way. */
  phrase?: string;
}

// Words that never start or end a disease's name.
const EDGE = new Set([
  'a', 'an', 'and', 'or', 'of', 'the', 'in', 'with', 'for', 'to', 'who', 'whose', 'that', 'than', 'by', 'as', 'at',
  'on', 'from', 'have', 'has', 'had', 'been', 'are', 'is', 'not', 'other', 'when', 'those', 'their', 'after', 'its',
]);
const LOWER = new Set(['of', 'the', 'and', 'or', 'in', 'with', 'to', 'for', 'a', 'an', 'by', 'on', 'at', 'as']);
const title = (w: string) => w.replace(/(^|-)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

/**
 * Runs of up to five of the FDA's words, spelled the ways MeSH spells its
 * names ("Atopic Dermatitis", "Atopic dermatitis"), each with where it sits in
 * the wording. A run never crosses punctuation, starts or ends on a small
 * word, or holds a number.
 */
export function candidatePhrases(wording: string): { text: string; start: number; end: number; variants: string[] }[] {
  const out: { text: string; start: number; end: number; variants: string[] }[] = [];
  let offset = 0;
  for (const segment of wording.split(/[,;:()[\]•.]+|\s[-–—]\s/)) {
    const tokens = segment.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      for (let n = 1; n <= 5 && i + n <= tokens.length; n++) {
        const run = tokens.slice(i, i + n);
        const [first, last] = [run[0].toLowerCase(), run[n - 1].toLowerCase()];
        if (EDGE.has(first) || EDGE.has(last) || run.some((t) => /\d/.test(t)) || run.join('').length < 4) continue;
        const lower = run.map((t) => (/^[A-Z0-9-]+$/.test(t) && t.length > 1 ? t : t.toLowerCase()));
        const titled = lower.map((t, k) => (k > 0 && LOWER.has(t) ? t : title(t))).join(' ');
        const sentence = lower.join(' ').replace(/^./, (c) => c.toUpperCase());
        const variants = [titled, sentence];
        // MeSH files cancers as neoplasms or carcinomas ("Stomach Neoplasms", "Urothelial Carcinoma").
        if (/ cancer$/i.test(titled)) variants.push(titled.replace(/Cancer$/, 'Carcinoma'), titled.replace(/Cancer$/, 'Neoplasms'));
        out.push({ text: run.join(' '), start: offset + i, end: offset + i + n, variants: [...new Set(variants)] });
      }
    }
    offset += tokens.length + 1;
  }
  return out;
}

const sparqlString = (s: string) => `"${s.replace(/["\\]/g, '')}"@en`;

/**
 * The MeSH descriptors one of whose names (its heading or an entry term) is
 * exactly a run of the FDA's words: "Hodgkin Lymphoma" is an entry term of
 * "Hodgkin Disease", "Atopic Dermatitis" of "Dermatitis, Atopic". A run
 * inside a longer matched run gives way to it ("Dermatitis" to "Atopic
 * Dermatitis").
 */
/** The SPARQL requests that look a wording's runs up in MeSH, with the runs and spellings each covers. */
export function meshWordingQueries(wording: string) {
  const phrases = candidatePhrases(wording);
  const byVariant = new Map<string, number[]>();
  phrases.forEach((p, k) => p.variants.forEach((v) => byVariant.set(v, [...(byVariant.get(v) ?? []), k])));
  const variants = [...byVariant.keys()];
  const urls: string[] = [];
  for (let i = 0; i < variants.length; i += 100) {
    const chunk = variants.slice(i, i + 100);
    const query =
      `${SPARQL_PREFIX}SELECT DISTINCT ?name ?d ?term WHERE { VALUES ?name { ${chunk.map(sparqlString).join(' ')} } ` +
      `?t meshv:prefLabel ?name . ?c meshv:preferredTerm|meshv:term ?t . ?d meshv:preferredConcept|meshv:concept ?c . ` +
      `?d a meshv:TopicalDescriptor . ?d rdfs:label ?term }`;
    urls.push(`${MESH}/sparql?query=${encodeURIComponent(query)}&format=JSON&inference=false`);
  }
  return { phrases, byVariant, urls };
}

export async function meshByWording(ctx: IngestContext, wording: string): Promise<{ id: string; term: string; phrase: string }[]> {
  const { phrases, byVariant, urls } = meshWordingQueries(wording);
  const hits: { k: number; id: string; term: string }[] = [];
  for (const url of urls) {
    const res = await fetchJson<{ results?: { bindings?: { name?: { value?: string }; d?: { value?: string }; term?: { value?: string } }[] } }>(url, { ctx, kind: 'mesh' });
    for (const b of res?.results?.bindings ?? []) {
      const [name, d, term] = [b.name?.value, b.d?.value, b.term?.value];
      if (!name || !d || !term) continue;
      for (const k of byVariant.get(name) ?? []) hits.push({ k, id: idOf(d), term });
    }
  }
  const spans = hits.map((h) => phrases[h.k]);
  const kept = hits.filter((h) => {
    const p = phrases[h.k];
    return !spans.some((o) => o !== p && o.end - o.start > p.end - p.start && o.start <= p.start && o.end >= p.end);
  });
  const byId = new Map<string, { id: string; term: string; phrase: string }>();
  for (const h of kept) if (!byId.has(h.id)) byId.set(h.id, { id: h.id, term: h.term, phrase: phrases[h.k].text });
  return [...byId.values()];
}

/**
 * When the trials' own terms don't name the use: MeSH's names for it in the
 * FDA's words, kept only if the pivotal trials agree where they carry terms
 * at all (Keytruda's "Classical Hodgkin Lymphoma" trials are filed under
 * "Hodgkin Disease"). Trials registered before MeSH tagging (Protopic's)
 * leave the wording alone to decide.
 */
export async function matchByWording(ctx: IngestContext, wording: string, pivotal: Trial[]): Promise<MatchedTerm[]> {
  const tagged = new Set(pivotal.flatMap((t) => (t.conditionMesh ?? []).map((m) => m.id)));
  const found = await meshByWording(ctx, wording);
  return found
    .filter((f) => tagged.size === 0 || tagged.has(f.id))
    .map((f) => ({ ...f, trials: pivotal.filter((t) => (t.conditionMesh ?? []).some((m) => m.id === f.id)) }))
    .sort((a, b) => a.term.localeCompare(b.term));
}

export function matchDiseases(wording: string, pivotal: Trial[]): MatchedTerm[] {
  const byId = new Map<string, MatchedTerm>();
  for (const t of pivotal) {
    for (const m of t.conditionMesh ?? []) {
      if (!namesTerm(wording, m.term)) continue;
      const entry = byId.get(m.id) ?? { id: m.id, term: m.term, trials: [] };
      entry.trials.push(t);
      byId.set(m.id, entry);
    }
  }
  const named = [...byId.values()];
  // "Arthritis" gives way to "Arthritis, Rheumatoid": a term whose words all appear in a longer named one.
  const specific = named.filter((m) => {
    const w = words(m.term);
    return !named.some((o) => o !== m && words(o.term).size > w.size && [...w].every((x) => words(o.term).has(x)));
  });
  return specific.sort((a, b) => a.term.localeCompare(b.term));
}

interface Literal {
  '@value'?: string;
}
const value = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? (v as Literal)['@value'] : undefined;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const idOf = (uri: string) => uri.replace(/^.*\//, '');

interface MeshInfo {
  definition?: string;
  definitionUrl?: string;
  areas: string[];
  /** False when MeSH files the term under no disease category: a finding, not a disease ("Microsatellite Instability"). */
  isDisease: boolean;
  /** Filed under MeSH's "Genetic Diseases, Inborn" (tree C16.320): an inherited disease. */
  inherited?: boolean;
  /** The terms of the descriptor's preferred concept: names MeSH treats as the same meaning ("Breast Cancer"). */
  synonyms: string[];
  plain?: PlainSource;
}

const SPARQL_PREFIX =
  'PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ';

/** A MeSH disease's definition, and the names of the top-level categories (C04, F03…) its tree numbers fall under. */
export async function meshInfo(ctx: IngestContext, id: string): Promise<MeshInfo> {
  const descriptor = await fetchJson<Record<string, unknown>>(`${MESH}/${id}.json`, { ctx, kind: 'mesh' });
  if (!descriptor) return { areas: [], isDisease: true, synonyms: [] };
  const conceptUri = value(descriptor.preferredConcept) ?? (descriptor.preferredConcept as { '@id'?: string })?.['@id'];
  let definition: string | undefined;
  let definitionUrl: string | undefined;
  const synonyms: string[] = [];
  if (conceptUri) {
    definitionUrl = `${MESH}/${idOf(conceptUri)}.json`;
    const concept = await fetchJson<Record<string, unknown>>(definitionUrl, { ctx, kind: 'mesh' });
    definition = value(concept?.scopeNote)?.trim();
    // Only the preferred concept's terms: a descriptor's other concepts can be narrower diseases.
    const termUris = [...list(concept?.preferredTerm), ...list(concept?.term)]
      .map((t) => value(t) ?? (t as { '@id'?: string })?.['@id'])
      .filter((t): t is string => !!t);
    for (const uri of [...new Set(termUris)].slice(0, 12)) {
      const term = await fetchJson<Record<string, unknown>>(`${MESH}/${idOf(uri)}.json`, { ctx, kind: 'mesh' });
      const label = (value(term?.prefLabel) ?? value(term?.label))?.trim();
      if (label) synonyms.push(label);
    }
  }
  const trees = list(descriptor.treeNumber).map((t) => idOf(value(t) ?? (t as { '@id'?: string })?.['@id'] ?? ''));
  const inherited = trees.some((t) => t === 'C16.320' || t.startsWith('C16.320.'));
  // Diseases (C) and mental disorders (F03) only: a tree number like
  // "C05.550.114.099" sits under category C05.
  const tops = [
    ...new Set(
      list(descriptor.treeNumber)
        .map((t) => idOf(value(t) ?? (t as { '@id'?: string })?.['@id'] ?? ''))
        .map((t) => t.split('.')[0])
        .filter((t) => /^(C\d\d|F03)$/.test(t))
    ),
  ].sort();
  const areas: string[] = [];
  for (const top of tops) {
    const query = `${SPARQL_PREFIX}SELECT ?label WHERE { ?d meshv:treeNumber mesh:${top} . ?d rdfs:label ?label }`;
    const url = `${MESH}/sparql?query=${encodeURIComponent(query)}&format=JSON&inference=false`;
    const res = await fetchJson<{ results?: { bindings?: { label?: { value?: string } }[] } }>(url, { ctx, kind: 'mesh' });
    const label = res?.results?.bindings?.[0]?.label?.value;
    if (label) areas.push(label);
  }
  return { definition, definitionUrl, areas, isDisease: tops.length > 0, inherited, synonyms: [...new Set(synonyms)] };
}

const ctgovUrl = (t: Trial) => (t.nctId ? `https://clinicaltrials.gov/study/${t.nctId}` : undefined);

/** Each approved use's diseases, with definitions and areas looked up once per term. */
export async function indicationDiseases(
  ctx: IngestContext,
  indications: { name: string }[],
  trials: Trial[]
): Promise<Map<string, Disease[]>> {
  const matched = new Map<string, MatchedTerm[]>();
  for (const i of indications) {
    const pivotal = trials.filter((t) => t.roles.some((r) => r.role === 'PIVOTAL' && r.indication === i.name));
    let terms = matchDiseases(i.name, pivotal);
    if (terms.length === 0) {
      try {
        terms = await matchByWording(ctx, i.name, pivotal);
      } catch (err) {
        console.warn(`MeSH wording lookup failed for ${i.name}: ${(err as Error).message}`);
      }
    }
    matched.set(i.name, terms);
  }
  const info = new Map<string, MeshInfo>();
  for (const id of new Set([...matched.values()].flat().map((m) => m.id))) {
    try {
      info.set(id, await meshInfo(ctx, id));
    } catch (err) {
      // A MeSH outage shouldn't fail the run: the disease still groups, without a definition.
      console.warn(`MeSH lookup failed for ${id}: ${(err as Error).message}`);
      info.set(id, { areas: [], isDisease: true, synonyms: [] });
    }
    const term = [...matched.values()].flat().find((m) => m.id === id)!.term;
    const names = [...new Set([term, ...info.get(id)!.synonyms])];
    try {
      info.get(id)!.plain = await plainSummary(ctx, names);
    } catch (err) {
      // An outage at any of these services shouldn't fail the run: the page goes without a plain-language summary.
      console.warn(`Plain-language lookup failed for ${term}: ${(err as Error).message}`);
    }
  }
  const out = new Map<string, Disease[]>();
  for (const [name, terms] of matched) {
    out.set(
      name,
      terms.filter((m) => info.get(m.id)?.isDisease !== false).map((m) => {
        const mi: MeshInfo = info.get(m.id) ?? { areas: [], isDisease: true, synonyms: [] };
        return {
          meshId: m.id,
          term: m.term,
          areas: mi.areas,
          ...(mi.inherited ? { inherited: true } : {}),
          ...(mi.definition && mi.definitionUrl
            ? {
                definition: {
                  text: mi.definition,
                  provenance: { sourceUrl: `https://meshb.nlm.nih.gov/record/ui?ui=${m.id}`, sourceLabel: 'MeSH, U.S. National Library of Medicine', extractedBy: 'api' as const, verified: false },
                },
              }
            : {}),
          ...(mi.plain
            ? {
                summary: {
                  title: mi.plain.title,
                  paragraphs: mi.plain.paragraphs,
                  provenance: { sourceUrl: mi.plain.url, sourceLabel: mi.plain.sourceLabel, extractedBy: 'api' as const, verified: false },
                },
              }
            : {}),
          provenance: m.phrase
            ? {
                sourceUrl: `https://meshb.nlm.nih.gov/record/ui?ui=${m.id}`,
                sourceLabel:
                  m.trials.length > 0
                    ? `One of MeSH's names for the term, in the FDA's wording; also on the pivotal trials (${m.trials.map((t) => t.nctId ?? t.id).join(', ')})`
                    : "One of MeSH's names for the term, in the FDA's wording",
                quote: m.phrase,
                extractedBy: 'rule' as const,
                verified: false,
              }
            : {
                sourceUrl: ctgovUrl(m.trials[0]),
                sourceLabel: `MeSH term on the pivotal trials' ClinicalTrials.gov records (${m.trials.map((t) => t.nctId ?? t.id).join(', ')})`,
                extractedBy: 'rule' as const,
                verified: false,
              },
        };
      })
    );
  }
  return out;
}

/**
 * The first plain-language explanation found, in order of depth: a
 * MedlinePlus health topic, a MedlinePlus Genetics condition page, then the
 * NCI cancer dictionary's short definition. Each must be named as the
 * disease itself (see plainSources.ts); none found leaves a gap.
 */
async function plainSummary(ctx: IngestContext, names: string[]): Promise<PlainSource | undefined> {
  for (const name of names.slice(0, 4)) {
    const topic = await medlinePlusTopic(ctx, name, names);
    if (topic) return { ...topic, sourceLabel: 'MedlinePlus, U.S. National Library of Medicine' };
  }
  const genetic = await geneticsCondition(ctx, names);
  if (genetic) return genetic;
  return nciDictionary(ctx, names);
}
