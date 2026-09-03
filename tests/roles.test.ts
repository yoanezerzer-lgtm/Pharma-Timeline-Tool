import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractLabelSection14, diagnoseSection14, classifyRole } from '../scripts/ingest/roles.js';
import { mapPhase } from '../scripts/ingest/ctgov.js';
import type { Trial } from '../src/schema/index.js';

const labelText = readFileSync(join(process.cwd(), 'tests/fixtures/label-excerpt.txt'), 'utf8');
const reviewText = readFileSync(join(process.cwd(), 'tests/fixtures/review-excerpt.txt'), 'utf8');

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', role: 'UNKNOWN', arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, ...o,
  };
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

describe('classifyRole', () => {
  const ctx = { labelSection14: extractLabelSection14(labelText), reviewText };

  it('marks a trial named in label section 14 as pivotal', () => {
    const r = classifyRole(trial({ protocolNumber: 'M13-545' }), ctx);
    expect(r.role).toBe('PIVOTAL');
    expect(r.provenance.extractedBy).toBe('rule');
    expect(r.provenance.verified).toBe(false);
  });

  it('classifies a review-cited phase 1 trial as pharmacokinetic', () => {
    expect(classifyRole(trial({ protocolNumber: 'M13-838', phase: 'PHASE1' }), ctx).role).toBe('PK');
  });

  it('classifies a review-cited phase 2 trial as dose-finding', () => {
    expect(classifyRole(trial({ protocolNumber: 'M13-537', phase: 'PHASE2' }), ctx).role).toBe(
      'DOSE_FINDING'
    );
  });

  it('marks a trial absent from the approval package as not in the filing', () => {
    expect(classifyRole(trial({ protocolNumber: 'M99-999' }), ctx).role).toBe('NOT_IN_FILING');
  });

  it('leaves every assignment unverified for a human to confirm', () => {
    expect(classifyRole(trial({ protocolNumber: 'M13-545' }), ctx).provenance.verified).toBe(false);
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
describe('classifyRole — sponsor and study-type guard', () => {
  // A span that names a real trial (with a citation) and also happens to
  // mention two others with no citation at all — an academic one and an
  // industry one — reproducing exactly how the four false positives arrived:
  // matched only by a bare NCT mention in an overrun span.
  const span =
    'Trial M13-545 (SELECT-COMPARE, NCT02629159) established efficacy. ' +
    'Postmarketing commitments include an observational study (NCT05327920) ' +
    'and an academic investigator-initiated study (NCT07258771).';
  const ctx = { labelSection14: span, reviewText: '', sponsorName: 'AbbVie Inc.' };

  it('rejects an academic (non-applicant) sponsor with no document citation', () => {
    const t = trial({
      nctId: 'NCT07258771',
      sponsor: 'Berinstein, Jeffrey',
      studyType: 'INTERVENTIONAL',
    });
    expect(classifyRole(t, ctx).role).not.toBe('PIVOTAL');
  });

  it('rejects an observational study even when the sponsor name matches', () => {
    const t = trial({
      nctId: 'NCT05327920',
      sponsor: 'AbbVie',
      studyType: 'OBSERVATIONAL',
    });
    expect(classifyRole(t, ctx).role).not.toBe('PIVOTAL');
  });

  it('accepts a sponsor-run interventional trial even without a document citation', () => {
    const t = trial({
      nctId: 'NCT09999999',
      sponsor: 'AbbVie',
      studyType: 'INTERVENTIONAL',
    });
    const withMention = {
      labelSection14: 'Also see the AbbVie study (NCT09999999) for supporting data.',
      reviewText: '',
      sponsorName: 'AbbVie Inc.',
    };
    expect(classifyRole(t, withMention).role).toBe('PIVOTAL');
  });

  it('does not let a document citation bypass the sponsor/study-type guard', () => {
    // citedIn is populated by a document-wide identifier scan, not one scoped
    // to section 14 — the same identifier can genuinely appear in the PDF
    // corpus (say, in a postmarketing-commitments paragraph) without that
    // occurrence being pivotal evidence. A citation existing must not excuse
    // a trial that otherwise fails the sponsor/study-type check.
    const t = trial({
      nctId: 'NCT07258771',
      sponsor: 'Berinstein, Jeffrey',
      studyType: 'INTERVENTIONAL',
      provenance: {
        citedIn: { extractedBy: 'regex', verified: false, page: 12, quote: 'the ACUTE study...' },
      },
    });
    expect(classifyRole(t, ctx).role).not.toBe('PIVOTAL');
  });

  it('does not block on a matching sponsor whose corporate suffix differs', () => {
    // "AbbVie Inc." (applicant) vs "AbbVie" (registry) must be recognised as
    // the same company despite the suffix — this is the common case, not an
    // edge case, since CT.gov rarely repeats the legal suffix.
    const t = trial({ nctId: 'NCT09999999', sponsor: 'AbbVie', studyType: 'INTERVENTIONAL' });
    const withMention = {
      labelSection14: 'See NCT09999999 for supporting data.',
      reviewText: '',
      sponsorName: 'AbbVie Inc.',
    };
    expect(classifyRole(t, withMention).role).toBe('PIVOTAL');
  });

  it('treats a missing sponsor name on either side as inconclusive, not disqualifying', () => {
    const t = trial({ nctId: 'NCT09999999', studyType: 'INTERVENTIONAL' });
    const withMention = {
      labelSection14: 'See NCT09999999 for supporting data.',
      reviewText: '',
      // sponsorName intentionally omitted
    };
    expect(classifyRole(t, withMention).role).toBe('PIVOTAL');
  });

  it('falls through to NOT_IN_FILING rather than a false pivotal, for a rejected trial', () => {
    const t = trial({ nctId: 'NCT07258771', sponsor: 'Berinstein, Jeffrey' });
    expect(classifyRole(t, ctx).role).toBe('NOT_IN_FILING');
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
