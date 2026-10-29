import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Trial } from '../src/schema/index.js';
import { indicationDiseases, matchDiseases, meshInfo, namesTerm } from '../scripts/ingest/diseases.js';
import { makeContext } from '../scripts/ingest/context.js';

function trial(nctId: string, mesh: [string, string][], indication: string): Trial {
  return {
    id: nctId.toLowerCase(), nctId, title: 'x', phase: 'PHASE3', arms: [], primaryEndpoints: [], secondaryEndpoints: [],
    metPrimaryEndpoint: null, takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [],
    conditionMesh: mesh.map(([id, term]) => ({ id, term })),
    roles: [{ indication, role: 'PIVOTAL', provenance: { extractedBy: 'rule', verified: false } }],
  };
}

describe('matching an approved use to its disease', () => {
  it('reads MeSH inverted terms against the FDA wording', () => {
    expect(namesTerm('Rheumatoid Arthritis', 'Arthritis, Rheumatoid')).toBe(true);
    expect(namesTerm('Crohn’s Disease', 'Crohn Disease')).toBe(true);
    expect(namesTerm('Moderate-to-severe plaque psoriasis in adults', 'Psoriasis')).toBe(true);
    expect(namesTerm('Psoriatic Arthritis', 'Arthritis, Rheumatoid')).toBe(false);
  });

  it('takes a term every pivotal trial shares and the wording names', () => {
    const t = [
      trial('NCT1', [['D001172', 'Arthritis, Rheumatoid'], ['D001168', 'Arthritis']], 'Rheumatoid Arthritis'),
      trial('NCT2', [['D001172', 'Arthritis, Rheumatoid']], 'Rheumatoid Arthritis'),
    ];
    expect(matchDiseases('Rheumatoid Arthritis', t).map((m) => m.id)).toEqual(['D001172']);
  });

  it('uses a single shared term the wording does not spell out, and leaves a gap when there are several', () => {
    const nsclc = [trial('NCT3', [['D002289', 'Carcinoma, Non-Small-Cell Lung']], 'First-Line Treatment of NSCLC')];
    expect(matchDiseases('First-Line Treatment of NSCLC', nsclc).map((m) => m.term)).toEqual(['Carcinoma, Non-Small-Cell Lung']);
    const two = [trial('NCT4', [['D1', 'Lymphoma'], ['D2', 'Leukemia']], 'Hematologic cancer')];
    expect(matchDiseases('Hematologic cancer', two)).toEqual([]);
    expect(matchDiseases('Anything', [])).toEqual([]);
  });
});

describe('MeSH definition and therapeutic areas', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Shapes of NLM's MeSH RDF JSON and SPARQL JSON responses.
  const responses: Record<string, unknown> = {
    'https://id.nlm.nih.gov/mesh/D001172.json': {
      '@id': 'http://id.nlm.nih.gov/mesh/D001172',
      preferredConcept: 'http://id.nlm.nih.gov/mesh/M0001873',
      treeNumber: ['http://id.nlm.nih.gov/mesh/C05.550.114.099', 'http://id.nlm.nih.gov/mesh/C20.111.199', 'http://id.nlm.nih.gov/mesh/C05.799.114'],
      label: { '@language': 'en', '@value': 'Arthritis, Rheumatoid' },
    },
    'https://id.nlm.nih.gov/mesh/M0001873.json': { scopeNote: { '@language': 'en', '@value': 'A chronic systemic disease, primarily of the joints. ' } },
  };
  const area: Record<string, string> = { C05: 'Musculoskeletal Diseases', C20: 'Immune System Diseases' };

  function stub() {
    vi.stubGlobal('fetch', async (url: string) => {
      const sparql = /treeNumber%20mesh%3A(C\d\d|F03)/.exec(url);
      const body = sparql ? { results: { bindings: [{ label: { type: 'literal', value: area[sparql[1]] } }] } } : responses[url];
      return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
    });
  }

  it('reads the scope note and names each top-level disease category once', async () => {
    stub();
    const ctx = makeContext('t', { rawDir: mkdtempSync(join(tmpdir(), 'mesh-')) });
    expect(await meshInfo(ctx, 'D001172')).toMatchObject({
      definition: 'A chronic systemic disease, primarily of the joints.',
      areas: ['Musculoskeletal Diseases', 'Immune System Diseases'],
    });
  });

  it('attaches the disease to the approved use, with both sources', async () => {
    stub();
    const ctx = makeContext('t', { rawDir: mkdtempSync(join(tmpdir(), 'mesh-')) });
    const t = [trial('NCT1', [['D001172', 'Arthritis, Rheumatoid']], 'Rheumatoid Arthritis')];
    const [d] = (await indicationDiseases(ctx, [{ name: 'Rheumatoid Arthritis' }], t)).get('Rheumatoid Arthritis')!;
    expect(d).toMatchObject({
      meshId: 'D001172',
      areas: ['Musculoskeletal Diseases', 'Immune System Diseases'],
      definition: { provenance: { sourceLabel: 'MeSH, U.S. National Library of Medicine' } },
      provenance: { sourceUrl: 'https://clinicaltrials.gov/study/NCT1' },
    });
  });
});
