import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePathFor } from '../scripts/ingest/http.js';
import { brandCase, drugsFdaUrl, drugsFdaUrlByBrand, genericNameOf, identityFromApplication, ingredientsOf, innOf, registrySearchTerm, runFdaStage, trialMatchName } from '../scripts/ingest/fda.js';
import { makeContext } from '../scripts/ingest/context.js';

function seedOpenFda(rawDir: string, slug: string, url: string, body: unknown): void {
  const path = cachePathFor(slug, 'openfda', url, rawDir);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ ok: true, body }));
}

/**
 * Regression coverage for adding a second drug (Mimrylo/rusfertide): its
 * exact NDA number wasn't known up front — too recently approved to have
 * looked it up by hand — so the registry entry omits applicationNumber and
 * applicationType, and the pipeline has to resolve them from openFDA's own
 * brand-name search instead of requiring them to be supplied.
 */
describe('runFdaStage — brand-name lookup', () => {
  it('resolves the real application number and type from a brand-name search', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-brand-'));
    const ctx = makeContext('rusfertide', { rawDir });

    const lookupUrl = drugsFdaUrlByBrand('Mimrylo');
    seedOpenFda(rawDir, 'rusfertide', lookupUrl, {
      results: [
        {
          application_number: 'NDA218330',
          sponsor_name: 'TAKEDA PHARMACEUTICALS USA INC',
          submissions: [
            {
              submission_type: 'ORIG',
              submission_number: '1',
              submission_status: 'AP',
              submission_status_date: '20260828',
              submission_class_code_description: 'Type 1 - New Molecular Entity',
              application_docs: [],
            },
          ],
        },
      ],
    });

    const result = await runFdaStage(ctx, undefined, undefined, 'Mimrylo');

    expect(result.applicationNumber).toBe('218330');
    expect(result.applicationType).toBe('NDA');
    // Everything downstream (milestone provenance, the committed record's
    // regulatory.us fields) has to use the *resolved* application, not the
    // brand-search URL, or a later re-run keyed by number would miss the cache.
    expect(result.queryUrl).toBe(drugsFdaUrl('NDA', '218330'));
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].type).toBe('FDA_APPROVAL');
  });

  it('reports a clear error when the brand name matches nothing', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-brand-missing-'));
    const ctx = makeContext('nonexistent-drug', { rawDir });
    seedOpenFda(rawDir, 'nonexistent-drug', drugsFdaUrlByBrand('Totally Fictional Drug'), {
      results: [],
    });

    await expect(runFdaStage(ctx, undefined, undefined, 'Totally Fictional Drug')).rejects.toThrow(
      /no application for brand name/
    );
  });

  it('still supports the exact application number, unchanged', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-exact-'));
    const ctx = makeContext('upadacitinib', { rawDir });
    seedOpenFda(rawDir, 'upadacitinib', drugsFdaUrl('NDA', '211675'), {
      results: [
        {
          application_number: 'NDA211675',
          sponsor_name: 'ABBVIE INC',
          submissions: [
            {
              submission_type: 'ORIG',
              submission_number: '1',
              submission_status: 'AP',
              submission_status_date: '20190816',
              submission_class_code_description: 'Type 1 - New Molecular Entity',
              application_docs: [],
            },
          ],
        },
      ],
    });

    const result = await runFdaStage(ctx, '211675', 'NDA', 'Rinvoq');
    expect(result.applicationNumber).toBe('211675');
    expect(result.applicationType).toBe('NDA');
  });
});

describe('identityFromApplication', () => {
  const app = {
    application_number: 'BLA761105',
    sponsor_name: 'ABBVIE INC',
    openfda: { generic_name: ['RISANKIZUMAB-RZAA'], pharm_class_epc: ['Interleukin-23 Antagonist [EPC]'] },
    products: [{ brand_name: 'SKYRIZI', active_ingredients: [{ name: 'RISANKIZUMAB-RZAA' }] }],
  };
  const blank = { brandName: '', inn: '', sponsor: '', modality: '', interventionNames: [] as string[] };

  it("fills a new drug's identity from its FDA application", () => {
    expect(identityFromApplication(blank, app, 'BLA')).toEqual({
      brandName: 'Skyrizi',
      inn: 'risankizumab',
      sponsor: 'ABBVIE INC',
      modality: 'Biologic (BLA)',
      mechanism: 'Interleukin-23 Antagonist',
      interventionNames: ['risankizumab', 'Skyrizi'],
    });
  });

  it('keeps every field already given', () => {
    const given = { brandName: 'Skyrizi', inn: 'risankizumab', sponsor: 'AbbVie Inc.', modality: 'mAb', mechanism: 'IL-23 p19', interventionNames: ['risankizumab', 'ABBV-066'] };
    expect(identityFromApplication(given, app, 'BLA')).toEqual(given);
  });
});

describe('brandCase', () => {
  it('cases each word of a capitals brand and drops the FDA product tag', () => {
    expect(brandCase('RYBREVANT FASPRO')).toBe('Rybrevant Faspro');
    expect(brandCase('AWIQLI FLEXTOUCH')).toBe('Awiqli Flextouch');
    expect(brandCase('LIFYORLI (COPACKAGED)')).toBe('Lifyorli');
    expect(brandCase('SKYRIZI')).toBe('Skyrizi');
  });

  it('keeps a brand already in mixed case', () => {
    expect(brandCase('pHisoHex')).toBe('pHisoHex');
  });
});

describe('innOf', () => {
  it('drops salts and biologic suffixes, as trial registries write names', () => {
    expect(innOf('PRITELIVIR MESYLATE')).toBe('pritelivir');
    expect(innOf('LIRAFUGRATINIB HYDROCHLORIDE')).toBe('lirafugratinib');
    expect(innOf('ZILURGISERTIB FUMARATE')).toBe('zilurgisertib');
    expect(innOf('RISANKIZUMAB-RZAA')).toBe('risankizumab');
    expect(innOf('INSULIN EFSITORA ALFA-GOBE')).toBe('insulin efsitora alfa');
    expect(innOf('CAMIZESTRANT')).toBe('camizestrant');
  });
});

describe('genericNameOf', () => {
  it('names every active ingredient of a combination, as the label does', () => {
    // Zaynich: openFDA's generic_name starts with a salt word, which once cut the name to one ingredient.
    expect(
      genericNameOf({
        openfda: { generic_name: ['ZIDEBACTAM DIHYDRATE AND CEFEPIME HYDROCHLORIDE'] },
        products: [{ active_ingredients: [{ name: 'CEFEPIME HYDROCHLORIDE' }, { name: 'ZIDEBACTAM' }] }],
      })
    ).toBe('cefepime and zidebactam');
    expect(
      genericNameOf({ products: [{ active_ingredients: [{ name: 'AMIVANTAMAB AND HYALURONIDASE-LPUJ' }] }] })
    ).toBe('amivantamab and hyaluronidase');
    expect(genericNameOf({ openfda: { generic_name: ['DORAVIRINE, ISLATRAVIR'] } })).toBe('doravirine and islatravir');
    expect(genericNameOf({ products: [{ active_ingredients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }] })).toBe('a, b and c');
  });

  it("prefers the product's ingredient to openFDA's generic_name, which can be wrong", () => {
    expect(
      genericNameOf({ openfda: { generic_name: ['LIPFENDRA'] }, products: [{ active_ingredients: [{ name: 'ENLICITIDE DECANOATE' }] }] })
    ).toBe('enlicitide decanoate');
    expect(genericNameOf({ products: [{ active_ingredients: [{ name: 'ESCITALOPRAM OXALATE' }] }] })).toBe('escitalopram');
  });
});

describe('combination search terms', () => {
  it('needs every ingredient of a combination, in the search and in matching', () => {
    expect(ingredientsOf('cefepime and zidebactam')).toEqual(['cefepime', 'zidebactam']);
    expect(ingredientsOf('dupilumab')).toEqual([]);
    expect(registrySearchTerm('cefepime and zidebactam')).toBe('cefepime AND zidebactam');
    expect(registrySearchTerm('dupilumab')).toBe('dupilumab');
    expect(trialMatchName('doravirine and islatravir')).toBe('doravirine + islatravir');
    expect(trialMatchName('dupilumab')).toBe('dupilumab');
  });

  it('matches trials on the whole combination', () => {
    const app = { products: [{ brand_name: 'ZAYNICH', active_ingredients: [{ name: 'CEFEPIME HYDROCHLORIDE' }, { name: 'ZIDEBACTAM' }] }] };
    const blank = { brandName: '', inn: '', sponsor: '', modality: '', interventionNames: [] as string[] };
    expect(identityFromApplication(blank, app, 'NDA').interventionNames).toEqual(['cefepime + zidebactam', 'Zaynich']);
  });
});
