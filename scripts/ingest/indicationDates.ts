import type { DateValue, Milestone, Provenance } from '../../src/schema/index.js';
import { extractIndicationList, legacyIndicationsText } from './roles.js';

export interface LabelDoc {
  submission: string;
  url: string;
  text: string;
}

export interface IndicationApproval {
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
function keyWords(name: string): Set<string> {
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
      if (!pick) return;
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
