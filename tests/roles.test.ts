import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractLabelSection14,
  diagnoseSection14,
  classifyTrialRoles,
  extractTrialAliases,
  extractIndicationList,
  splitSection14ByIndication,
  type RoleContext,
} from '../scripts/ingest/roles.js';
import { mapPhase } from '../scripts/ingest/ctgov.js';
import type { Trial } from '../src/schema/index.js';

const labelText = readFileSync(join(process.cwd(), 'tests/fixtures/label-excerpt.txt'), 'utf8');
const reviewText = readFileSync(join(process.cwd(), 'tests/fixtures/review-excerpt.txt'), 'utf8');

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, ...o,
  };
}

const RA = 'Rheumatoid Arthritis';

/** Builds a RoleContext with a single indication's section 14 span. */
function ctxFor(section14: string | null, overrides: Partial<RoleContext> = {}): RoleContext {
  return {
    indicationSections: section14 ? [{ indication: RA, text: section14 }] : [],
    reviewText: '',
    ...overrides,
  };
}

/** Convenience: the role assigned for RA, or undefined if the trial has no roles at all. */
function pivotalFor(t: Trial, ctx: RoleContext): boolean {
  return classifyTrialRoles(t, ctx).roles.some((r) => r.role === 'PIVOTAL');
}

describe('extractLabelSection14', () => {
  const section = extractLabelSection14(labelText);

  it('locates the Clinical Studies section', () => {
    expect(section).not.toBeNull();
    expect(section).toContain('SELECT-COMPARE');
  });

  it('stops before the following numbered section', () => {
    expect(section).not.toContain('purple biconvex tablets');
  });

  it('excludes content from earlier sections', () => {
    expect(section).not.toContain('Carcinogenesis');
  });

  it('returns null when the heading is absent rather than guessing a span', () => {
    expect(extractLabelSection14('Some unrelated document text.')).toBeNull();
  });

  it('tolerates a period after the section number', () => {
    // Some labels render the heading as "14. CLINICAL STUDIES" rather than "14 CLINICAL STUDIES".
    const withPeriod = labelText.replace('14 CLINICAL STUDIES', '14. CLINICAL STUDIES');
    const section = extractLabelSection14(withPeriod);
    expect(section).not.toBeNull();
    expect(section).toContain('SELECT-COMPARE');
  });

  // The 400-character plausibility floor only counts the captured span itself
  // (from the "14 CLINICAL STUDIES" heading onward), so these fixtures pad
  // the body text — not text before the heading — to clear it realistically.
  const filler =
    'Efficacy and safety were assessed across multiple randomized, double-blind, ' +
    'placebo-controlled trials in adults with moderately to severely active disease. ';

  it('stops at 17 PATIENT COUNSELING when 15/16 are absent', () => {
    // Some labels omit a References section and jump straight to Patient
    // Counseling — the boundary must still be recognised, not just the two
    // titles the original, narrower regex hardcoded.
    const text =
      '14 CLINICAL STUDIES Trial M13-545 (SELECT-COMPARE) established efficacy. ' +
      filler.repeat(3) +
      '17 PATIENT COUNSELING INFORMATION Advise patients to report infections.';
    const section = extractLabelSection14(text);
    expect(section).not.toBeNull();
    expect(section).toContain('M13-545');
    expect(section).not.toContain('Advise patients');
  });

  it('does not mistake a dose for a section heading', () => {
    // "15 mg once daily" must not be read as the start of "15 REFERENCES" —
    // lowercase "mg" fails the all-caps title requirement.
    const text =
      '14 CLINICAL STUDIES Trial M13-545 was studied at 15 mg once daily in RA patients. ' +
      filler.repeat(3) +
      'Efficacy was maintained through week 48 of treatment in this population. ' +
      '16 HOW SUPPLIED Tablets are supplied in bottles.';
    const section = extractLabelSection14(text);
    expect(section).not.toBeNull();
    expect(section).toContain('week 48');
    expect(section).not.toContain('Tablets are supplied');
  });

  it('is vulnerable to a genuinely missing end boundary — documented, not silently wrong', () => {
    // If a label truly has no recognisable following heading in the extracted
    // text, the span runs to the end of the document. This is exactly why
    // classifyRole additionally requires either a document citation or a
    // sponsor/study-type match before trusting a bare mention — see below.
    const text =
      '14 CLINICAL STUDIES Trial M13-545 established efficacy. ' +
      filler.repeat(3) +
      'No further headings here.';
    const section = extractLabelSection14(text);
    expect(section).not.toBeNull();
    expect(section).toContain('No further headings here');
  });

  it('skips a table-of-contents mention of the heading and finds the real section', () => {
    // Reproduces a real pipeline failure found against the actual Rinvoq label
    // (211675/218347, supplement 034/008), which classified zero trials as
    // pivotal despite the label plainly naming five of them.
    //
    // The label's table of contents is extracted as one run of jumbled,
    // interleaved two-column text that happens to end in the exact heading
    // string — "...13.1 Carcinogenesis, Mutagenesis, Impairment of Fertility
    // listed. 14 CLINICAL STUDIES Reference ID: 5826084" — immediately
    // followed by "FULL PRESCRIBING INFORMATION WARNING: ...", the start of
    // the document body, not of section 14. Taking the *first* regex match
    // anchors there instead of on the real heading further down. From that
    // false start, pdfjs's habit of spacing out chemical-formula subscripts
    // ("C 17 H 19 F 3 N 6 O", from section 11 DESCRIPTION, encountered before
    // the real section 14 heading) then false-matches the section-end
    // boundary regex — "17 H" reads as a "1[5-8]" heading followed by an
    // all-caps run — truncating the captured span before it ever reaches the
    // real section 14 text, so it contains none of the real trial names.
    const text =
      '13.1 Carcinogenesis, Mutagenesis, Impairment of Fertility listed. ' +
      '14 CLINICAL STUDIES Reference ID: 5826084\n' +
      'FULL PRESCRIBING INFORMATION WARNING: SERIOUS INFECTIONS ' +
      filler.repeat(6) +
      '11 DESCRIPTION Upadacitinib has a molecular formula of C 17 H 19 F 3 N 6 O. ' +
      filler.repeat(3) +
      '14 CLINICAL STUDIES Trial M13-545 (SELECT-COMPARE) established efficacy. ' +
      filler.repeat(3) +
      '16 HOW SUPPLIED Tablets are supplied in bottles.';
    const section = extractLabelSection14(text);
    expect(section).not.toBeNull();
    expect(section).toContain('SELECT-COMPARE');
    expect(section).not.toContain('Tablets are supplied');
  });
});

describe('diagnoseSection14', () => {
  it('reports the phrase as absent when it never appears', () => {
    expect(diagnoseSection14('Nothing relevant in here.')).toEqual({ phrasePresent: false });
  });

  it('reports the phrase as present with a page and snippet when the heading did not match', () => {
    // A modern combined label might describe the section differently than the
    // numbered PLR heading — the diagnostic should still find the phrase and
    // say roughly where, even though extractLabelSection14 would return null.
    const text = '<<<PAGE 45>>>\nSee the CLINICAL STUDIES summary below for efficacy data.';
    const diag = diagnoseSection14(text);
    expect(diag.phrasePresent).toBe(true);
    expect(diag.page).toBe(45);
    expect(diag.snippet).toContain('CLINICAL STUDIES');
  });
});

/**
 * Reproduces the actual structure of the real, current (multi-indication)
 * Rinvoq label, confirmed against the genuine extracted text: section 1's
 * ToC-style subsection list, immediately followed by section 2's own
 * subsection list (which must not be mistaken for more indications), then
 * section 14's own subsection headings using the same numbering.
 */
describe('extractIndicationList', () => {
  const multiIndicationLabel =
    '1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis 1.2 Psoriatic Arthritis ' +
    "1.3 Atopic Dermatitis 1.4 Ulcerative Colitis 1.5 Crohn's Disease " +
    '2 DOSAGE AND ADMINISTRATION 2.1 Recommended Evaluations 2.2 Important Administration Instructions ' +
    '3 DOSAGE FORMS AND STRENGTHS';

  it('reads the numbered indication list from section 1, not section 2', () => {
    const list = extractIndicationList(multiIndicationLabel);
    expect(list).toEqual([
      { number: 1, name: 'Rheumatoid Arthritis' },
      { number: 2, name: 'Psoriatic Arthritis' },
      { number: 3, name: 'Atopic Dermatitis' },
      { number: 4, name: 'Ulcerative Colitis' },
      { number: 5, name: "Crohn's Disease" },
    ]);
  });

  it('tolerates OCR-inserted spaces around the period and hyphens', () => {
    // Real extracted Rinvoq label text: "1. 8 Polyarticular..." and
    // "Non - radiographic Axial Spondyloarthritis" (spaced hyphen).
    const text =
      '1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis ' +
      '1. 8 Non - radiographic Axial Spondyloarthritis ' +
      '2 DOSAGE AND ADMINISTRATION';
    const list = extractIndicationList(text);
    expect(list).toEqual([
      { number: 1, name: 'Rheumatoid Arthritis' },
      { number: 8, name: 'Non-radiographic Axial Spondyloarthritis' },
    ]);
  });

  it('reads a single indication even though only one is approved', () => {
    // Confirmed against Rinvoq's real original 2019 label: section 1 already
    // reads "1.1 Rheumatoid Arthritis" even with nothing else approved yet.
    const text = '1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis 2 DOSAGE AND ADMINISTRATION';
    expect(extractIndicationList(text)).toEqual([{ number: 1, name: 'Rheumatoid Arthritis' }]);
  });

  it('returns nothing when section 1 cannot be located', () => {
    expect(extractIndicationList('Some unrelated document text.')).toEqual([]);
  });

  it('falls back to the indicated-for clause when section 1 has no numbering at all', () => {
    // Real Mimrylo (rusfertide) label text: unlike Rinvoq, Takeda never
    // numbers section 1 with "1.1" even for its one approved indication.
    const text =
      '1 INDICATIONS AND USAGE MIMRYLO is indicated for the treatment of ' +
      'erythrocytosis in adults with polycythemia vera (PV). ' +
      '2 DOSAGE AND ADMINISTRATION 2.1 Recommended Dosage';
    expect(extractIndicationList(text)).toEqual([
      { number: 1, name: 'Erythrocytosis in adults with polycythemia vera (PV)' },
    ]);
  });

  it('strips the FDA boilerplate lead-in but leaves the rest of the clause verbatim', () => {
    const text =
      '1 INDICATIONS AND USAGE DRUGX is indicated for the management of ' +
      'moderate to severe plaque psoriasis. 2 DOSAGE AND ADMINISTRATION';
    expect(extractIndicationList(text)).toEqual([
      { number: 1, name: 'Moderate to severe plaque psoriasis' },
    ]);
  });

  it('still returns nothing when even the fallback phrasing is absent', () => {
    const text = '1 INDICATIONS AND USAGE Some unparseable layout. 2 DOSAGE AND ADMINISTRATION';
    expect(extractIndicationList(text)).toEqual([]);
  });

  it('skips a table-of-contents mention of section 1 and finds the real section', () => {
    // Reproduces a real pipeline failure found against the actual Mimrylo
    // label: its "FULL PRESCRIBING INFORMATION: CONTENTS" table of contents
    // lists "1 INDICATIONS AND USAGE 2 DOSAGE AND ADMINISTRATION" back to
    // back with no description in between. Taking the *first* regex match —
    // the same bug extractLabelSection14 already had to be fixed for above —
    // anchors there and reads an empty window, reporting no indication at
    // all for a drug that has one.
    const text =
      'HIGHLIGHTS OF PRESCRIBING INFORMATION ' +
      '----INDICATIONS AND USAGE---- MIMRYLO is indicated for the treatment ' +
      'of erythrocytosis in adults with polycythemia vera (PV). (1) ' +
      'FULL PRESCRIBING INFORMATION: CONTENTS* ' +
      '1 INDICATIONS AND USAGE 2 DOSAGE AND ADMINISTRATION 2.1 Recommended Dosage ' +
      '14 CLINICAL STUDIES ' +
      'FULL PRESCRIBING INFORMATION ' +
      '1 INDICATIONS AND USAGE MIMRYLO is indicated for the treatment of ' +
      'erythrocytosis in adults with polycythemia vera (PV). ' +
      '2 DOSAGE AND ADMINISTRATION 2.1 Recommended Dosage';
    expect(extractIndicationList(text)).toEqual([
      { number: 1, name: 'Erythrocytosis in adults with polycythemia vera (PV)' },
    ]);
  });
});

describe('splitSection14ByIndication', () => {
  it('attributes the whole section to the one indication when there is only one', () => {
    // A fresh, single-indication label's section 14 has no "14.N" numbering
    // at all (see extractIndicationList's doc comment) — the split must not
    // require a heading it will never find.
    const section14 = 'Trial RA-I (NCT02706873) established efficacy in RA patients.';
    const spans = splitSection14ByIndication(section14, [{ number: 1, name: RA }]);
    expect(spans).toEqual([{ indication: RA, text: section14 }]);
  });

  it('splits a multi-indication section 14 by its real subsection headings', () => {
    const section14 =
      '14.1 Rheumatoid Arthritis Trial RA-I (NCT02706873) established efficacy. ' +
      '14.2 Psoriatic Arthritis Trial PsA-I (NCT03104400) established efficacy.';
    const spans = splitSection14ByIndication(section14, [
      { number: 1, name: RA },
      { number: 2, name: 'Psoriatic Arthritis' },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[0].indication).toBe(RA);
    expect(spans[0].text).toContain('NCT02706873');
    expect(spans[0].text).not.toContain('NCT03104400');
    expect(spans[1].indication).toBe('Psoriatic Arthritis');
    expect(spans[1].text).toContain('NCT03104400');
  });

  it('is not fooled by a bracketed cross-reference to another indication’s subsection', () => {
    // "[see Clinical Studies (14.2)]" is a citation, not a heading — it must
    // not be read as the start of the Psoriatic Arthritis span, which would
    // otherwise fragment the Rheumatoid Arthritis trial's own text.
    const section14 =
      '14.1 Rheumatoid Arthritis Trial RA-I (NCT02706873) established efficacy ' +
      'consistent with prior Janus kinase inhibitor experience [see Clinical Studies (14.2)]. ' +
      '14.2 Psoriatic Arthritis Trial PsA-I (NCT03104400) established efficacy.';
    const spans = splitSection14ByIndication(section14, [
      { number: 1, name: RA },
      { number: 2, name: 'Psoriatic Arthritis' },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[0].text).toContain('NCT02706873');
    expect(spans[0].text).not.toContain('NCT03104400');
  });

  it('tolerates OCR-spaced subsection numbers like "14. 6"', () => {
    const section14 =
      '14.1 Rheumatoid Arthritis Trial RA-I (NCT02706873) established efficacy. ' +
      "14. 6 Ankylosing Spondylitis Trial AS-I (NCT03568318) established efficacy.";
    const spans = splitSection14ByIndication(section14, [
      { number: 1, name: RA },
      { number: 6, name: 'Ankylosing Spondylitis' },
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[1].text).toContain('NCT03568318');
  });

  it('reproduces the real Rinvoq label span split, confirmed against the actual extracted text', () => {
    // Verbatim shape of the real 2026 Rinvoq label (211675/218347, supplement
    // 034/008): the RA span must contain Trial RA-I's identifier and stop
    // before Psoriatic Arthritis's trial identifiers begin.
    const section14 =
      '14.1 Rheumatoid Arthritis The efficacy and safety of RINVOQ 15 mg once daily were ' +
      'assessed in five Phase 3 randomized, double-blind, multicenter trials in patients ' +
      'with moderately to severely active rheumatoid arthritis. Trial RA-I (NCT02706873) ' +
      'was a 24-week monotherapy trial in 947 patients. ' +
      '14.2 Psoriatic Arthritis The efficacy and safety of RINVOQ were assessed in Trial ' +
      'PsA-I (NCT03104400) and Trial PsA-II (NCT03104374).';
    const list = extractIndicationList(
      '1 INDICATIONS AND USAGE 1.1 Rheumatoid Arthritis 1.2 Psoriatic Arthritis ' +
        '2 DOSAGE AND ADMINISTRATION'
    );
    const spans = splitSection14ByIndication(section14, list);
    expect(spans[0].indication).toBe(RA);
    expect(spans[0].text).toContain('NCT02706873');
    expect(spans[0].text).not.toContain('NCT03104400');
  });
});

describe('classifyTrialRoles', () => {
  const ctx = ctxFor(extractLabelSection14(labelText), { reviewText });

  it('marks a trial named in label section 14 as pivotal, for that indication', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-545' }), ctx);
    expect(r.roles).toHaveLength(1);
    expect(r.roles[0]).toMatchObject({ indication: RA, role: 'PIVOTAL' });
    expect(r.roles[0].provenance.extractedBy).toBe('rule');
    expect(r.roles[0].provenance.verified).toBe(false);
  });

  it('classifies a review-cited phase 1 trial as pharmacokinetic', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-838', phase: 'PHASE1' }), ctx);
    expect(r.roles[0]?.role).toBe('PK');
  });

  it('classifies a review-cited phase 2 trial as dose-finding', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-537', phase: 'PHASE2' }), ctx);
    expect(r.roles[0]?.role).toBe('DOSE_FINDING');
  });

  it('records no roles for a trial absent from the approval package — the "not in filing" state', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M99-999' }), ctx);
    expect(r.roles).toEqual([]);
  });

  it('leaves every assignment unverified for a human to confirm', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-545' }), ctx);
    expect(r.roles[0].provenance.verified).toBe(false);
  });

  it('flags a PIVOTAL assignment on a non-Phase-3 trial for human review', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-545', phase: 'PHASE2' }), ctx);
    expect(r.roles[0]?.role).toBe('PIVOTAL');
    expect(r.phaseWarnings).toHaveLength(1);
    expect(r.phaseWarnings[0]).toContain('PHASE2');
  });

  it('does not warn when a PIVOTAL trial is Phase 2/3, the other accepted confirmatory design', () => {
    const r = classifyTrialRoles(trial({ protocolNumber: 'M13-545', phase: 'PHASE2_3' }), ctx);
    expect(r.roles[0]?.role).toBe('PIVOTAL');
    expect(r.phaseWarnings).toEqual([]);
  });
});

/**
 * Regression coverage for a real false-positive pattern a manual review caught:
 * four trials came back PIVOTAL purely because their NCT number turned up
 * somewhere inside the captured section 14 span, with no actual document
 * citation behind them. All four failed the same two checks — they were
 * observational studies, or run by an academic sponsor rather than the
 * applicant. Both signals are already on the registry record.
 */
describe('classifyTrialRoles — sponsor and study-type guard', () => {
  // A span that names a real trial (with a citation) and also happens to
  // mention two others with no citation at all — an academic one and an
  // industry one — reproducing exactly how the four false positives arrived:
  // matched only by a bare NCT mention in an overrun span.
  const span =
    'Trial M13-545 (SELECT-COMPARE, NCT02629159) established efficacy. ' +
    'Postmarketing commitments include an observational study (NCT05327920) ' +
    'and an academic investigator-initiated study (NCT07258771).';
  const ctx = ctxFor(span, { sponsorName: 'AbbVie Inc.' });

  it('rejects an academic (non-applicant) sponsor with no document citation', () => {
    const t = trial({
      nctId: 'NCT07258771',
      sponsor: 'Berinstein, Jeffrey',
      studyType: 'INTERVENTIONAL',
    });
    expect(pivotalFor(t, ctx)).toBe(false);
  });

  it('rejects an observational study even when the sponsor name matches', () => {
    const t = trial({
      nctId: 'NCT05327920',
      sponsor: 'AbbVie',
      studyType: 'OBSERVATIONAL',
    });
    expect(pivotalFor(t, ctx)).toBe(false);
  });

  it('accepts a sponsor-run interventional trial even without a document citation', () => {
    const t = trial({
      nctId: 'NCT09999999',
      sponsor: 'AbbVie',
      studyType: 'INTERVENTIONAL',
    });
    const withMention = ctxFor('Also see the AbbVie study (NCT09999999) for supporting data.', {
      sponsorName: 'AbbVie Inc.',
    });
    expect(pivotalFor(t, withMention)).toBe(true);
  });

  it('does not let a document citation bypass the sponsor/study-type guard', () => {
    // citedIn is populated by a document-wide identifier scan, not one scoped
    // to an indication's span — the same identifier can genuinely appear in
    // the PDF corpus (say, in a postmarketing-commitments paragraph) without
    // that occurrence being pivotal evidence. A citation existing must not
    // excuse a trial that otherwise fails the sponsor/study-type check.
    const t = trial({
      nctId: 'NCT07258771',
      sponsor: 'Berinstein, Jeffrey',
      studyType: 'INTERVENTIONAL',
      provenance: {
        citedIn: { extractedBy: 'regex', verified: false, page: 12, quote: 'the ACUTE study...' },
      },
    });
    expect(pivotalFor(t, ctx)).toBe(false);
  });

  it('does not block on a matching sponsor whose corporate suffix differs', () => {
    // "AbbVie Inc." (applicant) vs "AbbVie" (registry) must be recognised as
    // the same company despite the suffix — this is the common case, not an
    // edge case, since CT.gov rarely repeats the legal suffix.
    const t = trial({ nctId: 'NCT09999999', sponsor: 'AbbVie', studyType: 'INTERVENTIONAL' });
    const withMention = ctxFor('See NCT09999999 for supporting data.', {
      sponsorName: 'AbbVie Inc.',
    });
    expect(pivotalFor(t, withMention)).toBe(true);
  });

  it('treats a missing sponsor name on either side as inconclusive, not disqualifying', () => {
    const t = trial({ nctId: 'NCT09999999', studyType: 'INTERVENTIONAL' });
    // sponsorName intentionally omitted
    const withMention = ctxFor('See NCT09999999 for supporting data.');
    expect(pivotalFor(t, withMention)).toBe(true);
  });

  it('falls through to no roles at all — not a false pivotal — for a rejected trial', () => {
    const t = trial({ nctId: 'NCT07258771', sponsor: 'Berinstein, Jeffrey' });
    expect(classifyTrialRoles(t, ctx).roles).toEqual([]);
  });

  it('accepts a trial run by a known co-developer even when the applicant differs', () => {
    // Real Mimrylo case: rusfertide's pivotal VERIFY trial is registered
    // under its originator (Protagonist Therapeutics), while Takeda holds
    // the NDA under a licensing deal. A registry-supplied knownTrialSponsors
    // entry is what makes that legitimate structure distinguishable from an
    // unrelated third party — acronym or interventional status alone can't
    // (see the ACUTE/UPDATE cases above, which are both and are still
    // illegitimate).
    const t = trial({
      nctId: 'NCT05210790',
      acronym: 'VERIFY',
      sponsor: 'Protagonist Therapeutics, Inc.',
      studyType: 'INTERVENTIONAL',
    });
    const verifySpan = ctxFor(
      '14 CLINICAL STUDIES VERIFY The efficacy of MIMRYLO was evaluated in a study of ' +
        'patients with polycythemia vera [NCT05210790].',
      {
        sponsorName: 'Takeda Pharmaceuticals U.S.A., Inc.',
        knownTrialSponsors: ['Protagonist Therapeutics, Inc.'],
      }
    );
    expect(pivotalFor(t, verifySpan)).toBe(true);
  });

  it('still rejects a differing sponsor that is not on the known-co-developer list', () => {
    const t = trial({ nctId: 'NCT09999999', sponsor: 'Some Other Company' });
    const withMention = ctxFor('See NCT09999999 for supporting data.', {
      sponsorName: 'AbbVie Inc.',
      knownTrialSponsors: ['Protagonist Therapeutics, Inc.'],
    });
    expect(pivotalFor(t, withMention)).toBe(false);
  });
});

describe('mapPhase', () => {
  it('collapses a combined phase array into one lane', () => {
    expect(mapPhase(['PHASE1', 'PHASE2'])).toBe('PHASE1_2');
    expect(mapPhase(['PHASE2', 'PHASE3'])).toBe('PHASE2_3');
  });

  it('maps single phases directly', () => {
    expect(mapPhase(['PHASE3'])).toBe('PHASE3');
    expect(mapPhase(['EARLY_PHASE1'])).toBe('EARLY_PHASE1');
  });

  it('falls back to NA for missing or unrecognised phases', () => {
    expect(mapPhase(undefined)).toBe('NA');
    expect(mapPhase([])).toBe('NA');
    expect(mapPhase(['NA'])).toBe('NA');
  });
});

/**
 * Regression coverage for a real production failure: a mature, multi-indication
 * label had renamed every historical RA trial to a generic scheme ("Trial
 * RA-I") that appears nowhere in the registry record (not the NCT ID, not the
 * sponsor protocol number, not the original acronym). Nothing in section 14
 * matched any known identifier, so every trial fell through to SUPPORTIVE or
 * lower — the whole run came back with zero pivotal trials. The real review
 * document (quoted verbatim below, from the actual FDA paperwork) does pair
 * the generic name with the NCT number, just never inside the label itself.
 */
describe('extractTrialAliases', () => {
  // Verbatim from the real ingest run's citedIn quote.
  const realReviewQuote =
    'oses have been studied, the recommended dosage of RINVOQ is 15 mg once daily. ' +
    'Trial RA-I (NCT02706873) was a 24-week monotherapy trial in 947 patients with ' +
    'moderately to severely active rheum';

  it('pairs a generic trial name with its NCT number from real review text', () => {
    const aliases = extractTrialAliases(realReviewQuote);
    expect(aliases.get('NCT02706873')).toEqual(['RA-I']);
  });

  it('recognises "Study" as well as "Trial"', () => {
    const aliases = extractTrialAliases('Study RA-II (NCT01234567) enrolled 500 subjects.');
    expect(aliases.get('NCT01234567')).toEqual(['RA-II']);
  });

  it('collects multiple distinct aliases for the same NCT without duplicating', () => {
    const text =
      'Trial RA-I (NCT02706873) was described earlier. ' +
      'Elsewhere, Study RA-I (NCT02706873) is referenced again. ' +
      'Trial PsA-II (NCT09999999) is a different study.';
    const aliases = extractTrialAliases(text);
    expect(aliases.get('NCT02706873')).toEqual(['RA-I']);
    expect(aliases.get('NCT09999999')).toEqual(['PsA-II']);
  });

  it('finds nothing in unrelated text', () => {
    expect(extractTrialAliases('No such pairing appears here at all.').size).toBe(0);
  });
});

describe('classifyTrialRoles — generic label naming, resolved via alias', () => {
  it('marks pivotal a trial the label names only by its generic alias', () => {
    // The label's own section 14 never repeats the NCT number, protocol
    // number, or acronym — only the generic name the review already paired
    // with this trial's NCT ID.
    const reviewText =
      'Trial RA-I (NCT02706873) was a 24-week monotherapy trial in 947 patients.';
    const labelSection14 =
      'In Trial RA-I, subjects receiving upadacitinib 15 mg achieved significantly ' +
      'higher ACR20 response rates than those receiving methotrexate alone at Week 24.';

    const t = trial({
      nctId: 'NCT02706873',
      protocolNumber: 'M13-545',
      acronym: 'SELECT-EARLY',
      sponsor: 'AbbVie',
    });

    const ctx = ctxFor(labelSection14, {
      reviewText,
      sponsorName: 'AbbVie Inc.',
      trialAliases: extractTrialAliases(reviewText),
    });

    expect(pivotalFor(t, ctx)).toBe(true);
  });

  it('does not mark pivotal without the alias map, proving the fix is load-bearing', () => {
    const labelSection14 =
      'In Trial RA-I, subjects receiving upadacitinib 15 mg achieved significantly ' +
      'higher ACR20 response rates than those receiving methotrexate alone at Week 24.';
    const t = trial({ nctId: 'NCT02706873', protocolNumber: 'M13-545', sponsor: 'AbbVie' });
    const ctxWithoutAliases = ctxFor(labelSection14, { sponsorName: 'AbbVie Inc.' });
    expect(pivotalFor(t, ctxWithoutAliases)).toBe(false);
  });

  it('still applies the sponsor/study-type guard to an alias-resolved match', () => {
    // An alias match is not a trusted shortcut around the guard — an academic
    // study named generically in the label is exactly as untrustworthy as one
    // named by its real identifiers.
    const reviewText = 'Trial X-9 (NCT07258771) was an investigator-initiated study.';
    const labelSection14 = 'Trial X-9 examined outcomes in hospitalised patients.';
    const t = trial({ nctId: 'NCT07258771', sponsor: 'Berinstein, Jeffrey' });
    const ctx = ctxFor(labelSection14, {
      reviewText,
      sponsorName: 'AbbVie Inc.',
      trialAliases: extractTrialAliases(reviewText),
    });
    expect(pivotalFor(t, ctx)).toBe(false);
  });
});
