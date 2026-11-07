import { readdirSync, readFileSync } from 'node:fs';
import { Drug } from '../src/schema/index.js';
import { summarizeDiseases } from '../src/lib/diseases.js';
import { clip, drugMeta, indicationMeta } from '../src/lib/pageMeta.js';
import { pageHtml, sitemapXml, sitePages } from '../src/lib/sitePages.js';
import { parsePath } from '../src/lib/router.js';

const drugs = readdirSync('data/drugs')
  .filter((f) => f.endsWith('.json'))
  .map((f) => Drug.parse(JSON.parse(readFileSync(`data/drugs/${f}`, 'utf8'))));

describe('page addresses', () => {
  it('reads each kind of page from its path', () => {
    expect(parsePath('')).toEqual({ name: 'index' });
    expect(parsePath('drug/upadacitinib/')).toEqual({ name: 'drug', slug: 'upadacitinib' });
    expect(parsePath('drug/upadacitinib')).toEqual({ name: 'drug', slug: 'upadacitinib' });
    expect(parsePath('drug/x/indication/y/trial/NCT1/')).toEqual({ name: 'indication', slug: 'x', indicationSlug: 'y', trialId: 'NCT1' });
    expect(parsePath('drug/x/indication/y/')).toMatchObject({ name: 'indication', trialId: null });
    expect(parsePath('disease/D001172/?a=1')).toEqual({ name: 'disease', meshId: 'D001172' });
    expect(parsePath('diseases/')).toEqual({ name: 'diseases' });
  });
});

describe('page titles and descriptions', () => {
  const pages = sitePages(drugs, summarizeDiseases(drugs));

  it('gives every page its own address and title', () => {
    const paths = pages.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    const titles = pages.filter((p) => p.listed).map((p) => p.meta.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const p of pages) expect(p.meta.description.length).toBeGreaterThan(40);
  });

  it('lists every drug and approved use, and keeps tool pages out of search', () => {
    const listed = pages.filter((p) => p.listed).map((p) => p.path);
    for (const d of drugs) {
      expect(listed).toContain(`drug/${d.slug}/`);
      for (const i of d.indications) expect(listed).toContain(`drug/${d.slug}/indication/${i.slug}/`);
    }
    expect(listed).not.toContain('ingest/');
  });

  it('quotes the FDA wording for an approved use', () => {
    const d = drugs.find((x) => x.slug === 'upadacitinib')!;
    const i = d.indications[0];
    expect(indicationMeta(d, i).description).toContain(i.name.trim().slice(0, 40));
    expect(drugMeta(d).title).toMatch(/^Rinvoq \(upadacitinib\)/);
  });

  it('cuts long text at a word', () => {
    expect(clip('one two three', 8)).toBe('one two…');
    expect(clip('short')).toBe('short');
  });

  it('writes the head safely', () => {
    const html = pageHtml('<head><title>x</title><meta name="description" content="y" /></head>', { title: 'A "B" <C>', description: 'd & e' }, 'https://s/p/', true);
    expect(html).toContain('<title>A &quot;B&quot; &lt;C&gt;</title>');
    expect(html).toContain('content="d &amp; e"');
    expect(html).toContain('<link rel="canonical" href="https://s/p/" />');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(sitemapXml(['https://s/'], '2026-01-01')).toContain('<loc>https://s/</loc>');
  });
});
