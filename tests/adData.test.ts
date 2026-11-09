import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Trial } from '../src/schema/index.js';
import { candidatePhrases, matchByWording } from '../scripts/ingest/diseases.js';
import { indicationWording } from '../scripts/ingest/indicationDates.js';
import { siblingNumbers } from '../scripts/ingest/siblings.js';
import { makeContext } from '../scripts/ingest/context.js';

function trial(nctId: string, mesh: [string, string][], indication: string): Trial {
  return {
    id: nctId.toLowerCase(), nctId, title: 'x', phase: 'PHASE3', arms: [], primaryEndpoints: [], secondaryEndpoints: [],
    metPrimaryEndpoint: null, takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [],
    conditionMesh: mesh.map(([id, term]) => ({ id, term })),
    roles: [{ indication, role: 'PIVOTAL', provenance: { extractedBy: 'rule', verified: false } }],
  };
}

// MeSH names (headings and entry terms) and the descriptor each belongs to.
const NAMES: Record<string, [string, string]> = {
  'Atopic Dermatitis': ['D003876', 'Dermatitis, Atopic'],
  Dermatitis: ['D003872', 'Dermatitis'],
  'Hodgkin Lymphoma': ['D006689', 'Hodgkin Disease'],
  Lymphoma: ['D008223', 'Lymphoma'],
};

function stubMesh() {
  vi.stubGlobal('fetch', async (url: string) => {
    const query = decodeURIComponent(new URL(url).searchParams.get('query') ?? '');
    const asked = [...query.matchAll(/"([^"]+)"@en/g)].map((m) => m[1]);
    const bindings = asked
      .filter((a) => NAMES[a])
      .map((a) => ({ name: { value: a }, d: { value: `http://id.nlm.nih.gov/mesh/${NAMES[a][0]}` }, term: { value: NAMES[a][1] } }));
    return new Response(JSON.stringify({ results: { bindings } }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

const ctx = () => makeContext('t', { rawDir: mkdtempSync(join(tmpdir(), 'mesh-')) });

describe('matching the FDA wording to MeSH names', () => {
  it('never runs a phrase across punctuation or starts it on a small word', () => {
    const texts = candidatePhrases('Adults with atopic dermatitis, or when those treatments fail').map((p) => p.text);
    expect(texts).toContain('atopic dermatitis');
    expect(texts).not.toContain('dermatitis or');
    expect(texts.some((t) => /^(with|or|when)\b/i.test(t))).toBe(false);
  });

  it("finds Protopic's disease from its sentence alone when its trials carry no MeSH terms", async () => {
    stubMesh();
    const wording =
      'As second-line therapy for the short-term and non-continuous chronic treatment of moderate to severe atopic dermatitis in non-immunocompromised adults';
    const found = await matchByWording(ctx(), wording, []);
    // "Dermatitis" gives way to the longer "atopic dermatitis" it sits in.
    expect(found.map((f) => f.id)).toEqual(['D003876']);
    expect(found[0].phrase).toBe('atopic dermatitis');
  });

  it('reads an entry term, kept only when the pivotal trials agree', async () => {
    stubMesh();
    const parkinson: [string, string] = ['C565324', 'Parkinson Disease 4, Autosomal Dominant Lewy Body'];
    const agree = [trial('NCT1', [parkinson, ['D006689', 'Hodgkin Disease']], 'Classical Hodgkin Lymphoma')];
    expect((await matchByWording(ctx(), 'Classical Hodgkin Lymphoma', agree)).map((f) => f.term)).toEqual(['Hodgkin Disease']);
    const disagree = [trial('NCT2', [parkinson], 'Classical Hodgkin Lymphoma')];
    expect(await matchByWording(ctx(), 'Classical Hodgkin Lymphoma', disagree)).toEqual([]);
  });
});

describe('sibling applications named in a letter', () => {
  it("reads Nemluvio's second BLA from the combined-labeling letter", () => {
    const letter =
      'BLA 761391/S-001 BLA 761390/S-002 SUPPLEMENT APPROVAL ... These Prior Approval supplemental biologics applications ' +
      'provide for combined labeling based on the approval of BLAs 761390 and 761391 and an administrative closure of BLA 761391.';
    expect(siblingNumbers([letter], 'BLA', '761390')).toEqual(['761391']);
    expect(siblingNumbers(['Please refer to your BLA 761390 for Nemluvio.'], 'BLA', '761390')).toEqual([]);
  });
});

describe("the label's full wording for a use", () => {
  const label =
    '1 INDICATIONS AND USAGE 1.1 Atopic Dermatitis 1.2 Asthma 2 DOSAGE AND ADMINISTRATION ... ' +
    '1 INDICATIONS AND USAGE 1.1 Atopic Dermatitis DUPIXENT is indicated for the treatment of adult and pediatric patients aged 6 months ' +
    'and older with moderate-to-severe atopic dermatitis (AD) whose disease is not adequately controlled with topical prescription therapies ' +
    'or when those therapies are not advisable. DUPIXENT can be used with or without topical corticosteroids. 1.2 Asthma DUPIXENT is indicated ' +
    'as an add-on maintenance treatment of adult and pediatric patients aged 6 years and older with moderate-to-severe asthma. Limitations of Use ' +
    'DUPIXENT is not indicated for the relief of acute bronchospasm. 1.3 Melanoma DUPIXENT is indicated for the treatment of adults with ' +
    'unresectable melanoma. DUPIXENT is indicated for the adjuvant treatment of adults with melanoma. 2 DOSAGE AND ADMINISTRATION 2.1 Dosage';

  it('takes the sentence under the heading, after "is indicated for the treatment of"', () => {
    expect(indicationWording(label, 'Atopic Dermatitis')).toBe(
      'Adult and pediatric patients aged 6 months and older with moderate-to-severe atopic dermatitis (AD) whose disease is not adequately controlled with topical prescription therapies or when those therapies are not advisable'
    );
    // A limitation of use ("is not indicated") is not a second use.
    expect(indicationWording(label, 'Asthma')).toMatch(/^As an add-on maintenance treatment of adult/);
  });

  it('leaves a subsection with several uses to its heading', () => {
    expect(indicationWording(label, 'Melanoma')).toBeUndefined();
  });
});
