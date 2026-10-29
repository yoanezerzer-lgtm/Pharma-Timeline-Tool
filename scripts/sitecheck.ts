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
  .map((f) => JSON.parse(readFileSync(`data/drugs/${f}`, 'utf8')) as { slug: string; brandName: string; indications: { slug: string }[] });

const problems: string[] = [];

async function visit(page: Page, hash: string, expect: (page: Page) => Promise<string | undefined>): Promise<void> {
  const errors: string[] = [];
  page.removeAllListeners('pageerror');
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${base}${hash}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Loading…'), undefined, { timeout: 15000 });
    const problem = await expect(page);
    if (problem) problems.push(`${hash}: ${problem}`);
  } catch (e) {
    problems.push(`${hash}: ${(e as Error).message.split('\n')[0]}`);
  }
  for (const e of errors) problems.push(`${hash}: script error: ${e}`);
}

const text = (page: Page) => page.evaluate(() => document.body.innerText);

async function main(): Promise<void> {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();

  await visit(page, '#/', async (p) => {
    const rows = await p.locator('.index__row').count();
    return rows < drugs.length ? `home list shows ${rows} of ${drugs.length} drugs` : undefined;
  });

  for (const d of drugs) {
    await visit(page, `#/drug/${d.slug}`, async (p) => {
      const body = await text(p);
      if (/No drug record found|Couldn’t load/.test(body)) return 'drug page did not load';
      if (!body.toLowerCase().includes(d.brandName.toLowerCase())) return `drug page lacks the name ${d.brandName}`;
      if (!/approved uses/i.test(body)) return 'drug page lacks its approved uses';
      return undefined;
    });
    const first = d.indications[0];
    if (!first) continue;
    await visit(page, `#/drug/${d.slug}/indication/${first.slug}`, async (p) => {
      const body = await text(p);
      if (/No drug record found|has no indication|Couldn’t load/.test(body)) return 'approved-use page did not load';
      return /regulatory milestones|trials supporting/i.test(body) ? undefined : 'approved-use page is empty';
    });
  }

  await browser.close();
  const pages = 1 + drugs.length + drugs.filter((d) => d.indications.length > 0).length;
  if (problems.length > 0) {
    console.error(`Site check: ${problems.length} problem(s) across ${pages} pages at ${base}`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Site check: all ${pages} pages at ${base} load and show their content.`);
}

main();
