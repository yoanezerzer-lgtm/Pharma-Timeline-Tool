import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from '../scripts/ingest/run.js';
import type { DrugSpec } from '../scripts/ingest/registry.js';
import { Drug, type Drug as DrugType } from '../src/schema/index.js';
import { seedCache, readFixture, OPENFDA_211675 } from './helpers/seedCache.js';
import { academicStudy, observationalStudy } from './fixtures/studies.js';

/**
 * The dress rehearsal: the whole pipeline, start to finish, with no network.
 *
 * The unit tests cover each stage on its own. This covers them wired together —
 * which is the only place several important failures can show up, and the only
 * thing that has never been exercised because it normally needs the internet.
 */

const SPEC: DrugSpec = {
  slug: 'upadacitinib',
  brandName: 'Rinvoq',
  inn: 'upadacitinib',
  modality: 'Small molecule',
  sponsor: 'AbbVie Inc.',
  mechanism: 'Selective Janus kinase (JAK1) inhibitor',
  applicationNumber: '211675',
  applicationType: 'NDA',
  interventionNames: ['upadacitinib', 'ABT-494', 'Rinvoq'],
};

const REVIEW_URL =
  'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211675Orig1s000MedR.pdf';
const LABEL_URL =
  'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211675Orig1s000lbl.pdf';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

function makeWorkspace(): { rawDir: string; drugsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ingest-e2e-'));
  const rawDir = join(root, 'raw');
  const drugsDir = join(root, 'drugs');
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(drugsDir, { recursive: true });

  seedCache({
    slug: SPEC.slug,
    rawDir,
    applicationType: SPEC.applicationType,
    applicationNumber: SPEC.applicationNumber,
    intervention: SPEC.inn,
    openFdaResponse: OPENFDA_211675,
    documents: [
      { url: REVIEW_URL, text: readFixture('review-excerpt.txt') },
      { url: LABEL_URL, text: readFixture('label-excerpt.txt') },
    ],
  });

  return { rawDir, drugsDir };
}

function run(ws: { rawDir: string; drugsDir: string }) {
  return runIngest({ spec: SPEC, rawDir: ws.rawDir, drugsDir: ws.drugsDir, now: FIXED_NOW });
}

describe('full ingestion pipeline, offline', () => {
  let ws: ReturnType<typeof makeWorkspace>;
  let result: Awaited<ReturnType<typeof run>>;
  let drug: DrugType;

  beforeAll(async () => {
    ws = makeWorkspace();
    result = await run(ws);
    drug = result.drug;
  });

  it('completes without reaching the network', () => {
    expect(result.written).toBe(true);
    expect(existsSync(result.outPath!)).toBe(true);
  });

  it('produces a record that passes the schema', () => {
    expect(Drug.safeParse(JSON.parse(readFileSync(result.outPath!, 'utf8'))).success).toBe(true);
  });

  // --- the join: document code -> registry record ---------------------------

  it('turns protocol numbers in the review into trials with registry data attached', () => {
    const compare = drug.trials.find((t) => t.protocolNumber === 'M13-545');
    expect(compare).toBeDefined();
    expect(compare!.nctId).toBe('NCT02629159');
    expect(compare!.acronym).toBe('SELECT-COMPARE');
    expect(compare!.phase).toBe('PHASE3');
    // The dates and enrollment come from the registry, not the document.
    expect(compare!.startDate).toEqual({ value: '2015-12-01', precision: 'month' });
    expect(compare!.enrollment).toEqual({ count: 1629, type: 'ACTUAL' });
  });

  it('records where in the approval package each identifier was found', () => {
    const compare = drug.trials.find((t) => t.protocolNumber === 'M13-545')!;
    const cited = compare.provenance.citedIn;
    expect(cited).toBeDefined();
    expect(cited!.page).toBeGreaterThan(0);
    expect(cited!.quote).toContain('M13-545');
    expect(cited!.verified).toBe(false);
  });

  it('does not create duplicate trials when several identifiers point at one study', () => {
    // M13-545, SELECT-COMPARE and NCT02629159 all resolve to the same record.
    const nctIds = drug.trials.map((t) => t.nctId);
    expect(new Set(nctIds).size).toBe(nctIds.length);
  });

  // --- roles ---------------------------------------------------------------

  it('marks trials named in label section 14 as pivotal', () => {
    expect(result.foundLabelSection14).toBe(true);
    const pivotal = drug.trials.filter((t) => t.role === 'PIVOTAL').map((t) => t.protocolNumber);
    expect(pivotal.sort()).toEqual(['M13-542', 'M13-545', 'M13-549', 'M14-465', 'M14-653']);
  });

  it('does not mark a review-only trial as pivotal', () => {
    const balance = drug.trials.find((t) => t.protocolNumber === 'M13-537')!;
    expect(balance.role).toBe('DOSE_FINDING');
  });

  it('classifies a review-cited phase 1 trial as pharmacokinetic', () => {
    expect(drug.trials.find((t) => t.protocolNumber === 'M13-838')!.role).toBe('PK');
  });

  it('marks a registered trial that the approval package never cites', () => {
    const measureUp = drug.trials.find((t) => t.protocolNumber === 'M16-045');
    expect(measureUp).toBeDefined();
    expect(measureUp!.role).toBe('NOT_IN_FILING');
  });

  it('leaves every role unverified for a person to confirm', () => {
    for (const t of drug.trials) {
      expect(t.provenance.role?.verified).toBe(false);
    }
  });

  // --- milestones ----------------------------------------------------------

  it('turns approved submissions into milestones', () => {
    const approval = drug.milestones.find((m) => m.type === 'FDA_APPROVAL');
    expect(approval?.date).toEqual({ value: '2019-08-16', precision: 'day' });
    expect(drug.milestones.filter((m) => m.type === 'FDA_SUPPLEMENT')).toHaveLength(1);
  });

  it('ignores submissions that were not approved', () => {
    // The tentative-approval supplement must not appear as a timeline event.
    expect(drug.milestones.some((m) => m.submissionNumber === 'SUPPL-9')).toBe(false);
  });

  // --- ordering and stability ----------------------------------------------

  it('orders trials by start date so the committed file stays diff-friendly', () => {
    const starts = drug.trials.map((t) => t.startDate?.value ?? '9999');
    expect([...starts].sort()).toEqual(starts);
  });

  it('is idempotent — a second run produces a byte-identical file', async () => {
    // If this fails, every re-run would create noise in the history and the
    // workflow would open a pull request even when nothing actually changed.
    const first = readFileSync(result.outPath!, 'utf8');
    await run(ws);
    expect(readFileSync(result.outPath!, 'utf8')).toBe(first);
  });

  it('does not advance the ingest timestamp when nothing changed', async () => {
    const second = await run(ws);
    expect(second.drug.lastIngestedAt).toBe(drug.lastIngestedAt);
  });
});

describe('re-running over curated data', () => {
  it('preserves a human-verified field and reports the disagreement', async () => {
    const ws = makeWorkspace();
    await run(ws);

    // Simulate Yoan correcting an enrollment figure and marking it checked.
    const path = join(ws.drugsDir, 'upadacitinib.json');
    const edited = Drug.parse(JSON.parse(readFileSync(path, 'utf8')));
    const target = edited.trials.find((t) => t.protocolNumber === 'M13-545')!;
    target.enrollment = { count: 1234, type: 'ACTUAL' };
    target.provenance.enrollment = { extractedBy: 'human', verified: true };
    writeFileSync(path, JSON.stringify(edited, null, 2) + '\n');

    const after = await run(ws);

    const compare = after.drug.trials.find((t) => t.protocolNumber === 'M13-545')!;
    expect(compare.enrollment).toEqual({ count: 1234, type: 'ACTUAL' });
    expect(after.conflicts).toContainEqual(
      expect.objectContaining({ field: 'enrollment', trialId: compare.id })
    );
  });

  it('keeps hand-written narrative that the pipeline never produces', async () => {
    const ws = makeWorkspace();
    await run(ws);

    const path = join(ws.drugsDir, 'upadacitinib.json');
    const edited = Drug.parse(JSON.parse(readFileSync(path, 'utf8')));
    edited.summary = 'A hand-written development narrative.';
    edited.trials[0].takeaways = ['Something worth remembering.'];
    writeFileSync(path, JSON.stringify(edited, null, 2) + '\n');

    const after = await run(ws);

    expect(after.drug.summary).toBe('A hand-written development narrative.');
    expect(after.drug.trials.find((t) => t.id === edited.trials[0].id)!.takeaways).toEqual([
      'Something worth remembering.',
    ]);
  });
});

/**
 * Regression coverage for a real production failure: a mature drug's most
 * recent label document failed to yield a locatable section 14 (likely a PDF
 * extraction quirk on that specific document), and — because label selection
 * used to be "whichever one happens to appear first in openFDA's array
 * order" — every trial in the whole run came back non-pivotal. There was
 * nothing wrong with the older label; it was just never tried.
 */
describe('label selection when the newest label fails to parse', () => {
  const OLD_LABEL_URL = 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/211675s000lbl.pdf';
  const NEW_LABEL_URL = 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/211675s002lbl.pdf';

  // Deliberately unsorted (newest submission listed first, as openFDA's array
  // order is not chronological) and the newest one's application_docs points
  // at a label with no locatable section 14 — standing in for a document that
  // extracted badly.
  const OPENFDA_MULTI_LABEL = {
    results: [
      {
        application_number: 'NDA211675',
        sponsor_name: 'ABBVIE INC',
        submissions: [
          {
            submission_type: 'SUPPL',
            submission_number: '2',
            submission_status: 'AP',
            submission_status_date: '20240101',
            submission_class_code_description: 'Efficacy-New Indication',
            application_docs: [{ id: '2', type: 'Label', url: NEW_LABEL_URL }],
          },
          {
            submission_type: 'ORIG',
            submission_number: '1',
            submission_status: 'AP',
            submission_status_date: '20190816',
            submission_class_code_description: 'Type 1 - New Molecular Entity',
            application_docs: [{ id: '1', type: 'Label', url: OLD_LABEL_URL }],
          },
        ],
      },
    ],
  };

  const UNPARSEABLE_LABEL_TEXT =
    'A modern combined label discussing dosing, adverse reactions, and drug ' +
    'interactions across several indications, with no numbered heading in this excerpt.';

  function makeMultiLabelWorkspace(oldLabelText: string, newLabelText: string) {
    const root = mkdtempSync(join(tmpdir(), 'ingest-e2e-multilabel-'));
    const rawDir = join(root, 'raw');
    const drugsDir = join(root, 'drugs');
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(drugsDir, { recursive: true });

    seedCache({
      slug: SPEC.slug,
      rawDir,
      applicationType: SPEC.applicationType,
      applicationNumber: SPEC.applicationNumber,
      intervention: SPEC.inn,
      openFdaResponse: OPENFDA_MULTI_LABEL,
      documents: [
        { url: OLD_LABEL_URL, text: oldLabelText },
        { url: NEW_LABEL_URL, text: newLabelText },
      ],
    });

    return { rawDir, drugsDir };
  }

  it('falls back to an older label when the newest one has no locatable section 14', async () => {
    const ws = makeMultiLabelWorkspace(readFixture('label-excerpt.txt'), UNPARSEABLE_LABEL_TEXT);
    const result = await run(ws);

    // Despite the most recent label failing, pivotal status still comes through
    // via the older one that actually has a locatable section 14.
    expect(result.foundLabelSection14).toBe(true);
    const pivotal = result.drug.trials.filter((t) => t.role === 'PIVOTAL').map((t) => t.protocolNumber);
    expect(pivotal).toContain('M13-545');
    expect(result.warnings.some((w) => w.includes('could not locate section 14 in any of'))).toBe(
      false
    );
  });

  it('reports diagnostics when every label document fails', async () => {
    const ws = makeMultiLabelWorkspace(
      'Also no numbered heading in this one.',
      UNPARSEABLE_LABEL_TEXT
    );
    const result = await run(ws);

    expect(result.foundLabelSection14).toBe(false);
    expect(
      result.warnings.some(
        (w) => w.includes('could not locate section 14 in any of 2 label document(s)')
      )
    ).toBe(true);
  });
});

/**
 * Regression coverage for the exact false positives a manual review caught on
 * the real Rinvoq run: an academic investigator-initiated study and a company
 * observational registry both ended up marked PIVOTAL because their trial
 * identifiers appeared somewhere within the captured section 14 span with no
 * real document citation behind them. Both are registered against upadacitinib
 * (so the ctgov stage legitimately pulls them in) but neither is evidence
 * AbbVie's own application rests on.
 */
describe('sponsor and study-type guard, full pipeline', () => {
  it('excludes an academic study and an observational registry from pivotal, even when named in the section 14 span', async () => {
    const ws = makeWorkspace();

    // Simulate the section 14 span naming both false positives alongside a
    // real, sponsor-run, cited trial — the same shape as the production span,
    // regardless of exactly how each identifier ended up inside it.
    seedCache({
      slug: SPEC.slug,
      rawDir: ws.rawDir,
      applicationType: SPEC.applicationType,
      applicationNumber: SPEC.applicationNumber,
      intervention: SPEC.inn,
      openFdaResponse: OPENFDA_211675,
      documents: [
        {
          url: REVIEW_URL,
          text: readFixture('review-excerpt.txt'),
        },
        {
          url: LABEL_URL,
          // Inserted before "16 HOW SUPPLIED" — the fixture's existing end
          // boundary — so this text genuinely falls inside the captured
          // section 14 span, not merely appended after the whole document.
          text: readFixture('label-excerpt.txt').replace(
            '16 HOW SUPPLIED',
            '14.9 Postmarketing Data Real-world and investigator-initiated data are ' +
              'also referenced, including the ACUTE study (NCT07258771) and the UPDATE ' +
              'registry (NCT05327920). 16 HOW SUPPLIED'
          ),
        },
      ],
    });

    const result = await run(ws);
    const byNct = (nctId: string) => result.drug.trials.find((t) => t.nctId === nctId);

    const academic = byNct(academicStudy.protocolSection!.identificationModule!.nctId!);
    expect(academic).toBeDefined();
    expect(academic!.role).not.toBe('PIVOTAL');

    const observational = byNct(observationalStudy.protocolSection!.identificationModule!.nctId!);
    expect(observational).toBeDefined();
    expect(observational!.role).not.toBe('PIVOTAL');

    // The real pivotal trials in the same span are unaffected by the guard.
    const compare = result.drug.trials.find((t) => t.protocolNumber === 'M13-545');
    expect(compare!.role).toBe('PIVOTAL');
  });
});

/**
 * Regression coverage for the second real production failure: after the
 * sponsor/study-type guard shipped, a real run came back with *zero* pivotal
 * trials rather than the expected 18. Root cause, confirmed by inspecting the
 * actual pushed data: the current (2026) label has accumulated seven
 * indications and renamed historical RA trials to a generic scheme ("Trial
 * RA-I") that appears nowhere in the registry record — only the review pairs
 * that name with the real NCT number, and the label's own section 14 text
 * never repeats it. Reproduces that exact shape end to end.
 */
describe('generic label naming, full pipeline', () => {
  it('recovers a pivotal trial the label names only by a generic alias', async () => {
    const ws = makeWorkspace();

    seedCache({
      slug: SPEC.slug,
      rawDir: ws.rawDir,
      applicationType: SPEC.applicationType,
      applicationNumber: SPEC.applicationNumber,
      intervention: SPEC.inn,
      openFdaResponse: OPENFDA_211675,
      documents: [
        {
          // The review pairs the generic name with the real NCT — this is
          // where extractTrialAliases finds the mapping.
          url: REVIEW_URL,
          text:
            readFixture('review-excerpt.txt') +
            ' Trial RA-I (NCT02706873) was a 24-week monotherapy trial in 947 patients ' +
            'with moderately to severely active rheumatoid arthritis.',
        },
        {
          // A standalone label — not derived from label-excerpt.txt, which
          // already names this trial by its real protocol number and acronym
          // elsewhere in that fixture. Section 14 here refers to the trial
          // only by the generic name; nothing else in this text mentions its
          // NCT ID, protocol number, or acronym.
          url: LABEL_URL,
          text:
            '14 CLINICAL STUDIES 14.1 Rheumatoid Arthritis Study M13-545 (SELECT-COMPARE) ' +
            'compared upadacitinib to placebo and to adalimumab in 1629 subjects on a stable ' +
            'background of methotrexate. In Trial RA-I, subjects receiving upadacitinib 15 mg ' +
            'once daily achieved significantly higher ACR20 response rates than those ' +
            'receiving methotrexate alone at Week 24, with durable responses maintained ' +
            'through Week 48 of continued treatment in this population of adults with ' +
            'moderately to severely active rheumatoid arthritis and an inadequate response to ' +
            'prior methotrexate therapy. 16 HOW SUPPLIED Tablets are supplied as purple ' +
            'biconvex tablets in bottles of 30.',
        },
      ],
    });

    const result = await run(ws);
    const selectEarly = result.drug.trials.find((t) => t.nctId === 'NCT02706873');

    expect(selectEarly).toBeDefined();
    expect(selectEarly!.role).toBe('PIVOTAL');
    // The other trials in the fixture, matched the ordinary way, still work —
    // the alias path is additive, not a replacement.
    const compare = result.drug.trials.find((t) => t.protocolNumber === 'M13-545');
    expect(compare!.role).toBe('PIVOTAL');
  });
});
