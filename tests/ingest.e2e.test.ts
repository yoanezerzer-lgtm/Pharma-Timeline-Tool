import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from '../scripts/ingest/run.js';
import type { DrugSpec } from '../scripts/ingest/registry.js';
import { Drug, type Drug as DrugType } from '../src/schema/index.js';
import { seedCache, readFixture, OPENFDA_211675 } from './helpers/seedCache.js';

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
