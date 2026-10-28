import type { Approval, IndicationRole, Milestone, Trial } from '../../src/schema/index.js';
import { keyWords, type LabelDoc } from './indicationDates.js';

/**
 * Each indication's approval history, read from the FDA approval letters.
 *
 * An indication as the label groups it (Keytruda's "Melanoma") is often
 * several approvals: the 2014 approval for unresectable or metastatic
 * melanoma, the 2019 approval for adjuvant treatment after lymph node
 * involvement, the 2021 one for stage IIB or IIC. Each has its own letter,
 * which is never refiled and opens with one paragraph saying what was
 * approved, in the FDA's words. That paragraph is the source here: its
 * date, its submission number and its exact wording.
 */

/** The letter's opening paragraph about this application, up to the APPROVAL & LABELING heading. */
export function letterPurpose(text: string): string | undefined {
  const t = text.replace(/<<<PAGE \d+>>>/g, ' ').replace(/\s+/g, ' ');
  // The opening section: from the salutation to the first heading after it.
  // No salutation or opening reference means the first page didn't extract
  // (a scanned image); guessing from later pages would quote the wrong section.
  const dear = t.search(/\bDear\b/);
  const from = dear >= 0 ? dear : t.search(/\bPlease refer to your\b/i);
  if (from < 0) return undefined;
  const after = t.slice(from);
  const stop = after.search(/APPROVAL\s*&\s*LABELING|\bLICENSING\b|We have completed (?:our|the) review|We have approved your/i);
  const opening = after.slice(0, stop > 0 ? stop : 3000);
  const sentences = opening.split(/(?<=[.:])\s+(?=[A-Z])/);
  const k = sentences.findIndex(
    (x) =>
      !/^(?:Dear|Please refer|We (?:also )?refer|This (?:replacement|corrected)|We acknowledge)/i.test(x) &&
      !/\b(?:corrected|correction of the error|contained the following error)\b/i.test(x) &&
      /\b(?:provides?|provide|adds?|proposes?|revises?|updates?|establish\w*|expands?)\b/i.test(x)
  );
  if (k >= 0) return sentences.slice(k).join(' ').trim().slice(0, 1500);
  // Older letters state it later: "...provides for the use of Lexapro for generalized anxiety disorder."
  const older = t.slice(0, 5000).match(/[^.]*\bprovides? for (?:the )?(?:use|treatment|new indication|addition)[^.]*\./i);
  if (older) return older[0].trim();
  // Original biologics letters state the use under LICENSING: "Skyrizi is indicated for the treatment of...".
  const licensed = t.slice(0, 6000).match(/\bLICENSING\b[\s\S]*?([A-Z][^.]*\bis indicated (?:for|as)\b[^.]*\.)/);
  return licensed ? licensed[1].trim() : undefined;
}

/** What the letter approved: a new indication, a wider one, a revised one, a conversion to regular approval, or a labeling update only. */
export function approvalKind(purpose: string): Approval['kind'] | 'update' {
  if (/\bconver(?:t|sion|ted)\b/i.test(purpose)) return 'conversion';
  if (/new indication|addition of (?:a |the |an )?(?:new )?indication|addition of (?:a )?new|adds? (?:a )?new/i.test(purpose)) return 'new';
  // A changed indication could be wider or narrower; the letter's wording alone doesn't say which.
  if (/\brevis\w* (?:the )?(?:following )?indications?\b|modif\w* (?:of|to) the (?:approved )?indication/i.test(purpose)) return 'revision';
  if (/expan|extend|extension|provides for the use of|priority approval|is indicated/i.test(purpose)) {
    return 'expansion';
  }
  return 'update';
}

/** The letter's first sentence about this application, as written. */
export function approvalStatement(purpose: string): string {
  const m = purpose.match(/^[\s\S]*?\.(?=\s+[A-Z]|\s*$)/);
  const s = (m ? m[0] : purpose).trim();
  // "...adding the following new indication:" carries the wording after the colon.
  if (/:\s*$/.test(s) || s.length < 60) return purpose.slice(0, 600).trim();
  return s.length > 600 ? s.slice(0, 599) + '…' : s;
}

/**
 * Abbreviations FDA letters use for a disease the label spells out, so a
 * letter about "metastatic NSCLC" matches the label's "Non-Small Cell Lung
 * Cancer". Case-sensitive: "cHL" is a disease, "chl" is not. Two-letter
 * forms that are also ordinary capitalised words in letters ("AS SOON AS",
 * "CD" for compact disc in old templates) are left out.
 */
const ABBREVIATIONS: Record<string, string> = {
  NSCLC: 'non-small cell lung cancer',
  SCLC: 'small cell lung cancer',
  HNSCC: 'head and neck squamous cell cancer',
  cHL: 'classical hodgkin lymphoma',
  PMBCL: 'primary mediastinal large b-cell lymphoma',
  RCC: 'renal cell carcinoma',
  HCC: 'hepatocellular carcinoma',
  TNBC: 'triple-negative breast cancer',
  'MSI-H': 'microsatellite instability-high',
  dMMR: 'mismatch repair deficient',
  'TMB-H': 'tumor mutational burden-high',
  cSCC: 'cutaneous squamous cell carcinoma',
  MCC: 'merkel cell carcinoma',
  UC: 'urothelial carcinoma',
  BTC: 'biliary tract cancer',
  MPM: 'malignant pleural mesothelioma',
  CRC: 'colorectal cancer',
  ESCC: 'esophageal squamous cell carcinoma',
  GEJ: 'gastroesophageal junction',
  RA: 'rheumatoid arthritis',
  PsA: 'psoriatic arthritis',
  GCA: 'giant cell arteritis',
  MDD: 'major depressive disorder',
  GAD: 'generalized anxiety disorder',
};

function expandAbbreviations(s: string): string {
  return s.replace(/\b[A-Za-z]{2,5}(?:-[A-Z])?\b/g, (m) => (ABBREVIATIONS[m] ? `${m} ${ABBREVIATIONS[m]}` : m));
}

/** A clause excluding a population ("that is not MSI-H or dMMR") doesn't make it this approval's disease. */
function withoutExclusions(s: string): string {
  return s
    .replace(/\b(?:that|which|who) (?:is|are|have|has|do|does) not\b[^,;.:]*/gi, ' ')
    .replace(/\bnot (?:MSI-H|dMMR|microsatellite)[^,;.:]*/gi, ' ');
}

/** Whether the letter's paragraph is about this indication: every key word of its name appears in it. */
function purposeMatches(purpose: string, indicationName: string): boolean {
  const want = keyWords(indicationName);
  if (want.size === 0) return false;
  const have = keyWords(expandAbbreviations(withoutExclusions(purpose)));
  for (const w of want) if (!have.has(w)) return false;
  return true;
}

/**
 * Each indication's approvals: every original-approval or efficacy letter
 * whose opening paragraph grants, widens or converts a use for that disease.
 * Labeling-only updates (adding a survival analysis) aren't approvals of a
 * use, so they're left out.
 */
export function approvalsByIndication(
  indicationNames: string[],
  letters: LabelDoc[],
  milestones: Milestone[],
  /** The submission each indication is already dated by (see dateIndications), always part of its history. */
  datedBy: Map<string, string> = new Map()
): Map<string, Approval[]> {
  const milestoneFor = new Map(milestones.flatMap((m) => (m.submissionNumber ? [[m.submissionNumber, m]] : [])));
  const parsed = letters
    .flatMap((l) => {
      const m = milestoneFor.get(l.submission);
      const read = letterPurpose(l.text);
      // A scan read badly ("u·eatment") isn't the FDA's wording; treat it as unreadable.
      const purpose = read && !/\w[·¬�]\w/.test(read) ? read : undefined;
      if (!m) return [];
      // An original approval letter that doesn't restate the use ("We have
      // approved your BLA for Skyrizi") still approved it; the label carries
      // the wording (see indicationsWithHistory).
      // The same holds for the letter that dates an indication but whose first page didn't extract.
      const dated = [...datedBy.values()].includes(l.submission);
      if (!purpose) return m.type === 'FDA_APPROVAL' || dated ? [{ letter: l, milestone: m, purpose: '', kind: 'new' as const }] : [];
      const isEfficacy = m.type === 'FDA_APPROVAL' || /efficacy/i.test(m.description ?? '');
      // An original approval is the drug's first use, whatever the letter's wording.
      // Judged on the letter's first sentence about the application; later ones may describe other changes.
      const first = approvalKind(approvalStatement(purpose));
      const kind = m.type === 'FDA_APPROVAL' ? 'new' : first !== 'update' ? first : approvalKind(purpose);
      if (!isEfficacy && !dated) return [];
      return [{ letter: l, milestone: m, purpose, kind }];
    })
    .sort((a, b) => a.milestone.date.value.localeCompare(b.milestone.date.value));

  const out = new Map<string, Approval[]>();
  for (const name of indicationNames) {
    out.set(
      name,
      parsed
        .flatMap((p) => {
          // The letter that dates this indication approved it, whatever its
          // wording; for any other indication it must read as an approval of that use.
          const datesThis = datedBy.get(name) === p.letter.submission;
          const kind: Approval['kind'] | 'update' = datesThis && p.kind === 'update' ? 'new' : p.kind;
          if (kind === 'update') return [];
          if (!datesThis && !(p.purpose && purposeMatches(p.purpose, name))) return [];
          return [{ ...p, kind }];
        })
        .map((p) => {
          // No purpose sentence (an original letter): the indication's name is the label's own wording for it.
          const statement = p.purpose ? approvalStatement(p.purpose) : name;
          return {
            submission: p.letter.submission,
            date: p.milestone.date,
            kind: p.kind,
            statement,
            provenance: {
              sourceUrl: p.letter.url,
              sourceLabel: p.purpose ? `Approval letter (${p.letter.submission})` : `Approval letter (${p.letter.submission}); wording from the label's section 1`,
              quote: statement,
              extractedBy: 'regex' as const,
              verified: false,
            },
          };
        })
    );
  }
  return out;
}

const norm = (s: string) => s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').toLowerCase();

/**
 * The approval a pivotal trial supported, when the letter says so itself:
 * the trial is named in the opening paragraph of exactly one of its
 * indication's approval letters. Names in a letter's later sections don't
 * count; those list the studies the FDA requires next, not the evidence.
 * Returns the link with the sentence that names the trial as its quote.
 */
export function approvalNamingTrial(
  trial: Pick<Trial, 'acronym' | 'labelName' | 'nctId'>,
  approvals: Approval[],
  letters: LabelDoc[]
): IndicationRole['approval'] {
  const ids = [trial.acronym, trial.labelName, trial.nctId]
    .filter((x): x is string => !!x && x.replace(/[^A-Za-z0-9]/g, '').length >= 5)
    .map(norm);
  if (ids.length === 0) return undefined;
  const hits = approvals.flatMap((a) => {
    const letter = letters.find((l) => l.submission === a.submission);
    const purpose = letter && letterPurpose(letter.text);
    if (!letter || !purpose) return [];
    const sentence = purpose.split(/(?<=\.)\s+(?=[A-Z])/).find((x) => ids.some((id) => norm(x).includes(id)));
    return sentence ? [{ a, letter, sentence }] : [];
  });
  if (hits.length !== 1) return undefined;
  const { a, letter, sentence } = hits[0];
  return {
    submission: a.submission,
    provenance: {
      sourceUrl: letter.url,
      sourceLabel: `Approval letter (${a.submission})`,
      quote: sentence.length > 500 ? sentence.slice(0, 499) + '…' : sentence,
      extractedBy: 'rule',
      verified: false,
    },
  };
}

/**
 * Whether every efficacy approval from an indication's first one onward has
 * a letter that was read. Only then can "this indication has one approval"
 * be trusted: an unread letter could be a second one.
 */
export function historyComplete(first: string | undefined, letters: LabelDoc[], milestones: Milestone[]): boolean {
  if (!first) return false;
  const read = new Set(letters.filter((l) => letterPurpose(l.text)).map((l) => l.submission));
  return milestones
    .filter((m) => (m.type === 'FDA_APPROVAL' || /efficacy/i.test(m.description ?? '')) && m.date.value >= first)
    .every((m) => !m.submissionNumber || read.has(m.submissionNumber));
}

/**
 * Each pivotal role linked to its approval: where a letter names the trial,
 * or where the indication has had exactly one approval and every later
 * efficacy letter was read, so there's no other approval it could be.
 */
export function linkRolesToApprovals(
  trials: Trial[],
  history: Map<string, Approval[]>,
  letters: LabelDoc[],
  completeFor: Set<string> = new Set()
): Trial[] {
  return trials.map((t) => {
    let changed = false;
    const roles = t.roles.map((r) => {
      if (r.role !== 'PIVOTAL' || !r.indication || r.approval) return r;
      const own = history.get(r.indication) ?? [];
      const sole = own.length === 1 && completeFor.has(r.indication) ? own[0] : undefined;
      const link =
        approvalNamingTrial(t, own, letters) ??
        (sole && {
          submission: sole.submission,
          provenance: {
            sourceUrl: sole.provenance.sourceUrl,
            sourceLabel: `Approval letter (${sole.submission}): the only approval of this indication`,
            quote: sole.statement,
            extractedBy: 'rule' as const,
            verified: false,
          },
        });
      if (!link) return r;
      changed = true;
      return { ...r, approval: link };
    });
    return changed ? { ...t, roles } : t;
  });
}
