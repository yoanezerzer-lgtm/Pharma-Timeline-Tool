import type { DateValue, Provenance, Trial } from '../../src/schema/index.js';

/**
 * Picks a trial's readout: the first public announcement of its primary
 * result, from press releases and SEC filings already fetched. Pure, so the
 * rule is tested without a network.
 *
 * The quote must state the result ("met its co-primary endpoints",
 * "statistically significantly higher than placebo"). A page title, a
 * "positive top-line results" headline or a description of the endpoints is
 * not a result: when a release has no such sentence, nothing is recorded.
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

interface Readout {
  date: DateValue;
  provenance: Provenance;
}

/** Days before primary completion a release may fall and still count (dates are often month-precise). */
const SLACK_DAYS = 31;

type Names = Pick<Trial, 'acronym' | 'labelName' | 'nctId'>;

const PRIMARY = /\bprimary\b/i;
/**
 * Words that say how an endpoint came out, not merely that results exist:
 * "met", "did not meet", "statistically significantly higher".
 */
const OUTCOME =
  /\b(?:met|meets|achieved|achieves|did not (?:meet|achieve)|failed to (?:meet|achieve)|missed)\b|\bstatistically significant(?:ly)?\b|\bsignificantly (?:higher|lower|greater|improved|reduced|better|superior)\b|\bnon-?inferiority (?:was )?(?:demonstrated|shown|established)\b|\bdemonstrated (?:non-?inferiority|superiority)\b/i;
/** A figure with its test: "p<0.001", "p less than 0.0001", "hazard ratio 0.62". */
const STATISTIC = /\bp\s*(?:[<=≤]|less than|value)\s*[0-9.]|\bhazard ratio\b|\bHR\s*[=:]?\s*0?\.\d/i;
const COMPARED = /\b(?:placebo|versus|vs\.?|compared (?:to|with)|comparator)\b/i;
/**
 * A description of the endpoints or the design is not their result:
 * "The co-primary endpoints in JADE MONO-2 were the proportion of patients
 * who achieved…".
 */
const DESCRIPTION =
  /\bendpoints?(?:\s+(?:in|of|for)\s+[^,;]{1,40}?)?\s+(?:was|were|is|are|include[sd]?|will be|being)\s+(?!met\b|achieved\b|not\b|statistically\b|also\b)|\b(?:designed to|to evaluate|to assess|if|whether|expected to|anticipated)\b/i;
// A sentence about starting or enrolling a trial is not its result.
const NOT_A_RESULT = /\b(?:initiat|enrol|first (?:patient|participant|subject)|dosed|begin|began|commence|completes? enrollment|design of)\w*/i;
/** "Consistent with JADE MONO-1, results showed…": the name is a comparison, not the subject. */
const REFERENCE = /\b(?:consistent with|similar to|like|as (?:seen|observed|reported) in|following|previously (?:reported|announced) (?:in|from|for))\s+(?:the\s+)?(?:\S+\s+){0,2}$/i;
/** "both pivotal Phase 3 trials … met": a result for every trial the release names. */
const PLURAL = /\b(?:both|two|all|each of the)\b(?:\s+[\w-]+){0,4}\s+(?:trials|studies)\b/i;

/**
 * How the trial can be written in a release: its acronym or label name with
 * any spacing or hyphen between the parts ("SELECT-PsA 1", "SELECT PsA-1"),
 * not followed by more of a word or another number ("KEYNOTE-01" is not
 * "KEYNOTE-012", "MARIPOSA" is not "MARIPOSA-2"), or its NCT number.
 */
const ALL_CAPS_WORD = /^[A-Z]+$/;

export function namePatterns(t: Names): RegExp[] {
  const names = [t.acronym, t.labelName].filter((n): n is string => !!n && n.replace(/[^A-Za-z0-9]/g, '').length >= 4);
  const out = names.map((n) => {
    const parts = n.split(/[\s\-–]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // A one-word capitals acronym is often an English word too ("VENTURE",
    // "DISCOVER"): match it only in capitals, as releases write it.
    return new RegExp(`(?<![A-Za-z0-9])${parts.join('[\\s\\-–]*')}(?![A-Za-z0-9])(?!\\s*[\\-–]\\s*[0-9])`, ALL_CAPS_WORD.test(n) ? '' : 'i');
  });
  if (t.nctId) out.push(new RegExp(`\\b${t.nctId}\\b`));
  return out;
}

// Longer than any real sentence: menu text or a table run together.
const MAX_SENTENCE = 600;

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])(?<!\b(?:Inc|Ltd|Co|Corp|Dr|No|vs|Jr|Sr|St)\.)\s+(?=[A-Z"“(])/))
    .map((s) => s.replace(/\s+/g, ' ').replace(/^[-–•·*]\s+/, '').trim())
    .filter((s) => s.length > 0 && s.length <= MAX_SENTENCE);
}

/** Whether the sentence names the trial as its subject, not only in passing ("consistent with X"). */
function namesAsSubject(s: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => [...s.matchAll(new RegExp(p.source, p.flags + 'g'))].some((m) => !REFERENCE.test(s.slice(0, m.index))));
}

const names = (s: string, patterns: RegExp[]) => patterns.some((p) => p.test(s));

/** How the sentence reports the primary result: 2 says so outright, 1 gives a test against the comparator, 0 not at all. */
function resultStrength(s: string): 0 | 1 | 2 {
  if (DESCRIPTION.test(s)) return 0;
  if (NOT_A_RESULT.test(s) && !/\bmet\b|\bachieved\b/i.test(s)) return 0;
  if (PRIMARY.test(s) && OUTCOME.test(s)) return 2;
  if (STATISTIC.test(s) && COMPARED.test(s) && !/\bsecondary\b/i.test(s)) return 1;
  return 0;
}

/**
 * The sentence in the release that reports the trial's primary result, if
 * there is one. Releases often name the trial in one sentence and give the
 * result in the next ("…results from the Phase 3 JADE TEEN study. Both doses
 * met the co-primary endpoints."), so the subject carries over from the last
 * trial named, until a sister trial is named instead.
 */
function resultSentence(release: Release, patterns: RegExp[], sisters: RegExp[]): string | undefined {
  const all = sentences(release.text);
  if (!all.some((s) => names(s, patterns))) return undefined;
  const namesSister = all.some((s) => names(s, sisters));

  // Which trial each sentence is about: true (this one), false (a sister), null (none named yet).
  let subject: boolean | null = null;
  const found: { s: string; strength: number; mine: boolean }[] = [];
  for (const s of all) {
    const mine = namesAsSubject(s, patterns);
    const theirs = namesAsSubject(s, sisters);
    if (mine) subject = true;
    else if (theirs) subject = false;
    const about = mine || (!theirs && subject === true) || (subject === null && (PLURAL.test(s) || !namesSister));
    if (!about) continue;
    const strength = resultStrength(s);
    // A test result alone must name the trial itself: it may be any endpoint.
    if (strength === 2 || (strength === 1 && mine)) found.push({ s, strength, mine });
  }
  // Best: says the result outright and names the trial; then says it outright; then a test result.
  return (found.find((f) => f.strength === 2 && f.mine) ?? found.find((f) => f.strength === 2) ?? found[0])?.s;
}

/**
 * A sister's name only moves the subject when it reads as a trial's name:
 * with a number ("SINUS-52", "QWINT-4") or in capitals ("CHRONOS"). Records
 * also carry disease or drug words as acronyms ("CRSwNP"), which every
 * release repeats.
 */
function trialLike(n: string | undefined): string | undefined {
  return n && (/\d/.test(n) || /^[A-Z][A-Z\s\-–]+$/.test(n)) ? n : undefined;
}

const MAX_QUOTE = 320;

/**
 * @param sisters the drug's other trials: naming one moves a release's
 *   subject away from this trial.
 */
export function pickReadout(
  trial: Trial,
  releases: Release[],
  window: { approvalDate?: string },
  sisters: Names[] = []
): Readout | undefined {
  const pc = trial.primaryCompletionDate;
  if (!pc) return undefined;
  const earliest = new Date(Date.parse(pc.value) - SLACK_DAYS * 86400000).toISOString().slice(0, 10);
  const patterns = namePatterns(trial);
  if (patterns.length === 0) return undefined;
  const own = new Set(patterns.map((p) => p.source));
  const sisterPatterns = sisters
    .map((o) => ({ ...o, acronym: trialLike(o.acronym), labelName: trialLike(o.labelName) }))
    .flatMap(namePatterns)
    .filter((p) => !own.has(p.source));

  const hits = releases
    .filter((r) => r.date >= earliest && (!window.approvalDate || r.date <= window.approvalDate))
    .flatMap((r) => {
      const sentence = resultSentence(r, patterns, sisterPatterns);
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
