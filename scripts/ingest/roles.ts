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
  const end = findSection14End(after);
  const section = end ? after.slice(0, end.index) : after;
  // A plausible section 14 is at least a few paragraphs; anything shorter
  // suggests the heading matched a table of contents entry instead.
  return section.length > 400 ? section : null;
}

/** Tolerates a period after the number ("14. CLINICAL STUDIES"), which some labels use. */
function findSection14Heading(strippedText: string): RegExpExecArray | null {
  return /\b14\.?\s+CLINICAL\s+STUDIES\b/i.exec(strippedText);
}

/**
 * Finds where section 14 ends: the next top-level PLR heading (15 REFERENCES,
 * 16 HOW SUPPLIED, 17 PATIENT COUNSELING, or occasionally an 18 appendix).
 *
 * Recognising the general shape — a section number followed by an ALL-CAPS
 * title — rather than two fixed title strings is what makes this hold up on a
 * label whose later sections are titled slightly differently, or that skips
 * a References section and jumps straight to 16 or 17. Missing this boundary
 * is the more dangerous failure: the captured "section 14" then runs into
 * later content (postmarketing commitments, references) and can attribute
 * trials named there to the approved evidence base. Requiring a genuinely
 * capitalised run of 6+ characters keeps incidental digits in body text
 * ("15 mg once daily") from being mistaken for a heading.
 */
function findSection14End(afterHeading: string): RegExpExecArray | null {
  return /\b1[5-8]\.?\s+[A-Z][A-Z0-9 ,/-]{5,70}\b/.exec(afterHeading);
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
  /** The applicant's name, e.g. "AbbVie Inc.", for the sponsor-match guard below. */
  sponsorName?: string;
  /** NCT ID -> generic names the label uses for it. See extractTrialAliases(). */
  trialAliases?: Map<string, string[]>;
}

/**
 * Finds "Trial <name> (NCT........)" / "Study <name> (NCT........)" pairings
 * anywhere in the document corpus.
 *
 * A label that has accumulated indications over years of supplements often
 * stops naming historical trials by their original sponsor protocol number or
 * acronym and switches to a generic scheme instead — "Trial RA-I," "Trial
 * RA-II" — that appears nowhere in the registry record. That generic name is
 * still paired with the real NCT number somewhere in the FDA paperwork
 * (typically the review), even when the label's own section 14 text never
 * repeats the NCT number itself. Extracting that pairing wherever it occurs
 * is what lets classifyRole recognise the generic name later, including
 * inside the label's own text where the "real" identifiers never appear.
 */
export function extractTrialAliases(text: string): Map<string, string[]> {
  const stripped = stripPageMarkers(text);
  const pattern = /\b(?:Trial|Study)\s+([A-Za-z][A-Za-z0-9-]{0,20})\s*\(\s*(NCT\d{8})\s*\)/g;
  const aliases = new Map<string, string[]>();
  for (const m of stripped.matchAll(pattern)) {
    const [, name, nctId] = m;
    const list = aliases.get(nctId) ?? [];
    if (!list.includes(name)) list.push(name);
    aliases.set(nctId, list);
  }
  return aliases;
}

function identifiersOf(trial: Trial, aliases: Map<string, string[]> | undefined): string[] {
  const base = [trial.nctId, trial.protocolNumber, trial.acronym].filter(
    (s): s is string => !!s
  );
  const extra = trial.nctId ? aliases?.get(trial.nctId) ?? [] : [];
  return [...base, ...extra];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when any needle appears in the haystack as a whole word/token, not
 * merely as a substring.
 *
 * A plain `.includes()` check is unsafe for trial acronyms: several real
 * AbbVie post-marketing studies are literally acronymed "UPDATE" and "ACUTE"
 * — ordinary English words that appear constantly in unrelated prose (any
 * mention of "an update to labeling" or "acute exacerbation" would otherwise
 * match). Word-boundary matching fixes that. A short acronym like a two-letter
 * disease abbreviation ("CD" for Crohn's disease) can still collide at a true
 * word boundary — that residual risk is why classifyRole additionally
 * requires a document citation or a sponsor/study-type match before trusting
 * a section 14 mention with no citation behind it.
 */
function mentions(haystack: string, needles: string[]): boolean {
  return needles.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(haystack));
}

const CORPORATE_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|sa)\b/g;

function normalizeSponsor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(CORPORATE_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A cheap, real-world check learned directly from manual review: a trial that
 * actually supported this application is the applicant's own registrational
 * study, which is definitionally interventional. A different company's
 * observational registry, or an academic investigator-initiated study, is
 * never that evidence — even when it studies the same drug and its NCT number
 * happens to turn up inside the text captured as "section 14."
 *
 * Missing data (no sponsor recorded, no sponsor name to compare against) is
 * treated as inconclusive rather than disqualifying — this guards against a
 * specific, observed failure mode, not a general trust requirement.
 */
function looksLikeSponsorTrial(trial: Trial, sponsorName: string | undefined): boolean {
  if (trial.studyType && trial.studyType.toUpperCase() === 'OBSERVATIONAL') return false;
  if (!sponsorName || !trial.sponsor) return true;
  const a = normalizeSponsor(trial.sponsor);
  const b = normalizeSponsor(sponsorName);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

export interface RoleAssignment {
  role: TrialRole;
  provenance: Provenance;
}

export function classifyRole(trial: Trial, ctx: RoleContext): RoleAssignment {
  const knownAliases = trial.nctId ? ctx.trialAliases?.get(trial.nctId) ?? [] : [];
  const ids = identifiersOf(trial, ctx.trialAliases);
  const matchedAlias = knownAliases.find((a) => mentions(ctx.labelSection14 ?? '', [a]));
  const namedInSection14 =
    !!ctx.labelSection14 && ids.length > 0 && mentions(ctx.labelSection14, ids);

  if (namedInSection14) {
    // `citedIn` only proves the identifier's string appears *somewhere* in the
    // FDA paperwork (it's populated by a document-wide scan, not one scoped to
    // section 14) — it does not by itself prove the specific occurrence inside
    // the captured section 14 span is genuine. extractLabelSection14's end
    // boundary can still run past the real section 14 on an unusual label, so
    // a bare mention there — cited elsewhere or not — always needs the trial
    // to actually look like the applicant's own study before it's trusted.
    if (looksLikeSponsorTrial(trial, ctx.sponsorName)) {
      return {
        role: 'PIVOTAL',
        provenance: {
          sourceUrl: ctx.labelUrl,
          sourceLabel: 'Approved label, section 14 (Clinical Studies)',
          extractedBy: 'rule',
          verified: false,
          quote: matchedAlias
            ? `The label refers to this trial as "${matchedAlias}" rather than by its ` +
              'registered identifiers; that name was resolved from a pairing found ' +
              'elsewhere in the FDA paperwork. Sponsor-run and interventional.'
            : 'Trial identifier appears within the captured section 14 span, and ' +
              'the trial is sponsor-run and interventional.',
        },
      };
    }
    // Named in the captured span but not the applicant's own interventional
    // trial and no direct citation — falls through rather than being trusted.
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
