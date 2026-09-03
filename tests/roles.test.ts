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
