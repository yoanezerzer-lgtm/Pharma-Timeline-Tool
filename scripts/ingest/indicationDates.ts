import type { DateValue, Milestone, Provenance } from '../../src/schema/index.js';
import {
  cleanIndicationClause,
  extractIndicationList,
  extractUnnumberedIndication,
  flexibleNamePattern,
  legacyIndicationsText,
  sectionOneWindows,
} from './roles.js';
import { stripPageMarkers } from './docs.js';

export interface LabelDoc {
  submission: string;
  url: string;
  text: string;
}

interface IndicationApproval {
  date: DateValue;
  submission: string;
  provenance: Provenance;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'of', 'the', 'in', 'with', 'for', 'to', 'who', 'patients', 'adult', 'adults',
  'pediatric', 'years', 'year', 'older', 'aged', 'age', 'treatment', 'than', 'at', 'least',
]);

/**
 * The words that identify an indication, so a section renamed between label
 * versions still matches: "Head and Neck Cancer" and "Head and Neck Squamous
 * Cell Cancer", "Urothelial Carcinoma" and "Urothelial Cancer" (both seen on
 * Keytruda's labels). Population words and numbers are dropped for the same
 * reason — "GAD in adults" gained "and pediatric patients 7 years and older".
 */
export function keyWords(name: string): Set<string> {
  const words = name
    // Abbreviations in parentheses ("(MDD)") come and go between label versions.
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9]+/)
    .map((w) => SAME_WORD[w] ?? w)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return new Set(words);
}

// Words labels and letters use interchangeably for the same indication
// ("gastric … adenocarcinoma", "carcinoma of the esophagus").
const SAME_WORD: Record<string, string> = {
  carcinoma: 'cancer',
  carcinomas: 'cancer',
  adenocarcinoma: 'cancer',
  cancers: 'cancer',
  tumors: 'tumor',
  esophagus: 'esophageal',
  // Dupixent's label says "nasal polyps", its 2019 approval letter "nasal polyposis".
  polyp: 'polyps',
  polyposis: 'polyps',
};

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/** How far apart two names are; undefined when neither's key words contain the other's. */
function distance(a: Set<string>, b: Set<string>): number | undefined {
  if (a.size === 0 || b.size === 0) return undefined;
  if (!isSubset(a, b) && !isSubset(b, a)) return undefined;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return a.size + b.size - 2 * shared;
}

// A heading or prose that leaked into a name when the PDF text was garbled:
// "Cervical Cancer KEYTRUDA is", "Endometrial Carcinoma 5 WARNINGS".
const LEAK = /\s+(?:[A-Z]{4,}\b|\d+\s+[A-Z]{3,}).*$/;

interface Snapshot {
  doc: LabelDoc;
  milestone: Milestone;
  names: string[];
  /** Readable enough that an indication missing from it was really not yet approved. */
  complete: boolean;
  /** An old-format label's whole Indications section, searched rather than listed. */
  legacy: boolean;
}

function snapshot(doc: LabelDoc, milestone: Milestone, previousCompleteSize: number | undefined): Snapshot {
  const entries = extractIndicationList(doc.text);
  if (entries.length === 0) {
    const legacy = legacyIndicationsText(doc.text);
    if (legacy) return { doc, milestone, names: [legacy], complete: true, legacy: true };
  }
  // Only numbered lists: a single unnumbered indication sentence legitimately
  // carries gene names in capitals ("BRAF V600 mutation positive").
  const leaked = entries.length > 1 && entries.some((e) => LEAK.test(e.name));
  const names = entries.map((e) => e.name.replace(LEAK, '').trim()).filter((n) => n.length >= 3);
  const contiguous = entries.every((e, i) => e.number === i + 1);
  // A label only gains indications over time, bar the odd withdrawal, so one
  // listing far fewer than the last complete one is a truncated extraction.
  const plausibleSize = previousCompleteSize === undefined || names.length >= previousCompleteSize - 1;
  return { doc, milestone, names, complete: names.length > 0 && !leaked && contiguous && plausibleSize, legacy: false };
}

/**
 * Whether one label's own indication list includes this use: true or false
 * when the label can be read, undefined when it can't (nothing to go on).
 * Used to tell a use that was in the original approval from one a later
 * supplement added (Nemluvio's atopic dermatitis came after its first label).
 */
export function labelListsIndication(name: string, doc: LabelDoc): boolean | undefined {
  const target = keyWords(name);
  if (target.size === 0) return undefined;
  const entries = extractIndicationList(doc.text);
  if (entries.length > 0) {
    return entries.some((e) => {
      const d = distance(keyWords(e.name), target);
      return d !== undefined;
    });
  }
  const legacy = legacyIndicationsText(doc.text);
  return legacy ? isSubset(target, keyWords(legacy)) : undefined;
}

/**
 * Dates each indication by the supplement whose label first lists it — but
 * only when that's provable, and leaves it undated otherwise. A blank date is
 * honest; a wrong one isn't. Confirmed necessary against Keytruda's 100
 * labels, where trusting the first appearance alone got 8 of 21 wrong:
 *
 * - The label just before the first appearance must be complete and not list
 *   it. If that label is unreadable (several of Keytruda's "label" files are
 *   actually the 2014 original), the real adding supplement can't be seen.
 * - A label listing an indication that the next complete label drops but a
 *   later one lists again is a newer revision filed under an older
 *   supplement (Keytruda's SUPPL-79, April 2020, lists June 2020 approvals);
 *   it isn't evidence of anything at its own date.
 * - The adding supplement must be the original approval or an openFDA
 *   Efficacy supplement, the class that adds indications.
 * - Names match on their key words, so a renamed section still lines up; a
 *   label entry counts toward whichever indication it is closest to.
 */
export function dateIndications(
  names: string[],
  labels: LabelDoc[],
  milestones: Milestone[],
  letters: LabelDoc[] = []
): Map<string, IndicationApproval> {
  const milestoneFor = new Map(milestones.flatMap((m) => (m.submissionNumber ? [[m.submissionNumber, m]] : [])));
  const ordered = labels
    .map((doc) => ({ doc, milestone: milestoneFor.get(doc.submission) }))
    .filter((l): l is { doc: LabelDoc; milestone: Milestone } => l.milestone !== undefined)
    .sort((a, b) => a.milestone.date.value.localeCompare(b.milestone.date.value));

  const snapshots: Snapshot[] = [];
  let lastCompleteSize: number | undefined;
  for (const { doc, milestone } of ordered) {
    const s = snapshot(doc, milestone, lastCompleteSize);
    if (s.complete) lastCompleteSize = s.names.length;
    snapshots.push(s);
  }

  const targetWords = names.map(keyWords);
  /** Which of `names` a label entry refers to, if any — the closest match. */
  const resolve = (entry: string): number | undefined => {
    const words = keyWords(entry);
    let best: number | undefined;
    let bestDistance = Infinity;
    targetWords.forEach((t, i) => {
      const d = distance(words, t);
      if (d !== undefined && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return best;
  };
  const mentions = (text: string): number[] => {
    const words = keyWords(text);
    return targetWords.flatMap((t, i) => (t.size > 0 && isSubset(t, words) ? [i] : []));
  };
  const listed = snapshots.map(
    (s) =>
      new Set(
        s.legacy ? mentions(s.names[0]) : s.names.map(resolve).filter((i): i is number => i !== undefined)
      )
  );

  const completeIdx = snapshots.flatMap((s, i) => (s.complete ? [i] : []));
  const anachronistic = new Set<number>();
  completeIdx.forEach((i, k) => {
    const next = completeIdx[k + 1];
    if (next === undefined) return;
    for (const n of listed[i]) {
      if (listed[next].has(n)) continue;
      if (completeIdx.slice(k + 2).some((j) => listed[j].has(n))) anachronistic.add(i);
    }
  });

  const letterWords = new Map(letters.map((l) => [l.submission, keyWords(l.text)]));
  const addsIndications = (m: Milestone) => m.type === 'FDA_APPROVAL' || /efficacy/i.test(m.description ?? '');

  const out = new Map<string, IndicationApproval>();
  names.forEach((name, n) => {
    const first = snapshots.findIndex((_, i) => !anachronistic.has(i) && listed[i].has(n));
    if (first < 0) return;

    // The supplement that added it lies between the last complete label that
    // didn't list it and the first that does.
    let lastWithout = -1;
    for (let i = first - 1; i >= 0; i--) {
      if (snapshots[i].complete && !anachronistic.has(i)) {
        lastWithout = i;
        break;
      }
    }
    if (first > 0 && lastWithout < 0) return;
    const from = lastWithout < 0 ? snapshots[first].milestone.date.value : snapshots[lastWithout].milestone.date.value;
    const to = snapshots[first].milestone.date.value;

    // Approval letters say what each supplement approved and are never
    // refiled, so they pin the date when a label file is a different revision
    // than its supplement (Keytruda's May 18, 2017 urothelial supplements
    // carry a label without urothelial). Inclusive of `from`'s date for the
    // same reason. Earliest wins: an accelerated approval is the first
    // approval for that use.
    if (letterWords.size > 0) {
      const words = targetWords[n];
      const confirmed = milestones
        .filter((m) => m.submissionNumber && m.date.value >= from && m.date.value <= to && addsIndications(m))
        .filter((m) => {
          const lw = letterWords.get(m.submissionNumber!);
          return lw !== undefined && words.size > 0 && isSubset(words, lw);
        })
        .sort((a, b) => a.date.value.localeCompare(b.date.value));
      const pick = confirmed[0];
      // A letter may word the use more briefly than a long label sentence
      // (Ebglyss: "moderate to severe atopic dermatitis"). A use already listed in
      // the original approval's own label is dated by that approval, below.
      if (!pick && !(first === 0 && snapshots[0].milestone.type === 'FDA_APPROVAL')) return;
      if (pick) {
      const letter = letters.find((l) => l.submission === pick.submissionNumber)!;
      out.set(name, {
        date: pick.date,
        submission: pick.submissionNumber!,
        provenance: {
          sourceUrl: letter.url,
          sourceLabel: `Approval letter (${pick.submissionNumber})`,
          quote:
            `Named in the ${pick.submissionNumber} approval letter; first listed in the label ` +
            `on or before ${snapshots[first].doc.submission}, absent from the last complete label before it.`,
          extractedBy: 'rule',
          verified: false,
        },
      });
      return;
      }
    }

    // No letters to confirm with: only trust a first appearance that directly
    // follows a complete label without it.
    const { doc, milestone } = snapshots[first];
    if (first > 0 && lastWithout !== first - 1) return;
    if (!addsIndications(milestone)) return;
    out.set(name, {
      date: milestone.date,
      submission: doc.submission,
      provenance: {
        sourceUrl: doc.url,
        sourceLabel: `Approved label (${doc.submission})`,
        quote: `First listed in section 1 of the label approved with ${doc.submission}.`,
        extractedBy: 'rule',
        verified: false,
      },
    });
  });
  return out;
}

// A page footer or header the PDF put inside a sentence: not the FDA's wording.
const PAGE_FURNITURE = /Reference ID:|\bPage \d+ of \d+\b/i;

/**
 * The label's own sentence for one use, word for word after "is indicated"
 * (and the stock "for the treatment of", as for single-use labels): Dupixent's
 * "1.1 Atopic Dermatitis" reads "Adult and pediatric patients aged 6 months
 * and older with moderate-to-severe atopic dermatitis (AD) whose disease…".
 * Only when the subsection has exactly one "is indicated" sentence and it
 * isn't a bulleted list (Keytruda's subsections hold several uses each);
 * otherwise undefined, and the short heading stays.
 */
export function indicationWording(labelText: string, name: string): string | undefined {
  const windows = sectionOneWindows(stripPageMarkers(labelText));
  if (windows.length === 0) return undefined;
  const heading = new RegExp(`\\b1\\.\\s*\\d+\\s+${flexibleNamePattern(name)}\\b`, 'i');
  // The real section is the last copy; the table of contents only lists headings.
  for (const w of [...windows].reverse()) {
    const h = heading.exec(w);
    if (!h) continue;
    const rest = w.slice(h.index + h[0].length);
    const next = /\b1\.\s*\d+\s+[A-Z]/.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    const found = sentence(body);
    if (found !== null) return found;
  }
  // A label with one unnumbered use: its whole clause is already the wording (Dupixent's 2017 label).
  if (extractIndicationList(labelText).length === 1 && !/\b1\.\s*1\s+[A-Z]/.test(windows[windows.length - 1])) {
    const [only] = extractUnnumberedIndication(windows[windows.length - 1]);
    const target = keyWords(name);
    if (only && target.size > 0 && isSubset(target, keyWords(only.name)) && !PAGE_FURNITURE.test(only.name)) return only.name;
  }
  return undefined;
}

/** The one "is indicated" sentence in a subsection, cleaned; null when there isn't exactly one usable. */
function sentence(body: string): string | undefined | null {
  // "is not indicated" (a limitation of use) doesn't count.
  if ((body.match(/\bis\s+indicated\b/gi) ?? []).length !== 1) return null;
  const m = /\bis\s+indicated\s+([\s\S]*)/i.exec(body);
  if (!m) return null;
  const first = m[1].replace(/\s*\[see [^\]]*\]/gi, '').split(/\.(?!\d)/)[0];
  if (/[•:]/.test(first) || PAGE_FURNITURE.test(first)) return null;
  const clean = cleanIndicationClause(first);
  return clean.length >= 10 ? clean : null;
}
