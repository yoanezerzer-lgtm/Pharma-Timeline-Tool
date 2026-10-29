import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, drugRawDir } from './http.js';
import type { IngestContext } from './context.js';

/**
 * FDA review packages that openFDA doesn't list.
 *
 * openFDA links a review for only some supplements (Keytruda: 15 of 63
 * approvals). The Drugs@FDA page for the application links the rest. A
 * package is either one PDF or a table-of-contents page listing its review
 * PDFs. Each file name carries its own submission ("125514Orig1s040"), so
 * the links are read from the page without depending on its layout.
 */

export interface ReviewLink {
  url: string;
  type: 'Review';
  submission: string;
}

const BASE = 'https://www.accessdata.fda.gov';

export function drugsAtFdaUrl(applicationNumber: string): string {
  return `${BASE}/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${applicationNumber}`;
}

/** "125514Orig1s040" → "SUPPL-40", "125514Orig1s000" → "ORIG-1". */
export function submissionOf(name: string, applicationNumber: string): string | undefined {
  const m = name.match(new RegExp(`${applicationNumber}Orig1s0*(\\d+)`, 'i'));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n === 0 ? 'ORIG-1' : `SUPPL-${n}`;
}

function absolute(href: string, page: string): string {
  return new URL(href.replace(/&amp;/g, '&'), page).toString();
}

/** Review packages linked from a Drugs@FDA page: PDFs and table-of-contents pages under drugsatfda_docs/nda/. */
export function reviewPackageLinks(html: string, applicationNumber: string, page: string): { url: string; submission: string }[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']*drugsatfda_docs\/nda\/[^"']+\.(?:pdf|cfm|html?))["']/gi)) {
    const url = absolute(m[1], page);
    const submission = submissionOf(url, applicationNumber);
    if (submission) out.set(url, submission);
  }
  return [...out].map(([url, submission]) => ({ url, submission }));
}

/**
 * The clinical review PDFs a table-of-contents page lists: multidiscipline,
 * medical, statistical, summary and cross-discipline reviews, the ones that
 * say which trials the approval rests on. Chemistry, pharmacology and
 * manufacturing reviews, letters, labels and correspondence are left out.
 */
const CLINICAL_REVIEW = /(?:Multidiscipline|Med|Stat|Sum|Cross|ClinPharm)R\.pdf$/;

export function reviewPdfsOnToc(html: string, page: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.pdf)["']/gi)) {
    if (CLINICAL_REVIEW.test(m[1])) out.add(absolute(m[1], page));
  }
  return [...out];
}

async function readPage(ctx: IngestContext, url: string, name: string): Promise<string | undefined> {
  // Saved as .txt beside the PDFs' text, so the diagnostic branch carries what was read.
  const path = join(drugRawDir(ctx.slug, ctx.rawDir), 'docs', `${name}.txt`);
  try {
    await downloadFile(url, path, ctx.refresh);
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.warn(`  ! could not read ${url}: ${(err as Error).message}`);
    return undefined;
  }
}

/** Every review PDF Drugs@FDA links for the application, each with its submission. */
export async function findReviews(ctx: IngestContext, applicationNumber: string): Promise<ReviewLink[]> {
  const page = drugsAtFdaUrl(applicationNumber);
  const html = await readPage(ctx, page, `drugsatfda-${applicationNumber}.html`);
  if (!html) return [];
  const out: ReviewLink[] = [];
  for (const link of reviewPackageLinks(html, applicationNumber, page)) {
    if (/\.pdf$/i.test(link.url)) {
      out.push({ url: link.url, type: 'Review', submission: link.submission });
      continue;
    }
    const name = link.url.split('/').pop()!;
    const toc = await readPage(ctx, link.url, name);
    for (const url of toc ? reviewPdfsOnToc(toc, link.url) : []) out.push({ url, type: 'Review', submission: link.submission });
  }
  return out;
}
