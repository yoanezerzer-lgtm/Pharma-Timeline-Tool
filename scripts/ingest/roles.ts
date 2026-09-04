import type { Trial, TrialRole, IndicationRole } from '../../src/schema/index.js';
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

/**
 * Tolerates a period after the number ("14. CLINICAL STUDIES"), which some
 * labels use.
 *
 * Returns the *last* match, not the first. A label's table of contents lists
 * every heading up front, often as one run of jumbled, interleaved
 * multi-column text — confirmed against a real Rinvoq label, whose extracted
 * ToC ends in the literal string "14 CLINICAL STUDIES" immediately followed
 * by "Reference ID: ..." and the start of the actual document body, not of
 * section 14. Anchoring on the first match latches onto that ToC line and
 * then reads everything from there — sections 1 through 13 included — as if
 * it were section 14, discarding the real section entirely (and, if a
 * false end-of-section match turns up in that discarded stretch, truncating
 * the span before ever reaching the real content). The heading's own
 * appearance at the start of the actual section always comes later in
 * reading order than any ToC mention of it.
 */
function findSection14Heading(strippedText: string): { index: number } | null {
  const pattern = /\b14\.?\s+CLINICAL\s+STUDIES\b/gi;
  let last: RegExpMatchArray | null = null;
  for (const m of strippedText.matchAll(pattern)) {
    last = m;
  }
  return last && last.index !== undefined ? { index: last.index } : null;
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

export interface IndicationListEntry {
  /** The "1.N" subsection number, matching the same N in "14.N". */
  number: number;
  name: string;
}

/**
 * Finds where section 1 actually begins, not its table-of-contents mention.
 *
 * Same fix as findSection14Heading above, for the same reason: a label's ToC
 * lists "1 INDICATIONS AND USAGE" immediately followed by "2 DOSAGE AND
 * ADMINISTRATION" with nothing in between, and that always comes before the
 * real section in reading order — confirmed directly against Mimrylo's real
 * label, whose ToC mention left extractIndicationList reading an empty
 * window and reporting no indication at all for a drug that has one.
 */
function findIndicationsHeading(strippedText: string): { index: number } | null {
  const pattern = /\b1\s+INDICATIONS\s+AND\s+USAGE\b/gi;
  let last: RegExpMatchArray | null = null;
  for (const m of strippedText.matchAll(pattern)) {
    last = m;
  }
  return last && last.index !== undefined ? { index: last.index } : null;
}

/**
 * Extracts the drug's own indication list from section 1 (Indications and
 * Usage) of the label.
 *
 * This — not section 14's own subsection headings — is the reliable source
 * of indication names. Section 1 numbers its subsections by indication from
 * the very first approval ("1.1 Rheumatoid Arthritis"), even when there is
 * only one; confirmed against Rinvoq's actual original 2019 label, whose
 * section 1 already read "1.1 Rheumatoid Arthritis" while section 14 was a
 * bare, unnumbered "14 CLINICAL STUDIES" — AbbVie only started numbering
 * section 14's own subsections once a second indication existed. Reusing
 * section 1's numbering to interpret "14.N" (splitSection14ByIndication
 * below) means never having to parse section 14's own less consistently
 * formatted subsection titles for the name itself.
 */
export function extractIndicationList(labelText: string): IndicationListEntry[] {
  const stripped = stripPageMarkers(labelText);
  const start = findIndicationsHeading(stripped);
  if (!start) return [];
  const afterStart = stripped.slice(start.index);
  const end = /\b2\.?\s+DOSAGE\s+AND\s+ADMINISTRATION\b/i.exec(afterStart);
  const window = end ? afterStart.slice(0, end.index) : afterStart.slice(0, 2000);

  const entries: IndicationListEntry[] = [];
  const pattern = /\b1\.\s*(\d+)\s+([A-Z][A-Za-z0-9 ,''’/-]*?)(?=\s+1\.\s*\d+\s+[A-Z]|\s*$)/g;
  for (const m of window.matchAll(pattern)) {
    const number = Number(m[1]);
    const name = m[2].replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
    if (name.length >= 3) entries.push({ number, name });
  }
  return entries.length > 0 ? entries : extractUnnumberedIndication(window);
}

/**
 * Fallback for a label with exactly one approved indication and no "1.N"
 * subsection numbering at all. AbbVie's Rinvoq numbers from the very first
 * approval (see the doc comment above), but that isn't a universal FDA
 * convention — Takeda's Mimrylo label goes straight from "1 INDICATIONS AND
 * USAGE" to "2 DOSAGE AND ADMINISTRATION" with one plain sentence between
 * them, no heading to reuse.
 *
 * Reproduces the label's own "is indicated for ..." clause verbatim (minus a
 * fixed set of FDA boilerplate lead-ins — "the treatment of", "management
 * of", and so on — stripped because they're never disease-specific) rather
 * than trying to shorten it to a single disease name. Picking which part of
 * the sentence is "the" indication would be a judgement call; reusing the
 * label's own words isn't. It's still marked unverified like everything else
 * the pipeline extracts, so a person can rename it.
 */
function extractUnnumberedIndication(window: string): IndicationListEntry[] {
  const m = /\bis\s+indicated\s+for\s+([^.]*?)\.?(?=\s*2\.?\s*DOSAGE\s+AND\s+ADMINISTRATION\b|\s*$)/i.exec(
    window
  );
  if (!m) return [];
  let name = m[1].replace(/\s+/g, ' ').trim();
  name = name.replace(
    /^(the\s+)?(treatment(\s+and\s+(maintenance|prevention))?|management|reduction\s+of\s+risk|reducing\s+the\s+risk|prevention)\s+(of|for)\s+/i,
    ''
  );
  if (name.length < 3) return [];
  return [{ number: 1, name: name.charAt(0).toUpperCase() + name.slice(1) }];
}

export interface IndicationSpan {
  indication: string;
  text: string;
}

function flexibleNamePattern(name: string): string {
  return escapeRegExp(name).replace(/ /g, '\\s+').replace(/-/g, '\\s*-\\s*');
}

/**
 * Splits section 14 into one span per indication, using the indication list
 * above (not section 14's own subsection text) to identify which "14.N"
 * belongs to which indication.
 *
 * A label with only one approved indication has no "14.N" heading at all —
 * see extractIndicationList's doc comment — so the whole section is that
 * one indication's span. With more than one indication, a real subsection
 * heading is found by searching for "14.N" immediately followed by that
 * indication's own name (allowing for OCR whitespace/hyphen variance) — not
 * just any "14.N", which would also match an in-text cross-reference like
 * "[see Clinical Studies (14.2)]" appearing inside a different indication's
 * own discussion.
 */
export function splitSection14ByIndication(
  section14Text: string,
  indicationList: IndicationListEntry[]
): IndicationSpan[] {
  if (indicationList.length === 0) return [];
  if (indicationList.length === 1) {
    return [{ indication: indicationList[0].name, text: section14Text }];
  }

  const boundaries: { index: number; indication: string }[] = [];
  for (const { number, name } of indicationList) {
    const pattern = new RegExp(`\\b14\\.\\s*${number}\\s+${flexibleNamePattern(name)}`, 'i');
    const m = pattern.exec(section14Text);
    if (m) boundaries.push({ index: m.index, indication: name });
  }
  boundaries.sort((a, b) => a.index - b.index);

  return boundaries.map((b, i) => ({
    indication: b.indication,
    text: section14Text.slice(b.index, boundaries[i + 1]?.index ?? section14Text.length),
  }));
}

export interface RoleContext {
  /** Section 14, split into one span per indication. Empty when it could not be located or split. */
  indicationSections: IndicationSpan[];
  /** Full text of the medical/statistical reviews. */
  reviewText: string;
  labelUrl?: string;
  reviewUrl?: string;
  /** The applicant's name, e.g. "AbbVie Inc.", for the sponsor-match guard below. */
  sponsorName?: string;
  /**
   * Other companies already confirmed to be legitimate co-developers or
   * licensors for this drug's trials — see looksLikeSponsorTrial. Comes from
   * the registry entry, a human-supplied fact.
   */
  knownTrialSponsors?: string[];
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
 *
 * A trial's registered sponsor can legitimately differ from the NDA/BLA
 * applicant under a licensing or co-development deal — the original
 * developer runs and registers the trial, a different company later licenses
 * the drug and files the application. `knownTrialSponsors` (from the drug's
 * registry entry, a human-supplied fact — see DrugSpec) names companies
 * already confirmed to be legitimate co-developers for this specific drug,
 * so a match against one of them counts the same as matching the applicant.
 */
function looksLikeSponsorTrial(
  trial: Trial,
  sponsorName: string | undefined,
  knownTrialSponsors?: string[]
): boolean {
  if (trial.studyType && trial.studyType.toUpperCase() === 'OBSERVATIONAL') return false;
  if (!trial.sponsor) return true;
  const a = normalizeSponsor(trial.sponsor);
  const candidates = [sponsorName, ...(knownTrialSponsors ?? [])].filter(
    (s): s is string => !!s
  );
  if (candidates.length === 0) return true;
  return candidates.some((c) => {
    const b = normalizeSponsor(c);
    return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
  });
}

/**
 * A pivotal trial supporting an approved indication is, outside oncology
 * (not yet in scope), essentially always Phase 3 — the confirmatory trial
 * design a marketing application actually rests on. A trial named in an
 * indication's section 14 span that isn't Phase 3 (or the combined Phase
 * 2/3 design some programs use for their confirmatory trial) is unusual
 * enough to flag rather than trust silently; see PHASE_MISMATCH_WARNING
 * below, surfaced by the caller rather than failing classification outright,
 * since a genuine exception (accelerated approval, a different disease area
 * later) shouldn't be misclassified as a bug in this rule.
 */
const PIVOTAL_PHASES: ReadonlySet<Trial['phase']> = new Set(['PHASE3', 'PHASE2_3']);

export interface RoleAssignment {
  roles: IndicationRole[];
  /** Set when a PIVOTAL role was assigned to a non-Phase-3 trial — worth a human look. */
  phaseWarnings: string[];
}

/**
 * Classifies one trial's part in the marketing application, per indication.
 *
 * A trial can be pivotal for one indication and irrelevant to another —
 * Rinvoq's original five rheumatoid arthritis trials say nothing about its
 * atopic dermatitis approval four years later. Checking each indication's own
 * section 14 span independently, rather than the whole of section 14 at
 * once, is what keeps an indication-scoped page down to the handful of
 * trials that actually supported it instead of every trial cited anywhere
 * in the drug's history.
 */
export function classifyTrialRoles(trial: Trial, ctx: RoleContext): RoleAssignment {
  const knownAliases = trial.nctId ? ctx.trialAliases?.get(trial.nctId) ?? [] : [];
  const ids = identifiersOf(trial, ctx.trialAliases);
  const phaseWarnings: string[] = [];
  const roles: IndicationRole[] = [];

  for (const span of ctx.indicationSections) {
    if (ids.length === 0) continue;
    const matchedAlias = knownAliases.find((a) => mentions(span.text, [a]));
    const namedHere = mentions(span.text, ids);
    if (!namedHere) continue;

    // `citedIn` only proves the identifier's string appears *somewhere* in the
    // FDA paperwork (it's populated by a document-wide scan, not one scoped to
    // this indication's span) — it does not by itself prove the specific
    // occurrence here is genuine. A bare mention always needs the trial to
    // actually look like the applicant's own study before it's trusted.
    //
    // Acronym or Phase alone can't safely stand in for that: a real academic,
    // investigator-initiated trial can be interventional and informally named
    // too (see the "ACUTE"/"UPDATE" fixtures below — both use ordinary
    // English words as acronyms, both interventional, both bare-mentioned
    // right next to their own NCT numbers, and both still illegitimate). What
    // actually distinguishes a licensing/co-development structure — the
    // original developer holds the trial's ClinicalTrials.gov sponsor record
    // while a different company holds the NDA, as with rusfertide's pivotal
    // VERIFY trial (Protagonist Therapeutics ran it; Takeda licensed it and
    // filed) — is that the relationship is a known, named fact, not something
    // derivable from the label text itself. `knownTrialSponsors` lets a
    // registry entry record that fact once, the same way `pressReleaseUrl`
    // records a fact the pipeline has no way to find on its own.
    if (!looksLikeSponsorTrial(trial, ctx.sponsorName, ctx.knownTrialSponsors)) continue;

    if (!PIVOTAL_PHASES.has(trial.phase)) {
      phaseWarnings.push(
        `${trial.nctId ?? trial.id} is named in the ${span.indication} section 14 span but is ` +
          `${trial.phase}, not Phase 3 — marked PIVOTAL anyway since the label says so, but worth ` +
          `a human check.`
      );
    }

    roles.push({
      indication: span.indication,
      role: 'PIVOTAL',
      provenance: {
        sourceUrl: ctx.labelUrl,
        sourceLabel: `Approved label, section 14 (Clinical Studies — ${span.indication})`,
        extractedBy: 'rule',
        verified: false,
        quote: matchedAlias
          ? `The label refers to this trial as "${matchedAlias}" rather than by its ` +
            'registered identifiers; that name was resolved from a pairing found ' +
            'elsewhere in the FDA paperwork. Sponsor-run and interventional.'
          : `Trial identifier appears within the ${span.indication} section 14 span, and ` +
            'the trial is sponsor-run and interventional.',
      },
    });
  }

  if (roles.length > 0) return { roles, phaseWarnings };

  // Not named in any indication's section 14 span. Cited in the review
  // without a specific indication attributed — supporting evidence, not
  // (yet) tied to one approval.
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
      roles: [
        {
          role: byPhase[trial.phase] ?? 'SUPPORTIVE',
          provenance: {
            sourceUrl: ctx.reviewUrl,
            sourceLabel: 'FDA review (cited, not in a label section 14 indication span)',
            extractedBy: 'rule',
            verified: false,
          },
        },
      ],
      phaseWarnings,
    };
  }

  // Registered against the drug but never cited in the approval package —
  // no roles recorded at all. That absence is the "not in filing" state.
  return { roles: [], phaseWarnings };
}

export function applyRoles(
  trials: Trial[],
  ctx: RoleContext
): { trials: Trial[]; phaseWarnings: string[] } {
  const phaseWarnings: string[] = [];
  const out = trials.map((t) => {
    const { roles, phaseWarnings: w } = classifyTrialRoles(t, ctx);
    phaseWarnings.push(...w);
    return { ...t, roles };
  });
  return { trials: out, phaseWarnings };
}
