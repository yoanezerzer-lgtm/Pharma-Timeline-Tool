import type { Trial, TrialRole, Provenance } from '../../src/schema/index.js';
import { stripPageMarkers } from './docs.js';

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
  const start = /\b14\s+CLINICAL\s+STUDIES\b/i.exec(text);
  if (!start) return null;
  const after = text.slice(start.index);
  const end = /\b1[56]\s+(REFERENCES|HOW\s+SUPPLIED)\b/i.exec(after);
  const section = end ? after.slice(0, end.index) : after;
  // A plausible section 14 is at least a few paragraphs; anything shorter
  // suggests the heading matched a table of contents entry instead.
  return section.length > 400 ? section : null;
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
