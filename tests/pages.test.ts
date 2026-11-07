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
    expect(parsePath('?q=x')).toEqual({ name: 'index' });
    expect(parsePath('no-such-page/')).toEqual({ name: 'not-found' });
    expect(parsePath('drug/')).toEqual({ name: 'not-found' });
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

describe('page wording', () => {
  it('labels each kind of approval the same way on every page', async () => {
    const { APPROVAL_KIND, DATE_UNCLEAR } = await import('../src/lib/copy.js');
    expect(Object.keys(APPROVAL_KIND).sort()).toEqual(['conversion', 'expansion', 'new', 'revision']);
    expect(DATE_UNCLEAR).toBe('Date unclear');
  });

  it('uses one wording for gaps and roles across pages', () => {
    const dirs = ['src/pages', 'src/components/Gantt', 'src/components/IndicationTimeline', 'src/components/TrialDetail'];
    const files = dirs.flatMap((d) =>
      readdirSync(d, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.tsx') && !/Review|Ingest/.test(f))
        .map((f) => `${d}/${f}`)
    );
    // Retired wordings: each was replaced by the one the rest of the site uses.
    const retired = [/not determined/i, /not established/i, /Supporting trial/, /✓ Verified/, /Approved indications/, /Export CSV/, /No drug record/];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const r of retired) expect({ file: f, found: r.test(src) }).toEqual({ file: f, found: false });
    }
  });

  it('gives addresses that are not pages their own title', async () => {
    const { notFoundMeta } = await import('../src/lib/pageMeta.js');
    expect(notFoundMeta().title).toMatch(/^Page not found \|/);
  });
});
