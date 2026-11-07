import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Drug } from './src/schema/index.js';
import { checkStats, mergeAreas, mergeCompanies, summarize } from './src/lib/summary.js';
import { summarizeDiseases } from './src/lib/diseases.js';
import { pageHtml, robotsTxt, sitemapXml, sitePages } from './src/lib/sitePages.js';

const DRUGS_DIR = fileURLToPath(new URL('./data/drugs/', import.meta.url));
const REFERENCE_DIR = fileURLToPath(new URL('./data/reference/', import.meta.url));

/** Every committed drug record, validated; fails on a malformed file. */
function readDrugs(watch?: (path: string) => void): Drug[] {
  return readdirSync(DRUGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const path = DRUGS_DIR + file;
      watch?.(path);
      const result = Drug.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (!result.success) {
        throw new Error(
          `Invalid drug record ${file}:\n` +
            result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
        );
      }
      // catalog.ts finds a record's file by its slug.
      if (`${result.data.slug}.json` !== file) {
        throw new Error(`${file} has slug "${result.data.slug}" — the filename must match it.`);
      }
      return result.data;
    });
}

/**
 * Serves `virtual:drug-index`: a summary of every committed drug record
 * (and `virtual:disease-index`: every approval grouped by disease),
 * computed at build time. Pages that list drugs import this instead of the
 * records themselves, so the first page load stays small no matter how many
 * drugs are added. Validating here also fails the build on a malformed file.
 */
function drugIndex(): Plugin {
  const ids = { drugs: 'virtual:drug-index', diseases: 'virtual:disease-index' };
  return {
    name: 'drug-index',
    resolveId: (source) => (Object.values(ids).includes(source) ? `\0${source}` : undefined),
    load(loadId) {
      if (loadId !== `\0${ids.drugs}` && loadId !== `\0${ids.diseases}`) return;
      const drugs = readDrugs((path) => this.addWatchFile(path));
      if (loadId === `\0${ids.diseases}`) return `export default ${JSON.stringify(summarizeDiseases(drugs))};`;

      const summaries = drugs
        .map((drug) => {
          const refPath = `${REFERENCE_DIR}${drug.slug}.json`;
          const ref = existsSync(refPath) ? JSON.parse(readFileSync(refPath, 'utf8')) : undefined;
          if (ref) this.addWatchFile(refPath);
          return { ...summarize(drug, checkStats(ref)), labelPrinted: !!drug.regulatory.us.labelCompany };
        })
        .sort((a, b) => a.brandName.localeCompare(b.brandName));
      const companies = mergeCompanies(summaries);
      const offices = mergeAreas(summaries.map((s) => s.office));
      const merged = summaries.map(({ labelPrinted: _, ...s }, i) => ({ ...s, company: companies[i], office: offices[i] }));
      return `export default ${JSON.stringify(merged)};`;
    },
  };
}

/**
 * Writes one HTML file per page (drug/<slug>/index.html, ...) with the
 * page's own title and description, plus 404.html (the app, for any other
 * address), sitemap.xml and robots.txt. Static hosts serve each address
 * from its file, so search engines can list every page.
 */
function staticPages(base: string): Plugin {
  // Where the site lives. Set SITE_ORIGIN when it moves to its own domain.
  const origin = (process.env.SITE_ORIGIN ?? 'https://yoanezerzer-lgtm.github.io').replace(/\/+$/, '');
  return {
    name: 'static-pages',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir!;
      const template = readFileSync(join(dir, 'index.html'), 'utf8');
      const drugs = readDrugs();
      const pages = sitePages(drugs, summarizeDiseases(drugs));
      const url = (path: string) => `${origin}${base}${path}`;
      for (const page of pages) {
        mkdirSync(join(dir, page.path), { recursive: true });
        writeFileSync(join(dir, page.path, 'index.html'), pageHtml(template, page.meta, url(page.path), page.listed));
      }
      writeFileSync(join(dir, '404.html'), pageHtml(template, pages[0].meta, null, false));
      const today = new Date().toISOString().slice(0, 10);
      writeFileSync(join(dir, 'sitemap.xml'), sitemapXml(pages.filter((p) => p.listed).map((p) => url(p.path)), today));
      writeFileSync(join(dir, 'robots.txt'), robotsTxt(url('sitemap.xml')));
    },
  };
}

// `base` targets GitHub Pages project-site hosting (user.github.io/<repo>/).
// Override with BASE_PATH=/ for local or root-domain deploys.
const BASE = process.env.BASE_PATH ?? '/Pharma-Timeline-Tool/';

export default defineConfig({
  plugins: [react(), drugIndex(), staticPages(BASE)],
  base: BASE,
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
