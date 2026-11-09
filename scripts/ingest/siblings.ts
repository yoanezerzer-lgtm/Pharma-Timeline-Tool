import type { Milestone } from '../../src/schema/index.js';
import type { IngestContext } from './context.js';
import { runDocsStage, type FetchedDoc } from './docs.js';
import { runFdaStage } from './fda.js';

/**
 * A second FDA application for the same product, approved on its own and
 * later folded into the main application's label. Nemluvio's atopic
 * dermatitis was approved under BLA 761391 (13 Dec 2024); its label was then
 * merged into BLA 761390's, whose own records never approve that use. The
 * sibling's first approval and first label are where the use's date is.
 */
export interface SiblingApproval {
  applicationType: 'NDA' | 'BLA';
  applicationNumber: string;
  /** The sibling's original approval. */
  original: Milestone;
  /** The label approved with it. */
  label: FetchedDoc;
  queryUrl: string;
}

/**
 * Applications of the same type that the main application's letters name
 * ("combined labeling based on the approval of BLAs 761390 and 761391").
 */
export function siblingNumbers(letterTexts: string[], type: 'NDA' | 'BLA' | 'ANDA', own: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`\\b${type}s?\\s+((?:\\d{6}(?:\\s*/\\s*S-\\d+)?(?:\\s*,\\s*|\\s+and\\s+)?)+)`, 'g');
  for (const text of letterTexts) {
    for (const m of text.matchAll(pattern)) {
      for (const n of m[1].replace(/\/\s*S-\d+/g, '').match(/\d{6}/g) ?? []) if (n !== own) found.add(n);
    }
  }
  return [...found].sort();
}

/**
 * Each sibling named in the letters that openFDA files under the same brand
 * name, with its original approval and the label approved with it. A
 * sibling under another brand (a letter citing some other product) is skipped.
 */
export async function siblingApprovals(
  ctx: IngestContext,
  letters: FetchedDoc[],
  type: 'NDA' | 'BLA' | 'ANDA',
  own: string,
  brandName: string
): Promise<SiblingApproval[]> {
  if (type === 'ANDA') return [];
  const out: SiblingApproval[] = [];
  for (const number of siblingNumbers(letters.map((l) => l.text), type, own)) {
    let fda;
    try {
      fda = await runFdaStage(ctx, number, type, brandName);
    } catch {
      continue;
    }
    const brands = (fda.application.products ?? []).map((p) => p.brand_name?.toLowerCase());
    if (!brands.includes(brandName.toLowerCase())) continue;
    const original = fda.milestones.find((m) => m.type === 'FDA_APPROVAL');
    if (!original) continue;
    const labelUrl = fda.documentUrls.find((d) => /label/i.test(d.type) && d.submission === original.submissionNumber);
    if (!labelUrl) continue;
    const [label] = await runDocsStage(ctx, [labelUrl]);
    if (!label) continue;
    out.push({ applicationType: type, applicationNumber: number, original, label, queryUrl: fda.queryUrl });
  }
  return out;
}
