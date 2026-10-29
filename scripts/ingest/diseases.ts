import type { Disease, Trial } from '../../src/schema/index.js';
import type { IngestContext } from './context.js';
import { fetchJson } from './http.js';

/**
 * Which disease each approved use is for, as a MeSH term, so disease pages
 * can put every approval for one disease side by side.
 *
 * The term comes from ClinicalTrials.gov, where the National Library of
 * Medicine assigns MeSH terms to each trial's conditions. An approved use's
 * disease is a term all of its pivotal trials share and that the FDA's
 * wording names ("Arthritis, Rheumatoid" for "Rheumatoid Arthritis"). When
 * the wording names none, a term is used only if the trials share exactly
 * one. Anything else is left unmatched.
 *
 * Its definition and therapeutic areas (MeSH's top-level disease
 * categories, e.g. "Neoplasms") are read from NLM's MeSH service.
 */

const MESH = 'https://id.nlm.nih.gov/mesh';

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
      .map((w) => w.replace(/(?<=[a-z]{3})s$/, ''))
  );

/** Whether the FDA's wording names the term: every word of it appears ("Arthritis, Rheumatoid" in "Rheumatoid Arthritis"). */
export function namesTerm(wording: string, term: string): boolean {
  const have = words(wording);
  const need = [...words(term)];
  return need.length > 0 && need.every((w) => have.has(w));
}

export interface MatchedTerm {
  id: string;
  term: string;
  trials: Trial[];
}

export function matchDiseases(wording: string, pivotal: Trial[]): MatchedTerm[] {
  const tagged = pivotal.filter((t) => (t.conditionMesh ?? []).length > 0);
  if (tagged.length === 0) return [];
  const [first, ...rest] = tagged;
  const common = (first.conditionMesh ?? []).filter((m) => rest.every((t) => t.conditionMesh!.some((x) => x.id === m.id)));
  const named = common.filter((m) => namesTerm(wording, m.term));
  const chosen = named.length > 0 ? named : common.length === 1 ? common : [];
  return chosen.map((m) => ({ id: m.id, term: m.term, trials: tagged }));
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
}

const SPARQL_PREFIX =
  'PREFIX meshv: <http://id.nlm.nih.gov/mesh/vocab#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ';

/** A MeSH disease's definition, and the names of the top-level categories (C04, F03…) its tree numbers fall under. */
export async function meshInfo(ctx: IngestContext, id: string): Promise<MeshInfo> {
  const descriptor = await fetchJson<Record<string, unknown>>(`${MESH}/${id}.json`, { ctx, kind: 'mesh' });
  if (!descriptor) return { areas: [] };
  const conceptUri = value(descriptor.preferredConcept) ?? (descriptor.preferredConcept as { '@id'?: string })?.['@id'];
  let definition: string | undefined;
  let definitionUrl: string | undefined;
  if (conceptUri) {
    definitionUrl = `${MESH}/${idOf(conceptUri)}.json`;
    const concept = await fetchJson<Record<string, unknown>>(definitionUrl, { ctx, kind: 'mesh' });
    definition = value(concept?.scopeNote)?.trim();
  }
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
  return { definition, definitionUrl, areas };
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
      info.set(id, { areas: [] });
    }
  }
  const out = new Map<string, Disease[]>();
  for (const [name, terms] of matched) {
    out.set(
      name,
      terms.map((m) => {
        const mi = info.get(m.id) ?? { areas: [] };
        return {
          meshId: m.id,
          term: m.term,
          areas: mi.areas,
          ...(mi.definition && mi.definitionUrl
            ? {
                definition: {
                  text: mi.definition,
                  provenance: { sourceUrl: `https://meshb.nlm.nih.gov/record/ui?ui=${m.id}`, sourceLabel: 'MeSH, U.S. National Library of Medicine', extractedBy: 'api' as const, verified: false },
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
