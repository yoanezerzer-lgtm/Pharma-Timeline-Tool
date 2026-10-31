import { describe, expect, it } from 'vitest';
import { geneticsNames, geneticsParagraphs, geneticsSlug, nciEntry } from '../scripts/ingest/plainSources.js';

describe('MedlinePlus Genetics', () => {
  const record = {
    name: 'Arginase 1 deficiency',
    'synonym-list': [{ synonym: 'Argininemia' }, { synonym: 'Hyperargininemia' }],
    'text-list': [
      { text: { 'text-role': 'description', html: '<p>Arginase 1 deficiency is an inherited disorder.</p><p>It usually becomes evident by about the age of 3.</p>' } },
      { text: { 'text-role': 'frequency', html: '<p>Rare.</p>' } },
    ],
  };
  it('reads the description and every name of a condition', () => {
    expect(geneticsParagraphs(record)).toEqual(['Arginase 1 deficiency is an inherited disorder.', 'It usually becomes evident by about the age of 3.']);
    expect(geneticsNames(record)).toEqual(['Arginase 1 deficiency', 'Argininemia', 'Hyperargininemia']);
  });
  it('finds the condition in a page URL', () => {
    expect(geneticsSlug('https://medlineplus.gov/genetics/condition/arginase-1-deficiency/')).toBe('arginase-1-deficiency');
    expect(geneticsSlug('https://medlineplus.gov/genetics/gene/arg1/')).toBeUndefined();
  });
});

describe('NCI Dictionary of Cancer Terms', () => {
  const results = [
    { termName: 'non-small cell lung cancer stage IV', prettyUrlName: 'x', definition: { text: 'A later stage.' } },
    { termName: 'non-small cell lung cancer', prettyUrlName: 'non-small-cell-lung-cancer', definition: { text: 'A group of lung cancers that are named for the kinds of cells found in the cancer.' } },
  ];
  it('takes only the entry named as the disease itself', () => {
    const e = nciEntry(results, ['Carcinoma, Non-Small-Cell Lung']);
    expect(e?.title).toBe('non-small cell lung cancer');
    expect(e?.url).toBe('https://www.cancer.gov/publications/dictionaries/cancer-terms/def/non-small-cell-lung-cancer');
    expect(nciEntry(results, ['Lung Neoplasms'])).toBeUndefined();
  });
});

describe('search answers and spellings', () => {
  it('reads page addresses from a Genetics search answer (real format)', async () => {
    const { searchUrls, geneticsSlug } = await import('../scripts/ingest/plainSources.js');
    const xml =
      '<search_results count="1"><query>Hyperargininemia</query><result><order>0</order><score>2.75</score><url>https://medlineplus.gov/genetics/condition/arginase-deficiency</url></result></search_results>';
    expect(searchUrls(xml).map(geneticsSlug)).toEqual(['arginase-deficiency']);
  });
  it('spells MeSH names the way the cancer dictionary does', async () => {
    const { nciSpellings } = await import('../scripts/ingest/plainSources.js');
    expect(nciSpellings(['Carcinoma, Non-Small-Cell Lung'])).toContain('non-small cell lung cancer');
    expect(nciSpellings(['Breast Neoplasms'])).toContain('breast cancer');
  });
});
