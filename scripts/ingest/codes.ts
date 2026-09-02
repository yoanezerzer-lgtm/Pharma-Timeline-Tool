import { lookupById, studyMatchesDrug, studyIdentifiers, type CtgovStudy } from './ctgov.js';
import type { IngestContext } from './context.js';
import { pageForOffset } from './docs.js';

/**
 * Trial identifiers as they appear in FDA review documents.
 *
 * Reviews cite sponsor protocol numbers ("M13-549"), not NCT IDs. Those numbers
 * are recorded on the trial's own ClinicalTrials.gov record, so the registry can
 * be used as an oracle: a candidate that resolves to a study for this drug is
 * real, and one that resolves to nothing was noise.
 *
 * That is why the patterns below are deliberately permissive. Recall matters;
 * precision is bought for free by the lookup, so a wrong guess costs one cached
 * request and nothing else.
 */

export const NCT_PATTERN = /\bNCT\d{8}\b/g;

const CANDIDATE_PATTERNS: RegExp[] = [
  // Letter-prefixed protocol numbers: M13-549, GS-US-380, ABT-494
  /\b[A-Z]{1,4}\d{2,6}-\d{1,5}\b/g,
  // Letters run into digits: CV185030, A3921019
  /\b[A-Z]{1,3}\d{5,8}\b/g,
  // Numeric protocol series: 1200.22
  /\b\d{3,4}\.\d{1,4}\b/g,
  // Hyphenated trial acronyms: SELECT-COMPARE, SELECT-PsA, BALANCE-I, BALANCE-II.
  // The trailing segment allows a bare Roman numeral, because acronyms are
  // routinely numbered that way and a {2,} floor silently drops "-I".
  /\b[A-Z][A-Za-z]{2,}-(?:[IVX]{1,4}|[A-Za-z0-9]{2,})(?:-[A-Za-z0-9]+)?\b/g,
];

/**
 * Tokens that match the shape of a protocol number but never are one.
 * Document cross-references are the main source of false positives.
 */
const BLOCKLIST = new Set([
  'CFR-21',
  'ICH-E6',
  'ICH-E9',
  'MedDRA-25',
  'SI-Units',
  'Non-Inferiority',
  'Intent-To-Treat',
  'Per-Protocol',
  'Placebo-Controlled',
  'Double-Blind',
  'Open-Label',
  'Post-Hoc',
  'Follow-Up',
  // Phase references match the acronym shape but never name a study.
  'Phase-I',
  'Phase-II',
  'Phase-III',
  'Phase-IV',
]);

/** Words whose presence nearby suggests the token really is a study identifier. */
const CONTEXT_WORDS = /\b(study|studies|trial|trials|protocol|substudy)\b/gi;
const CONTEXT_WINDOW = 60;

export interface Candidate {
  token: string;
  /** How many times it appears across all documents. */
  occurrences: number;
  /** How often it appears near "study"/"trial"/"protocol". */
  contextHits: number;
  /** First page it was seen on, for provenance. */
  firstPage?: number;
  /** Sentence around the first occurrence, for provenance. */
  quote?: string;
  score: number;
}

function isPlausible(token: string): boolean {
  if (BLOCKLIST.has(token)) return false;
  // Reject bare date-like and version-like tokens.
  if (/^\d{4}\.\d{1,2}$/.test(token) && Number(token.slice(0, 4)) > 1980) return false;
  // Must contain at least one digit somewhere, or be a hyphenated acronym.
  if (!/\d/.test(token) && !token.includes('-')) return false;
  return true;
}

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 90);
  return text
    .slice(start, end)
    .replace(/<<<PAGE \d+>>>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pulls candidate trial identifiers out of document text.
 *
 * Pure and deterministic so it can be unit-tested against fixture text without
 * any network access.
 */
export function extractCandidates(text: string): Candidate[] {
  const found = new Map<string, Candidate>();

  const record = (token: string, index: number, matchLength: number) => {
    if (!isPlausible(token)) return;
    const existing = found.get(token);
    if (existing) {
      existing.occurrences++;
      return;
    }
    found.set(token, {
      token,
      occurrences: 1,
      contextHits: 0,
      firstPage: pageForOffset(text, index),
      quote: quoteAround(text, index, matchLength),
      score: 0,
    });
  };

  // NCT IDs are exact and never need validating, but they are collected here
  // so a single pass produces the full identifier set.
  for (const m of text.matchAll(NCT_PATTERN)) {
    record(m[0], m.index!, m[0].length);
  }

  for (const pattern of CANDIDATE_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      record(m[0], m.index!, m[0].length);
    }
  }

  // Count how often each token sits near a study-context word. This only orders
  // the lookup queue — it never excludes a candidate.
  for (const cand of found.values()) {
    const tokenPattern = new RegExp(
      cand.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    );
    for (const m of text.matchAll(tokenPattern)) {
      const window = text.slice(
        Math.max(0, m.index! - CONTEXT_WINDOW),
        m.index! + cand.token.length + CONTEXT_WINDOW
      );
      if (CONTEXT_WORDS.test(window)) cand.contextHits++;
      CONTEXT_WORDS.lastIndex = 0;
    }
    // NCT IDs always sort first; otherwise context beats raw frequency.
    cand.score = /^NCT\d{8}$/.test(cand.token)
      ? 10_000
      : cand.contextHits * 10 + Math.min(cand.occurrences, 20);
  }

  return [...found.values()].sort((a, b) => b.score - a.score);
}

export interface ResolvedCode {
  candidate: Candidate;
  /** Other identifiers in the documents that resolved to this same study. */
  aliases: Candidate[];
  study: CtgovStudy;
  nctId: string;
}

/**
 * Picks the mention best suited to being shown as the citation for a trial.
 *
 * Candidates are *looked up* in NCT-first order, because exact identifiers are
 * cheapest to confirm. But that ordering says nothing about which mention is
 * most useful to a human checking the source: an NCT ID usually appears in a
 * bare list of registrations, while a protocol number appears in the sentence
 * that actually describes the study. So citation choice is scored separately,
 * by how much study context surrounds the mention.
 *
 * Ordering is fully deterministic — the pipeline must produce byte-identical
 * output across runs.
 */
export function bestCitation(candidates: Candidate[]): Candidate {
  return [...candidates].sort((a, b) => {
    if (b.contextHits !== a.contextHits) return b.contextHits - a.contextHits;
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    const aIsNct = /^NCT\d{8}$/.test(a.token);
    const bIsNct = /^NCT\d{8}$/.test(b.token);
    if (aIsNct !== bIsNct) return aIsNct ? 1 : -1;
    return a.token.localeCompare(b.token);
  })[0];
}

export interface ResolveReport {
  resolved: ResolvedCode[];
  /** Looked up but matched no study for this drug. */
  rejected: Candidate[];
  /** Never looked up because the budget ran out. */
  skipped: Candidate[];
  lookups: number;
}

/**
 * Validates candidates against ClinicalTrials.gov.
 *
 * `maxLookups` bounds a run on a long review document. Candidates are already
 * ordered by how study-like their context is, so the budget is spent on the
 * most promising tokens first.
 */
export async function resolveCandidates(
  ctx: IngestContext,
  candidates: Candidate[],
  drugNames: string[],
  maxLookups = 400
): Promise<ResolveReport> {
  const resolved: ResolvedCode[] = [];
  const rejected: Candidate[] = [];
  const skipped: Candidate[] = [];
  const byNct = new Map<string, ResolvedCode>();
  let lookups = 0;

  for (const cand of candidates) {
    if (lookups >= maxLookups) {
      skipped.push(cand);
      continue;
    }

    lookups++;
    const studies = await lookupById(ctx, cand.token);

    // The registry can return near-matches, so require both that the study is
    // for this drug and that it genuinely carries the identifier we searched.
    const match = studies.find(
      (s) =>
        studyMatchesDrug(s, drugNames) &&
        studyIdentifiers(s).some((id) => id.toLowerCase() === cand.token.toLowerCase())
    );

    if (!match) {
      rejected.push(cand);
      continue;
    }

    const nctId = match.protocolSection?.identificationModule?.nctId;
    if (!nctId) continue;

    // Several identifiers routinely point at one study. Keep them all rather
    // than letting whichever resolved first decide how the trial is cited.
    const existing = byNct.get(nctId);
    if (existing) {
      existing.aliases.push(cand);
      continue;
    }
    const entry: ResolvedCode = { candidate: cand, aliases: [], study: match, nctId };
    byNct.set(nctId, entry);
    resolved.push(entry);
  }

  // Promote the most informative mention to be the citation.
  for (const entry of resolved) {
    entry.candidate = bestCitation([entry.candidate, ...entry.aliases]);
  }

  return { resolved, rejected, skipped, lookups };
}
