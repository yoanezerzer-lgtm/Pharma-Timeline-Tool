import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import areaFile from '../data/areas/areas.json';

describe('therapeutic areas (data/areas/areas.json)', () => {
  const ids = new Set(areaFile.areas.map((a) => a.id));
  it('names each area once', () => {
    expect(ids.size).toBe(areaFile.areas.length);
  });
  it('places drugs only in listed areas, and never by hand in a rule-based one', () => {
    const ruled = new Set(areaFile.areas.filter((a) => 'rule' in a).map((a) => a.id));
    for (const [slug, areas] of Object.entries(areaFile.drugs as Record<string, string[]>)) {
      for (const a of areas) {
        expect(ids.has(a), `${slug}: ${a}`).toBe(true);
        expect(ruled.has(a), `${slug}: ${a} is filled by its rule`).toBe(false);
      }
    }
  });
  it('lists only drugs that are on the site', () => {
    const onSite = new Set(readdirSync('data/drugs').map((f) => f.replace(/\.json$/, '')));
    for (const slug of Object.keys(areaFile.drugs)) expect(onSite.has(slug), slug).toBe(true);
  });
});
