import type { Trial, TrialRole, Provenance } from '../../src/schema/index.js';
import { stripPageMarkers, pageForOffset } from './docs.js';

/**
 * Assigns each trial its part in the marketing application, using rules rather
 * than inference.
 *
 * The strongest signal is structural: section 14 of the approved label
 * ("Clinical Studies") describes only the trials that support the approved
 * indication. A trial named there was part of the evidence base, full stop —
 * that is a fact about the document, not a judgement about the trial.
 *
 * Everything else is a weaker heuristic and is marked unverified so a person
 * can correct it.
 */

/**
 * Extracts section 14 from a drug label's text.
 *
 * Labels follow the Physician Labeling Rule numbering, so section 14 runs from
 * its heading to the start of section 15 or 16. Returns null when the headings
 * cannot be located, rather than guessing at a span.
 */
export function extractLabelSection14(labelText: string): string | null {
  const text = stripPageMarkers(labelText);
  const start = findSection14Heading(text);
  if (!start) return null;
  const after = text.slice(start.index);
  const end = /\b1[56]\.?\s+(REFERENCES|HOW\s+SUPPLIED)\b/i.exec(after);
  const section = end ? after.slice(0, end.index) : after;
  // A plausible section 14 is at least a few paragraphs; anything shorter
  // suggests the heading matched a table of contents entry instead.
  return section.length > 400 ? section : null;
}

/** Tolerates a period after the number ("14. CLINICAL STUDIES"), which some labels use. */
function findSection14Heading(strippedText: string): RegExpExecArray | null {
  return /\b14\.?\s+CLINICAL\s+STUDIES\b/i.exec(strippedText);
}

export interface Section14Diagnostics {
  /** True if "CLINICAL STUDIES" appears anywhere, even without the numbered heading. */
  phrasePresent: boolean;
  page?: number;
  /** Text around the first occurrence, so a failed run's log shows what was actually extracted. */
  snippet?: string;
}

/**
 * Explains why the numbered heading could not be located.
 *
 * Not used for classification — a loose match here is not trustworthy enough
 * to base a pivotal determination on. It exists purely so a run that fails to
 * find section 14 leaves behind something more useful than "not found": either
 * the phrase never appears (the wrong document, or a badly extracted one), or
 * it appears but not as a numbered heading (a different label structure worth
 * looking at directly).
 */
export function diagnoseSection14(labelText: string): Section14Diagnostics {
  const stripped = stripPageMarkers(labelText);
  const phrase = /CLINICAL\s+STUDIES/i.exec(stripped);
  if (!phrase) return { phrasePresent: false };

  // Best-effort page lookup against the marker-containing text; approximate
  // is fine since this is a diagnostic, not a citation.
  const rawPhrase = /CLINICAL\s+STUDIES/i.exec(labelText);
  const page = rawPhrase ? pageForOffset(labelText, rawPhrase.index) : undefined;

  return {
    phrasePresent: true,
    page,
    snippet: stripped.slice(Math.max(0, phrase.index - 60), phrase.index + 100).trim(),
  };
}

export interface RoleContext {
  /** Section 14 of the label, when it could be located. */
  labelSection14: string | null;
  /** Full text of the medical/statistical reviews. */
  reviewText: string;
  labelUrl?: string;
  reviewUrl?: string;
}

function identifiersOf(trial: Trial): string[] {
  return [trial.nctId, trial.protocolNumber, trial.acronym].filter(
    (s): s is string => !!s
  );
}

function mentions(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

export interface RoleAssignment {
  role: TrialRole;
  provenance: Provenance;
}

export function classifyRole(trial: Trial, ctx: RoleContext): RoleAssignment {
  const ids = identifiersOf(trial);

  // 1. Named in label section 14 → part of the approved evidence base.
  if (ctx.labelSection14 && ids.length > 0 && mentions(ctx.labelSection14, ids)) {
    return {
      role: 'PIVOTAL',
      provenance: {
        sourceUrl: ctx.labelUrl,
        sourceLabel: 'Approved label, section 14 (Clinical Studies)',
        extractedBy: 'rule',
        verified: false,
        quote: 'Trial identifier appears in section 14 of the approved label.',
      },
    };
  }

  // 2. Cited in the review but not in section 14 → supporting evidence.
  const inReview = ids.length > 0 && mentions(ctx.reviewText, ids);
  if (inReview) {
    const byPhase: Partial<Record<Trial['phase'], TrialRole>> = {
      EARLY_PHASE1: 'PK',
      PHASE1: 'PK',
      PHASE1_2: 'DOSE_FINDING',
      PHASE2: 'DOSE_FINDING',
      PHASE2_3: 'SUPPORTIVE',
      PHASE3: 'SUPPORTIVE',
      PHASE4: 'POST_MARKETING',
    };
    return {
      role: byPhase[trial.phase] ?? 'SUPPORTIVE',
      provenance: {
        sourceUrl: ctx.reviewUrl,
        sourceLabel: 'FDA review (cited, not in label section 14)',
        extractedBy: 'rule',
        verified: false,
      },
    };
  }

  // 3. Registered against the drug but never cited in the approval package.
  return {
    role: 'NOT_IN_FILING',
    provenance: {
      sourceLabel: 'Registered on ClinicalTrials.gov; not cited in the approval package',
      extractedBy: 'rule',
      verified: false,
    },
  };
}

export function applyRoles(trials: Trial[], ctx: RoleContext): Trial[] {
  return trials.map((t) => {
    const { role, provenance } = classifyRole(t, ctx);
    return { ...t, role, provenance: { ...t.provenance, role: provenance } };
  });
}
