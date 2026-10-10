import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Drug } from './src/schema/index.js';
import { summarize } from './src/lib/summary.js';

const DRUGS_DIR = fileURLToPath(new URL('./data/drugs/', import.meta.url));

/**
 * Serves `virtual:drug-index`: a summary of every committed drug record,
 * computed at build time. Pages that list drugs import this instead of the
 * records themselves, so the first page load stays small no matter how many
 * drugs are added. Validating here also fails the build on a malformed file.
 */
function drugIndex(): Plugin {
  const id = 'virtual:drug-index';
  const resolvedId = `\0${id}`;
  return {
    name: 'drug-index',
    resolveId: (source) => (source === id ? resolvedId : undefined),
    load(loadId) {
      if (loadId !== resolvedId) return;
      const summaries = readdirSync(DRUGS_DIR)
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
          return summarize(result.data);
        })
        .sort((a, b) => a.brandName.localeCompare(b.brandName));
      return `export default ${JSON.stringify(summaries)};`;
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
