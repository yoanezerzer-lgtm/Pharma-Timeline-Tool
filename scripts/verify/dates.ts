import { sameWording, wordingKey } from '../../src/lib/wording.js';
import type { Drug, Milestone } from '../../src/schema/index.js';
import { stripPageMarkers } from '../ingest/docs.js';
import { keyWords, labelListsIndication } from '../ingest/indicationDates.js';
import { sectionOneWindows } from '../ingest/roles.js';
import type { Reference } from '../qc/reference.js';
import { normalize, type Passage, type SourceDoc } from './sources.js';

/**
 * Approval-date claims: "Was <use> first approved by <submission> on
 * <date>?". Code finds the letter and labels that settle it and checks the
 * answer; the agent only reads them. See docs/agents/nightly-verify.md.
 */

export interface DateClaim {
  kind: 'date';
  id: string;
  drug: string;
  indication: string;
  submission: string;
  date: string;
  question: string;
  /** The label's own sentence for the use, when the site shows one. */
  wording?: string;
  passages: Passage[];
}

/**
 * Brings a reference file's approval dates in line with what the site shows
 * now, the same idea as syncPivotal: a use the file lacks gets an unchecked
 * entry, and an unchecked entry for a use the site no longer shows, or with
 * a date or submission the site no longer gives it, is replaced by what the
 * site shows (its tries start again). A confirmed entry is never touched.
 * Wording matches with spaces ignored. Returns the same object when nothing
 * changed.
 */
export function syncIndications(drug: Drug, ref: Reference): Reference {
  const current = new Map(
    drug.indications.map((i) => [
      wordingKey(i.name),
      { name: i.name, approvalDate: i.approvalDate?.value ?? null, submission: i.submissionNumber ?? null },
    ])
  );
  const kept = ref.indications.filter((r) => {
    if (r.status === 'confirmed') return true;
    const now = current.get(wordingKey(r.name));
    return !!now && now.approvalDate === r.approvalDate && now.submission === r.submission;
  });
  const known = new Set(kept.map((r) => wordingKey(r.name)));
  const added = [...current.entries()]
    .filter(([k]) => !known.has(k))
    .map(([, x]) => ({ ...x, status: 'baseline' as const }));
  if (added.length === 0 && kept.length === ref.indications.length) return ref;
  return { ...ref, indications: [...kept, ...added] };
}

/** Unchecked uses with no date: nothing to confirm, only counted. */
export function undatedCount(ref: Reference): number {
  return ref.indications.filter((r) => r.status === 'baseline' && !r.approvalDate).length;
}

const isApproval = (m: Milestone) => (m.type === 'FDA_APPROVAL' || m.type === 'FDA_SUPPLEMENT') && !!m.submissionNumber;

export function milestoneOf(drug: Drug, submission: string): Milestone | undefined {
  return drug.milestones.find((m) => isApproval(m) && m.submissionNumber === submission);
}

const filedUnder = (doc: SourceDoc, submission: string) => (doc.submissions ?? []).includes(submission);

export function lettersOf(sources: SourceDoc[], submission: string): SourceDoc[] {
  return sources.filter((s) => s.kind === 'letter' && filedUnder(s, submission));
}

interface DatedLabel {
  doc: SourceDoc;
  submission: string;
  date: string;
}

/** Every label filed under one of the drug's approvals, oldest first. */
function datedLabels(drug: Drug, sources: SourceDoc[]): DatedLabel[] {
  const out: DatedLabel[] = [];
  for (const doc of sources.filter((s) => s.kind === 'label')) {
    for (const submission of doc.submissions ?? []) {
      const m = milestoneOf(drug, submission);
      if (m && !out.some((x) => x.doc.text === doc.text && x.submission === submission)) out.push({ doc, submission, date: m.date.value });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const lists = (name: string, l: DatedLabel) => labelListsIndication(name, { submission: l.submission, url: l.doc.url, text: l.doc.text });

/** The submission's own label, and the newest readable label approved before it. */
function labelsAround(drug: Drug, sources: SourceDoc[], name: string, submission: string) {
  const all = datedLabels(drug, sources);
  const own = all.find((l) => l.submission === submission);
  const date = milestoneOf(drug, submission)?.date.value;
  const previous = date ? [...all].reverse().find((l) => l.date < date && lists(name, l) !== undefined) : undefined;
  return { own, previous };
}

/**
 * The second source, read by code: the submission's label lists the use and
 * the newest readable label before it doesn't (for the original approval,
 * its own label lists it).
 */
export function labelSecondSource(drug: Drug, sources: SourceDoc[], name: string, submission: string): { ok: true; how: string } | { ok: false; why: string } {
  const m = milestoneOf(drug, submission);
  if (!m) return { ok: false, why: `${submission} is not one of the drug's approvals` };
  const { own, previous } = labelsAround(drug, sources, name, submission);
  if (!own) return { ok: false, why: `no label filed under ${submission} to show the use was added then` };
  if (lists(name, own) !== true) return { ok: false, why: `the ${submission} label's section 1 does not list it` };
  if (m.type === 'FDA_APPROVAL') return { ok: true, how: `the original label (${submission}) lists it` };
  if (!previous) return { ok: false, why: `no readable label before ${submission} to show the use was new then` };
  if (lists(name, previous) !== false) return { ok: false, why: `the ${previous.submission} label, approved before it, already lists it` };
  return { ok: true, how: `the ${submission} label lists it and the ${previous.submission} label before it does not` };
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/**
 * Whether a passage names this use: it carries every key word of the use's
 * name, or the words of its name no other use of the drug has ("hnscc"), or
 * every key word of the label's own sentence for it. Abbreviations in
 * parentheses count ("head and neck squamous cell carcinoma (HNSCC)").
 */
export function namesUse(text: string, name: string, drug: Drug): boolean {
  const words = keyWords(normalize(text).replace(/[()]/g, ' '));
  const target = keyWords(name);
  if (target.size > 0 && isSubset(target, words)) return true;
  const others = drug.indications.filter((i) => !sameWording(i.name, name)).map((i) => keyWords(i.name));
  const own = new Set([...target].filter((w) => !others.some((o) => o.has(w))));
  if (own.size > 0 && isSubset(own, words)) return true;
  const wording = drug.indications.find((i) => sameWording(i.name, name))?.wording?.text;
  const full = wording ? keyWords(wording) : new Set<string>();
  return full.size > 0 && isSubset(full, words);
}

const PURPOSE = /provides for|indicated for|is indicated|following indications?/gi;
// Room for a letter's whole list of uses: Rybrevant Faspro's ORIG-1 letter lists four in about 1,300 characters.
const LETTER_WINDOW = 1800;
const SECTION_CAP = 4000;

/** Where a letter says what it approves (overlapping stretches merged); its opening when no such phrase is found. */
function letterPassages(doc: SourceDoc, submission: string): Passage[] {
  const text = stripPageMarkers(doc.text);
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(PURPOSE)) {
    const start = Math.max(0, m.index - 150);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], m.index + LETTER_WINDOW);
    else ranges.push([start, m.index + LETTER_WINDOW]);
  }
  if (ranges.length === 0) ranges.push([0, LETTER_WINDOW]);
  return ranges.slice(0, 3).map(([from, to]) => ({
    sourceUrl: doc.url,
    kind: 'letter' as const,
    inIndicationSpan: false,
    about: `Approval letter (${submission})`,
    text: normalize(text.slice(from, to)),
  }));
}

/** A label's real section 1 (the last copy; the first is the table of contents). */
function sectionOne(doc: SourceDoc, about: string): Passage | undefined {
  const windows = sectionOneWindows(stripPageMarkers(doc.text));
  if (windows.length === 0) return undefined;
  return { sourceUrl: doc.url, kind: 'label', inIndicationSpan: false, about, text: normalize(windows[windows.length - 1]).slice(0, SECTION_CAP) };
}

export function datePassages(drug: Drug, sources: SourceDoc[], name: string, submission: string): Passage[] {
  const { own, previous } = labelsAround(drug, sources, name, submission);
  return [
    ...lettersOf(sources, submission).flatMap((d) => letterPassages(d, submission)),
    ...(own ? [sectionOne(own.doc, `Label approved with ${submission}, section 1`)] : []),
    ...(previous ? [sectionOne(previous.doc, `Label before it (${previous.submission}, ${previous.date}), section 1`)] : []),
  ].filter((p): p is Passage => !!p);
}

export function dateClaimFor(
  drug: Drug,
  sources: SourceDoc[],
  x: { indication: string; submission: string; date: string },
  id: string
): DateClaim {
  const wording = drug.indications.find((i) => sameWording(i.name, x.indication))?.wording?.text;
  return {
    kind: 'date',
    id,
    drug: drug.slug,
    indication: x.indication,
    submission: x.submission,
    date: x.date,
    question: `Was ${drug.brandName} first approved for "${x.indication}" by ${x.submission}, approved on ${x.date}?`,
    ...(wording ? { wording } : {}),
    passages: datePassages(drug, sources, x.indication, x.submission),
  };
}

/**
 * Planted false date claims: a real use paired with another of the drug's
 * approvals, on that approval's date, whose letter doesn't name the use and
 * whose label didn't add it. Must come back not supported.
 */
export function dateDecoyCandidates(drug: Drug, sources: SourceDoc[]): { indication: string; submission: string; date: string }[] {
  const out: { indication: string; submission: string; date: string }[] = [];
  for (const ind of drug.indications) {
    if (!ind.approvalDate || !ind.submissionNumber) continue;
    for (const m of drug.milestones.filter(isApproval)) {
      const submission = m.submissionNumber!;
      if (submission === ind.submissionNumber || m.date.value === ind.approvalDate.value) continue;
      const letters = lettersOf(sources, submission);
      if (letters.length === 0 || letters.some((l) => namesUse(l.text, ind.name, drug))) continue;
      if (labelSecondSource(drug, sources, ind.name, submission).ok) continue;
      out.push({ indication: ind.name, submission, date: m.date.value });
    }
  }
  return out;
}

type QuoteCheck = { ok: true; doc: SourceDoc } | { ok: false; reason: string };

const MIN_QUOTE_LENGTH = 40;

/** Word for word in one of the drug's loaded documents, and long enough to mean something. */
export function checkDateQuote(quote: string, sourceUrl: string, sources: SourceDoc[]): QuoteCheck {
  const doc = sources.find((d) => d.url === sourceUrl);
  if (!doc) return { ok: false, reason: `not one of the drug's loaded source documents: ${sourceUrl}` };
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_LENGTH) return { ok: false, reason: `quote shorter than ${MIN_QUOTE_LENGTH} characters` };
  if (!normalize(doc.text).includes(q)) return { ok: false, reason: 'quote does not appear word for word in the document' };
  return { ok: true, doc };
}

export interface DateGrade {
  outcome: 'confirmed' | 'rejected' | 'disagreement';
  detail: string;
  evidence: { sourceUrl: string; quote: string }[];
}

/**
 * The code half of a date confirmation. "Supported" needs all of: a verified
 * quote from that submission's approval letter naming the use; the
 * submission's openFDA date equal to the claimed date; and the labels
 * agreeing (labelSecondSource). "Contradicted" needs a verified quote.
 */
export function gradeDate(
  claim: DateClaim,
  verdict: 'supported' | 'contradicted',
  evidenceIn: { sourceUrl: string; quote: string }[],
  reason: string,
  drug: Drug,
  sources: SourceDoc[]
): DateGrade {
  const checks = evidenceIn.map((e) => ({ e, c: checkDateQuote(e.quote, e.sourceUrl, sources) }));
  const failed = checks.flatMap((x) => (x.c.ok ? [] : [x.c.reason]));
  const valid = checks.flatMap((x) => (x.c.ok ? [{ ...x.e, doc: x.c.doc }] : []));
  const evidence = valid.map(({ sourceUrl, quote }) => ({ sourceUrl, quote }));

  if (verdict === 'contradicted') {
    return valid.length > 0
      ? { outcome: 'disagreement', detail: reason, evidence }
      : { outcome: 'rejected', detail: `Answered "contradicted" without a verifiable quote. ${failed.join('; ')}`, evidence: [] };
  }

  const letterQuote = valid.some((x) => x.doc.kind === 'letter' && filedUnder(x.doc, claim.submission) && namesUse(x.quote, claim.indication, drug));
  const m = milestoneOf(drug, claim.submission);
  const dateOk = m?.date.value === claim.date;
  const labels = labelSecondSource(drug, sources, claim.indication, claim.submission);
  if (letterQuote && dateOk && labels.ok) {
    return { outcome: 'confirmed', detail: `Confirmed by the ${claim.submission} approval letter; ${labels.how}.`, evidence };
  }
  const why = [
    ...failed,
    ...(letterQuote ? [] : [`no verified quote from the ${claim.submission} approval letter naming "${claim.indication}"`]),
    ...(dateOk ? [] : [m ? `${claim.submission} was approved on ${m.date.value}, not ${claim.date}` : `${claim.submission} is not one of the drug's approvals`]),
    ...(labels.ok ? [] : [labels.why]),
  ];
  return { outcome: 'rejected', detail: why.join('; '), evidence };
}
