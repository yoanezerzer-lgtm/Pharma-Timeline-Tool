import type { Drug } from '../schema/index.js';
import type { DiseaseSummary } from './diseases.js';
import { aboutMeta, diseaseMeta, diseasesMeta, drugMeta, homeMeta, indicationMeta, SITE_NAME, type PageMeta } from './pageMeta.js';

/**
 * Every page the build writes as its own HTML file, so each has a real
 * address with its own title and description, and the sitemap that lists
 * them for search engines. Run at build time (vite.config.ts).
 */

export interface SitePage {
  /** Under the site's folder, no leading slash, "" for home ("drug/x/"). */
  path: string;
  meta: PageMeta;
  /** Listed in the sitemap and open to search engines; tool pages are not. */
  listed: boolean;
}

export function sitePages(drugs: Drug[], diseases: DiseaseSummary[]): SitePage[] {
  const tool = (path: string, title: string): SitePage => ({ path, meta: { title: `${title} | ${SITE_NAME}`, description: homeMeta().description }, listed: false });
  return [
    { path: '', meta: homeMeta(), listed: true },
    { path: 'diseases/', meta: diseasesMeta(), listed: true },
    { path: 'about/', meta: aboutMeta(), listed: true },
    ...drugs.flatMap((drug) => [
      { path: `drug/${drug.slug}/`, meta: drugMeta(drug), listed: true },
      ...drug.indications.map((i) => ({ path: `drug/${drug.slug}/indication/${i.slug}/`, meta: indicationMeta(drug, i), listed: true })),
    ]),
    ...diseases.map((d) => ({ path: `disease/${d.meshId}/`, meta: diseaseMeta(d), listed: true })),
    tool('compare/', 'Compare two approvals'),
    tool('review/', 'Review'),
    tool('ingest/', 'Add a drug'),
  ];
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The built index.html with this page's title, description and address in its head. */
export function pageHtml(template: string, meta: PageMeta, url: string | null, listed: boolean): string {
  const head = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    ...(url
      ? [
          `<link rel="canonical" href="${escape(url)}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="${escape(SITE_NAME)}" />`,
          `<meta property="og:title" content="${escape(meta.title)}" />`,
          `<meta property="og:description" content="${escape(meta.description)}" />`,
          `<meta property="og:url" content="${escape(url)}" />`,
        ]
      : []),
    ...(listed ? [] : ['<meta name="robots" content="noindex" />']),
  ].join('\n    ');
  const out = template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace('</head>', `  ${head}\n  </head>`);
  return out;
}

export function sitemapXml(urls: string[], lastmod: string): string {
  const entries = urls.map((u) => `  <url><loc>${escape(u)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export function robotsTxt(sitemapUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}
