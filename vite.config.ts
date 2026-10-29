import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Drug } from './src/schema/index.js';
import { checkStats, mergeAreas, mergeCompanies, summarize } from './src/lib/summary.js';
import { summarizeDiseases } from './src/lib/diseases.js';

const DRUGS_DIR = fileURLToPath(new URL('./data/drugs/', import.meta.url));
const REFERENCE_DIR = fileURLToPath(new URL('./data/reference/', import.meta.url));

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
      const drugs = readdirSync(DRUGS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((file) => {
          const path = DRUGS_DIR + file;
          this.addWatchFile(path);
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

// `base` targets GitHub Pages project-site hosting (user.github.io/<repo>/).
// Override with BASE_PATH=/ for local or root-domain deploys.
export default defineConfig({
  plugins: [react(), drugIndex()],
  base: process.env.BASE_PATH ?? '/Pharma-Timeline-Tool/',
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
