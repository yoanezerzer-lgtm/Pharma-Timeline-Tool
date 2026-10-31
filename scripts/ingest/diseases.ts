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
    matched.set(i.name, matchDiseases(i.name, pivotal));
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
          provenance: {
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
