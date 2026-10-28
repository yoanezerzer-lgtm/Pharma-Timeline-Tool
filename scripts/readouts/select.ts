import type { DateValue, Provenance, Trial } from '../../src/schema/index.js';

/**
 * Picks a trial's readout: the first public announcement of its primary
 * result, from press releases and SEC filings already fetched. Pure, so the
 * rule is tested without a network.
 */

export interface Release {
  url: string;
  /** Where it came from, shown as the source label ("PR Newswire", "SEC 8-K"). */
  source: string;
  /** YYYY-MM-DD, from the page's own publication date. */
  date: string;
  title: string;
  text: string;
}

export interface Readout {
  date: DateValue;
  provenance: Provenance;
}

/** Days before primary completion a release may fall and still count (dates are often month-precise). */
const SLACK_DAYS = 31;

const RESULT_WORDS =
  /\b(top-?line|primary (?:end ?point|outcome)s?|met (?:its|the|both|all)|achieved|positive (?:top-?line )?(?:results|data)|(?:results|data) from|statistically significant)\b/i;
// A sentence about starting or enrolling a trial is not its result.
const NOT_A_RESULT = /\b(initiat|enrol|first (?:patient|participant|subject)|dosed|begin|began|commence|completes? enrollment|design of)\w*/i;

/**
 * How the trial can be written in a release: its acronym or label name with
 * any spacing or hyphen between the parts ("SELECT-PsA 1", "SELECT PsA-1"),
 * not followed by another digit ("KEYNOTE-01" is not "KEYNOTE-012"), or its
 * NCT number.
 */
export function namePatterns(t: Pick<Trial, 'acronym' | 'labelName' | 'nctId'>): RegExp[] {
  const names = [t.acronym, t.labelName].filter((n): n is string => !!n && n.replace(/[^A-Za-z0-9]/g, '').length >= 4);
  const out = names.map((n) => {
    const parts = n.split(/[\s\-–]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(?<![A-Za-z0-9])${parts.join('[\\s\\-–]*')}(?![0-9])`, 'i');
  });
  if (t.nctId) out.push(new RegExp(`\\b${t.nctId}\\b`));
  return out;
}

// Longer than any real sentence: menu text or a table run together.
const MAX_SENTENCE = 600;

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z"“(])/))
    .map((s) => s.replace(/\s+/g, ' ').replace(/^[-–•·*]\s+/, '').trim())
    .filter((s) => s.length > 0 && s.length <= MAX_SENTENCE);
}

/** The sentence in the release that names the trial and reports a result, if there is one. */
export function resultSentence(release: Release, patterns: RegExp[]): string | undefined {
  const candidates = [release.title, ...sentences(release.text)];
  return candidates.find((s) => patterns.some((p) => p.test(s)) && RESULT_WORDS.test(s) && !(NOT_A_RESULT.test(s) && !/\bmet\b|top-?line|achieved/i.test(s)));
}

const MAX_QUOTE = 320;

export function pickReadout(
  trial: Trial,
  releases: Release[],
  window: { approvalDate?: string }
): Readout | undefined {
  const pc = trial.primaryCompletionDate;
  if (!pc) return undefined;
  const earliest = new Date(Date.parse(pc.value) - SLACK_DAYS * 86400000).toISOString().slice(0, 10);
  const patterns = namePatterns(trial);
  if (patterns.length === 0) return undefined;

  const hits = releases
    .filter((r) => r.date >= earliest && (!window.approvalDate || r.date <= window.approvalDate))
    .flatMap((r) => {
      const sentence = resultSentence(r, patterns);
      return sentence ? [{ r, sentence }] : [];
    })
    .sort((a, b) => a.r.date.localeCompare(b.r.date) || a.r.url.localeCompare(b.r.url));
  const first = hits[0];
  if (!first) return undefined;
  const quote = first.sentence.length > MAX_QUOTE ? first.sentence.slice(0, MAX_QUOTE - 1) + '…' : first.sentence;
  return {
    date: { value: first.r.date, precision: 'day' },
    provenance: {
      sourceUrl: first.r.url,
      sourceLabel: `${first.r.source}: ${first.r.title}`.slice(0, 200),
      quote,
      extractedBy: 'regex',
      verified: false,
    },
  };
}
