import { formatDate, toDateValue } from './dates.js';
import { approvalKindLabel } from './copy.js';
import type { DiseaseUse, UseStep } from './diseases.js';
import type { PrecedentProduct, ValueSource } from './reviewTime.js';

/**
 * One source a claim on the page rests on, as the source panel shows it.
 * The same document cited twice has one id, so it keeps one number.
 */
export interface CiteSource {
  /** The document's address, so one document is one source. */
  id: string;
  title: string;
  agency: string;
  /** "Approval letter", "Application record (openFDA API)". */
  docType: string;
  /** The document's date, or its data date, as shown. */
  date?: string;
  url: string;
  /** The passage the claim was read from, word for word. */
  excerpt?: string;
  /** Field values read from a structured record. */
  fields?: [string, string][];
}

export const FDA = 'U.S. Food and Drug Administration';

/** An FDA approval letter behind one step of a use's history. */
export function letterSource(u: Pick<DiseaseUse, 'brandName' | 'application'>, s: UseStep): CiteSource | undefined {
  if (!s.sourceUrl) return undefined;
  const subs = s.submissions.join(', ');
  return {
    id: s.sourceUrl,
    title: `${u.brandName} approval letter, ${u.application}${subs ? ` ${subs}` : ''}`,
    agency: FDA,
    docType: 'Approval letter',
    date: s.date ? formatDate(s.date) : undefined,
    url: s.sourceUrl,
    excerpt: s.text,
    fields: [
      ['Approval type', approvalKindLabel(s.kind, s.submissions)],
      ['Application', u.application],
      ...(subs ? ([['Submission', subs]] as [string, string][]) : []),
    ],
  };
}

const ISO = (iso?: string) => (iso ? formatDate(toDateValue(iso)) : undefined);

/**
 * The sources behind one row of the review-time table: openFDA's record of
 * the application (with the field values used), the approval letter (with
 * its sentences) and, for a product found by label search, its label.
 */
export function productSources(p: PrecedentProduct, openFdaUpdated?: string): { record?: CiteSource; letter?: CiteSource; label?: CiteSource } {
  const recordSrc = p.approvalDate?.source ?? p.reviewPriority?.source ?? p.submissionClass?.source;
  const record: CiteSource | undefined = recordSrc && {
    id: recordSrc.url,
    title: `Drugs@FDA record, ${p.application} (${p.brandName})`,
    agency: `${FDA}, via openFDA`,
    docType: 'Application record (openFDA API)',
    date: openFdaUpdated ? `data of ${ISO(openFdaUpdated)}` : undefined,
    url: recordSrc.url,
    fields: [
      ['Application', p.application],
      ['Submission', p.submission],
      ...(p.approvalDate ? ([['submission_status_date (approved)', formatDate(p.approvalDate.value)]] as [string, string][]) : []),
      ['review_priority', p.reviewPriority?.value ?? 'not recorded'],
      ['submission_class', p.submissionClass?.value ?? 'not recorded'],
      ['submission_property_type', p.orphan ? 'Orphan' : 'none recorded'],
    ],
  };
  const letterSrc: ValueSource | undefined = p.receiptDate?.source ?? p.accelerated?.source;
  const quotes = [p.receiptDate?.source.quote, p.accelerated?.value ? p.accelerated.source.quote : undefined].filter((q): q is string => !!q);
  const letter: CiteSource | undefined = letterSrc && {
    id: letterSrc.url,
    title: `${p.brandName} approval letter, ${p.application} ${p.submission}`,
    agency: FDA,
    docType: 'Approval letter',
    date: p.approvalDate ? formatDate(p.approvalDate.value) : undefined,
    url: letterSrc.url,
    excerpt: quotes.length > 0 ? quotes.map((q) => `“${q}”`).join(' … ') : undefined,
    fields: [
      ['Received', p.receiptDate ? formatDate(p.receiptDate.value) : 'not stated in the letter'],
      ['Accelerated approval', p.accelerated ? (p.accelerated.value ? 'yes' : 'not mentioned') : 'letter not read'],
    ],
  };
  const label: CiteSource | undefined = p.indication && {
    id: p.indication.source.url,
    title: `${p.brandName} label, ${p.application}`,
    agency: `${FDA}, via openFDA and DailyMed`,
    docType: 'Prescribing information (current label)',
    date: openFdaUpdated ? `data of ${ISO(openFdaUpdated)}` : undefined,
    url: p.indication.source.url,
    excerpt: p.indication.value,
  };
  return { record, letter, label };
}

/** A trial's ClinicalTrials.gov record. */
export function registrySource(nctId: string, name: string, fields: [string, string][] = []): CiteSource {
  return {
    id: `https://clinicaltrials.gov/study/${nctId}`,
    title: `${name} (${nctId}), ClinicalTrials.gov record`,
    agency: 'U.S. National Library of Medicine',
    docType: 'Trial registry record',
    url: `https://clinicaltrials.gov/study/${nctId}`,
    fields,
  };
}

/**
 * One document cited from two places (the approval sentence on the
 * timeline, the receipt quote in the review table) is one source: its
 * excerpts and field values are combined, first-cited first.
 */
export function mergeSources(a: CiteSource, b: CiteSource): CiteSource {
  const excerpts = [...new Set([a.excerpt, b.excerpt].flatMap((x) => (x ? x.split('\n\n') : [])))];
  const fields = [...(a.fields ?? [])];
  for (const f of b.fields ?? []) if (!fields.some(([k]) => k === f[0])) fields.push(f);
  return { ...a, date: a.date ?? b.date, excerpt: excerpts.length ? excerpts.join('\n\n') : undefined, fields: fields.length ? fields : undefined };
}
