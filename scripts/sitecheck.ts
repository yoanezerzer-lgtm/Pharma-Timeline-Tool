/**
 * Opens the site in a real browser and fails if a page is broken or empty:
 * the home list, every drug page, and every drug's first approved use.
 *
 *   npx tsx scripts/sitecheck.ts <site-url>
 *
 * Run by CI against a local build and after each deploy against the live
 * site. Set PW_CHROMIUM to use a browser already installed elsewhere.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const base = (process.argv[2] ?? 'http://localhost:4173/').replace(/\/?$/, '/');
const drugs = readdirSync('data/drugs')
  .filter((f) => f.endsWith('.json'))
  .map(
    (f) =>
      JSON.parse(readFileSync(`data/drugs/${f}`, 'utf8')) as {
        slug: string;
        brandName: string;
        indications: { slug: string; diseases?: { meshId: string }[] }[];
      }
  );

const problems: string[] = [];

async function visit(page: Page, path: string, expect: (page: Page) => Promise<string | undefined>): Promise<void> {
  const errors: string[] = [];
  page.removeAllListeners('pageerror');
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Loading…'), undefined, { timeout: 15000 });
    const problem = await expect(page);
    if (problem) problems.push(`${path}: ${problem}`);
  } catch (e) {
    problems.push(`${path}: ${(e as Error).message.split('\n')[0]}`);
  }
  for (const e of errors) problems.push(`${path}: script error: ${e}`);
}

const text = (page: Page) => page.evaluate(() => document.body.innerText);

async function main(): Promise<void> {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();

  await visit(page, '', async (p) => {
    const rows = await p.locator('.index__row').count();
    return rows < drugs.length ? `home list shows ${rows} of ${drugs.length} drugs` : undefined;
  });

  for (const d of drugs) {
    await visit(page, `drug/${d.slug}/`, async (p) => {
      const body = await text(p);
      if (!(await p.title()).includes(d.brandName)) return `page title lacks the name ${d.brandName}`;
      if (/Page not found|Couldn’t load/.test(body)) return 'drug page did not load';
      if (!body.toLowerCase().includes(d.brandName.toLowerCase())) return `drug page lacks the name ${d.brandName}`;
      if (!/approved uses/i.test(body)) return 'drug page lacks its approved uses';
      return undefined;
    });
    const first = d.indications[0];
    if (!first) continue;
    await visit(page, `drug/${d.slug}/indication/${first.slug}/`, async (p) => {
      const body = await text(p);
      if (/Page not found|has no approved use|Couldn’t load/.test(body)) return 'approved-use page did not load';
      return /regulatory milestones|trials supporting/i.test(body) ? undefined : 'approved-use page is empty';
    });
  }

  await visit(page, 'diseases/', async (p) => {
    const body = await text(p);
    return /\d+ diseases with FDA approvals/.test(body) ? undefined : 'disease list did not load';
  });
  const diseases = new Set(drugs.flatMap((d) => d.indications.flatMap((i) => (i.diseases ?? []).map((x) => x.meshId))));
  for (const id of diseases) {
    await visit(page, `disease/${id}/`, async (p) => {
      const body = await text(p);
      return /approvals over time/i.test(body) ? undefined : 'disease page is empty';
    });
  }

  // An address that isn't a page says so, rather than showing the home page.
  await visit(page, 'no-such-page/', async (p) =>
    /Page not found/.test(await text(p)) ? undefined : 'unknown address did not show "Page not found"'
  );

  // Links shared before pages had their own addresses ("#/drug/x") still open the page.
  const old = drugs[0];
  if (old) {
    await visit(page, `#/drug/${old.slug}`, async (p) =>
      new URL(p.url()).pathname.endsWith(`/drug/${old.slug}/`) ? undefined : `old link was not moved to its page (${p.url()})`
    );
  }

  await browser.close();
  const pages = 4 + drugs.length + drugs.filter((d) => d.indications.length > 0).length + diseases.size;
  if (problems.length > 0) {
    console.error(`Site check: ${problems.length} problem(s) across ${pages} pages at ${base}`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Site check: all ${pages} pages at ${base} load and show their content.`);
}

main();
