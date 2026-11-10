import { z } from 'zod';
import { DateValue } from '../schema/index.js';

/**
 * FDA review-time precedent: how long the FDA took, from receiving an
 * application to approving it, for comparable approvals in one disease.
 * Written by `npm run precedent` (scripts/precedent/) from openFDA and the
 * FDA's own approval letters; never by hand or by an AI.
 */

/** Where one value came from: a link, a label and, for a letter, the exact words. */
export const ValueSource = z.object({
  url: z.string().url(),
  /** "openFDA Drugs@FDA, BLA 761055 ORIG-1". */
  label: z.string(),
  /** The letter's own words, when the value was read from a letter. */
  quote: z.string().optional(),
});
export type ValueSource = z.infer<typeof ValueSource>;

const Sourced = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source: ValueSource });

export const PrecedentProduct = z.object({
  brandName: z.string(),
  inn: z.string().optional(),
  /** "BLA 761055". */
  application: z.string(),
  applicationType: z.enum(['NDA', 'BLA']),
  /** "ORIG-1", "SUPPL-12". */
  submission: z.string(),
  /** Set when the drug has its own page on this site: the approval is that use's first. */
  site: z.object({ drugSlug: z.string(), indicationSlug: z.string() }).optional(),
  /**
   * Only from openFDA's label search: the product's first approval, whose use
   * may have been another disease. The label's sentence naming this disease is `indication`.
   */
  originalOnly: z.boolean().optional(),
  /** Severity the FDA wording names (see diseases.ts severityOfText). */
  severity: z.enum(['moderate-to-severe', 'mild-to-moderate', 'not-stated']),
  /** The label's sentence naming the disease, for products found by label search. */
  indication: Sourced(z.string()).optional(),
  approvalDate: Sourced(DateValue).optional(),
  receiptDate: Sourced(DateValue).optional(),
  /** openFDA's review_priority: "PRIORITY" or "STANDARD". */
  reviewPriority: Sourced(z.enum(['PRIORITY', 'STANDARD'])).optional(),
  /** openFDA's submission class, e.g. "Type 1 - New Molecular Entity". */
  submissionClass: Sourced(z.string()).optional(),
  /** Orphan flag as openFDA records it on the submission; undefined when openFDA records none. */
  orphan: Sourced(z.literal(true)).optional(),
  /**
   * Accelerated approval, read from the approval letter: true with the
   * letter's words, false when the letter was read and doesn't say so,
   * undefined when no letter text was available.
   */
  accelerated: Sourced(z.boolean()).optional(),
});
export type PrecedentProduct = z.infer<typeof PrecedentProduct>;

export const PrecedentFile = z.object({
  meshId: z.string(),
  term: z.string(),
  /** The phrases searched for in openFDA label indications. */
  searched: z.array(z.string()),
  /** The day this file was made (YYYY-MM-DD). */
  retrievedAt: z.string(),
  /** openFDA's own "last_updated" for Drugs@FDA: the data's date. */
  openFdaUpdated: z.string().optional(),
  products: z.array(PrecedentProduct),
});
export type PrecedentFile = z.infer<typeof PrecedentFile>;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "April 27, 2020" → 2020-04-27; anything misread (OCR's "Febmmy") → undefined. */
export function parseLetterDate(raw: string): DateValue | undefined {
  const m = /^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/.exec(raw.trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  const value = `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Reject 31 February and the like.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return undefined;
  return { value, precision: 'day' };
}

const DATE = String.raw`[A-Z][a-z]+\s+\d{1,2}\s*,\s*\d{4}`;

/**
 * The date the FDA received the application, from the approval letter's
 * opening sentence, in the forms FDA letters use: "Please refer to your
 * biologics license application (BLA) dated and received April 27, 2020",
 * "… dated December 18, 2018, received December 18, 2018", "… received
 * June 14, 2024, and your amendments", "dated and received on …". Only that
 * opening is read, so a later "reports received directly by the FDA" can't
 * be taken for it. A letter that covers several submissions with their own
 * dates, or gives only the application's own date ("dated July 8, 2019"),
 * leaves a gap. The quote is the letter's words, checked to be in the text.
 */
export function receiptFromLetter(text: string): { date: DateValue; quote: string } | undefined {
  const flat = text.replace(/<<<PAGE \d+>>>/g, ' ').replace(/\s+/g, ' ');
  const open = /Please refer to your\b/i.exec(flat);
  if (!open) return undefined;
  let opening = flat.slice(open.index, open.index + 400);
  const end = /\bsubmitted (?:under|pursuant)\b|\band your amendments?\b|\bsection (?:505|351)\b/i.exec(opening);
  if (end) opening = opening.slice(0, end.index);
  const received = [...opening.matchAll(new RegExp(String.raw`\breceived,?\s+(?:on\s+)?(${DATE})`, 'g'))];
  const dates = new Set([...opening.matchAll(new RegExp(DATE, 'g'))].map((m) => m[0].replace(/\s+/g, ' ')));
  if (received.length !== 1 || dates.size > 2) return undefined;
  const date = parseLetterDate(received[0][1]);
  if (!date) return undefined;
  const quote = opening.slice(0, received[0].index! + received[0][0].length);
  if (!flat.includes(quote)) return undefined;
  return { date, quote };
}

/**
 * Whether the letter grants accelerated approval: it cites the accelerated
 * approval rules (21 CFR 314.510 for drugs, 601.41 for biologics, subpart H
 * or E) or says "accelerated approval". A conversion letter (accelerated to
 * regular) also says so, which is why only first approvals are read.
 */
export function acceleratedFromLetter(text: string): { value: boolean; quote?: string } {
  const flat = text.replace(/<<<PAGE \d+>>>/g, ' ').replace(/\s+/g, ' ');
  const m = /[^.]{0,160}(?:accelerated approval|21 CFR (?:314\.510|601\.41)|subpart [HE]\b)[^.]{0,120}/i.exec(flat);
  return m ? { value: true, quote: m[0].trim() } : { value: false };
}

/** Days from receipt to approval; undefined unless both are known to the day and in order. */
export function reviewDays(p: Pick<PrecedentProduct, 'receiptDate' | 'approvalDate'>): number | undefined {
  const a = p.receiptDate?.value;
  const b = p.approvalDate?.value;
  if (!a || !b || a.precision !== 'day' || b.precision !== 'day') return undefined;
  const days = Math.round((Date.parse(`${b.value}T00:00:00Z`) - Date.parse(`${a.value}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : undefined;
}

/** Drybench's rule: no median from fewer than five products with both dates. */
export const MIN_SAMPLE = 5;

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface ReviewStats {
  /** Products in the view. */
  total: number;
  /** Review times of the products with both dates, in table order. */
  days: { brandName: string; days: number }[];
  /** The median, only when at least MIN_SAMPLE products have both dates. */
  median?: number;
  /** Accelerated approval: how many letters say so, of how many letters read. */
  accelerated: { yes: number; known: number };
  /** Any of the expedited flags the sources record (accelerated approval, orphan), of all products. */
  expedited: { yes: number; total: number };
  priority: { yes: number; known: number };
}

export function reviewStats(products: PrecedentProduct[]): ReviewStats {
  const days = products.flatMap((p) => {
    const d = reviewDays(p);
    return d === undefined ? [] : [{ brandName: p.brandName, days: d }];
  });
  const accKnown = products.filter((p) => p.accelerated !== undefined);
  const prioKnown = products.filter((p) => p.reviewPriority !== undefined);
  return {
    total: products.length,
    days,
    median: days.length >= MIN_SAMPLE ? median(days.map((d) => d.days)) : undefined,
    accelerated: { yes: accKnown.filter((p) => p.accelerated!.value).length, known: accKnown.length },
    expedited: { yes: products.filter(isExpedited).length, total: products.length },
    priority: { yes: prioKnown.filter((p) => p.reviewPriority!.value === 'PRIORITY').length, known: prioKnown.length },
  };
}

export function isExpedited(p: PrecedentProduct): boolean {
  return !!p.orphan || !!p.accelerated?.value;
}

/** "57%", or undefined with nothing to divide by. */
export function percent(yes: number, of: number): string | undefined {
  return of > 0 ? `${Math.round((yes / of) * 100)}%` : undefined;
}
