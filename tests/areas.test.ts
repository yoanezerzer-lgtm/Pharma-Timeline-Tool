import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import areaFile from '../data/areas/areas.json';
import { areasOfDrug, countsAsGenetic, filedAreas, INHERITED_CATEGORY, shownCategories } from '../src/lib/areas.js';

describe('therapeutic areas (data/areas/areas.json)', () => {
  const ids = new Set(areaFile.areas.map((a) => a.id));
  it('names each area once', () => {
    expect(ids.size).toBe(areaFile.areas.length);
  });
  it('places drugs only in listed areas, and in a rule-based one by hand only on a recorded owner decision', () => {
    const ruled = new Set(areaFile.areas.filter((a) => 'rule' in a).map((a) => a.id));
    const decided = (areaFile as { decisions?: Record<string, string> }).decisions ?? {};
    for (const [slug, areas] of Object.entries(areaFile.drugs as Record<string, string[]>)) {
      for (const a of areas) {
        expect(ids.has(a), `${slug}: ${a}`).toBe(true);
        if (ruled.has(a)) expect(decided[slug], `${slug}: ${a} is filled by its rule`).toMatch(/^Owner, /);
      }
    }
  });
  it('lists only drugs that are on the site', () => {
    const onSite = new Set(readdirSync('data/drugs').map((f) => f.replace(/\.json$/, '')));
    for (const slug of Object.keys(areaFile.drugs)) expect(onSite.has(slug), slug).toBe(true);
  });
});

describe('how the owner files diseases (areas.json "diseases")', () => {
  it('files diseases only under listed areas that are not rule-based', () => {
    const ids = new Set(areaFile.areas.map((a) => a.id));
    const ruled = new Set(areaFile.areas.filter((a) => 'rule' in a).map((a) => a.id));
    for (const [id, f] of Object.entries(areaFile.diseases)) {
      for (const a of f.areas) {
        expect(ids.has(a), `${id}: ${a}`).toBe(true);
        expect(ruled.has(a), `${id}: ${a}`).toBe(false);
      }
    }
  });

  const ad = { meshId: 'D003876', term: 'Dermatitis, Atopic', inherited: true };
  const drug = (slug: string, diseases: { meshId: string; term: string; inherited?: boolean }[]) => ({
    slug,
    indications: [{ diseases }] as never,
  });

  it('keeps atopic dermatitis out of "Genetic diseases" and files it under Immunology (owner, 3 Nov)', () => {
    expect(countsAsGenetic(ad)).toBe(false);
    const ids = areasOfDrug(drug('not-listed', [ad])).map((a) => a.id);
    expect(ids).toEqual(['immunology']);
  });

  it('lets one drug span areas: asthma, COPD and nasal polyps are Respirology (owner, 10 Nov)', () => {
    const asthma = { meshId: 'D001249', term: 'Asthma' };
    const copd = { meshId: 'D029424', term: 'Pulmonary Disease, Chronic Obstructive' };
    const polyps = { meshId: 'D009298', term: 'Nasal Polyps' };
    expect(areasOfDrug(drug('not-listed', [ad, asthma, copd, polyps])).map((a) => a.id)).toEqual(['immunology', 'respirology']);
    for (const x of [asthma, copd, polyps]) expect(filedAreas(x.meshId)).toEqual(['respirology']);
  });

  it('still files other inherited diseases under "Genetic diseases"', () => {
    const other = { meshId: 'D000000', term: 'Some Inherited Disease', inherited: true };
    expect(countsAsGenetic(other)).toBe(true);
    expect(areasOfDrug(drug('not-listed', [ad, other])).map((a) => a.id)).toEqual(['immunology', 'genetic']);
  });

  it("drops MeSH's inherited category from atopic dermatitis on the disease pages only", () => {
    const cats = [INHERITED_CATEGORY, 'Immune System Diseases', 'Skin and Connective Tissue Diseases'];
    expect(shownCategories('D003876', cats)).toEqual(['Immune System Diseases', 'Skin and Connective Tissue Diseases']);
    expect(shownCategories('D000000', cats)).toEqual(cats);
  });
});
