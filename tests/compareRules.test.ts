import { describe, it, expect } from 'vitest';
import {
  deriveFacts,
  diffFacts,
  formatReport,
  trialNames,
  REPORT_MARKER,
  type DrugInput,
  type Facts,
  type RuleModules,
} from '../scripts/compare-rules/facts.js';
import { mergeTrials } from '../scripts/compare-rules/cli.js';
import * as roles from '../scripts/ingest/roles.js';
import * as dates from '../scripts/ingest/indicationDates.js';
import type { Milestone, Trial } from '../src/schema/index.js';

const trial = (acronym: string | undefined, nctId: string): Trial =>
  ({ id: (acronym ?? nctId).toLowerCase(), acronym, nctId, phase: 'PHASE3', roles: [] }) as unknown as Trial;

const facts = (uses: Record<string, string>, r: Record<string, string[]>, label = 'SUPPL-2'): Facts => ({
  label,
  uses,
  roles: r,
});

describe('diffFacts', () => {
  it('names each changed date, role gained and role lost, one line each', () => {
    const before = facts(
      { 'Previously Treated HNSCC': '2025-12-17 ORIG-1', NSCLC: 'undated' },
      { 'ORIGAMI-4': ['pivotal for NSCLC'], MARIPOSA: ['pivotal for NSCLC'] }
    );
    const after = facts(
      { 'Previously Treated HNSCC': '2026-11-05 SUPPL-2', NSCLC: 'undated' },
      { 'ORIGAMI-4': ['pivotal for Previously Treated HNSCC'], MARIPOSA: ['pivotal for NSCLC'] }
    );
    expect(diffFacts('Rybrevant Faspro', before, after)).toEqual([
      'Rybrevant Faspro: use "Previously Treated HNSCC": 2026-11-05 SUPPL-2 (was 2025-12-17 ORIG-1)',
      'Rybrevant Faspro: ORIGAMI-4 pivotal for Previously Treated HNSCC: added',
      'Rybrevant Faspro: ORIGAMI-4 pivotal for NSCLC: removed',
    ]);
  });

  it('reports uses that appear or disappear, and a different label', () => {
    const before = facts({ A: '2020-01-01 ORIG-1' }, {}, 'SUPPL-1');
    const after = facts({ B: 'undated' }, {}, 'SUPPL-3');
    expect(diffFacts('X', before, after)).toEqual([
      'X: roles read from label SUPPL-3 (was SUPPL-1)',
      'X: use "A": removed (was 2020-01-01 ORIG-1)',
      'X: use "B": added, undated',
    ]);
  });

  it('is empty when nothing changes', () => {
    const f = facts({ A: 'undated' }, { T: ['supportive (review)'] });
    expect(diffFacts('X', f, structuredClone(f))).toEqual([]);
  });
});

describe('trialNames', () => {
  it('uses the acronym, and adds the NCT number only when an acronym repeats', () => {
    expect(trialNames([trial('UPDATE', 'NCT05327920'), trial('UPDATE', 'NCT05669794'), trial(undefined, 'NCT1'), trial('CD', 'NCT2')])).toEqual([
      'UPDATE (NCT05327920)',
      'UPDATE (NCT05669794)',
      'NCT1',
      'CD',
    ]);
  });
});

describe('mergeTrials', () => {
  it('keeps every trial of the published record and adds the run’s new ones', () => {
    const merged = mergeTrials([trial('A', 'NCT1')], [trial('A2', 'NCT1'), trial('B', 'NCT2')]);
    expect(merged.map((t) => t.acronym)).toEqual(['A', 'B']);
  });
});

describe('formatReport', () => {
  it('lists changed drugs with counts and sums up the rest in one line', () => {
    const md = formatReport(
      [
        { name: 'Dupixent', lines: ['Dupixent: RAPID supportive (review): removed'] },
        { name: 'Keytruda', lines: [] },
        { name: 'Rinvoq', lines: [] },
      ],
      { base: 'abc1234', head: 'working tree', missing: ['newdrug'] }
    );
    expect(md.startsWith(REPORT_MARKER)).toBe(true);
    expect(md).toContain('**1 of 3 drugs change.**');
    expect(md).toContain('### Dupixent (1 change)\n- RAPID supportive (review): removed');
    expect(md).toContain('No change (2): Keytruda, Rinvoq.');
    expect(md).toContain('No saved text, not compared (1): newdrug.');
  });

  it('says plainly when nothing changes', () => {
    expect(formatReport([{ name: 'A', lines: [] }], { base: 'a', head: 'b', missing: [] })).toContain('**No change** on 1 drugs.');
  });
});

describe('deriveFacts', () => {
  const real: RuleModules = { roles, dates, knownTrialSponsors: () => undefined } as unknown as RuleModules;

  // Section 14 must clear a 400-character floor, as a real one does.
  const filler = 'Efficacy and safety were assessed in randomized, double-blind, placebo-controlled trials in adults. '.repeat(5);
  const labelText = (uses: string[], section14: string) =>
    'FULL PRESCRIBING INFORMATION: CONTENTS 1 INDICATIONS AND USAGE ' +
    uses.map((u, i) => `1.${i + 1} ${u}`).join(' ') +
    ' 2 DOSAGE AND ADMINISTRATION Take it. 14 CLINICAL STUDIES ' +
    section14 +
    ' ' +
    filler +
    '16 HOW SUPPLIED/STORAGE AND HANDLING Store cold.';

  const milestone = (submission: string, date: string): Milestone =>
    ({
      id: submission,
      type: submission === 'ORIG-1' ? 'FDA_APPROVAL' : 'FDA_SUPPLEMENT',
      region: 'US',
      date: { value: date, precision: 'day' },
      label: submission,
      description: 'Efficacy',
      submissionNumber: submission,
      provenance: { sourceLabel: 'openFDA', extractedBy: 'api', verified: false },
    }) as unknown as Milestone;

  it('dates each use by the label that first lists it and reads roles from the newest label', () => {
    const drug: DrugInput = {
      slug: 'x',
      name: 'X',
      sponsor: 'Acme',
      trials: [
        { ...trial('ALPHA', 'NCT00000001'), sponsor: 'Acme', sponsorClass: 'INDUSTRY', studyType: 'INTERVENTIONAL' } as unknown as Trial,
      ],
      milestones: [milestone('ORIG-1', '2020-01-01'), milestone('SUPPL-2', '2024-05-01')],
      docs: [
        { type: 'Label', submission: 'ORIG-1', url: 'https://x/1.pdf', text: labelText(['Psoriasis'], 'Trial ALPHA (NCT00000001) enrolled adults.') },
        {
          type: 'Label',
          submission: 'SUPPL-2',
          url: 'https://x/2.pdf',
          text: labelText(
            ['Psoriasis', 'Asthma'],
            '14.1 Psoriasis Trial ALPHA (NCT00000001) enrolled adults. 14.2 Asthma Two trials enrolled adults.'
          ),
        },
      ],
    };
    const f = deriveFacts(real, drug);
    expect(f.label).toBe('SUPPL-2');
    expect(f.uses).toEqual({ Psoriasis: '2020-01-01 ORIG-1', Asthma: '2024-05-01 SUPPL-2' });
    expect(f.roles).toEqual({ ALPHA: ['pivotal for Psoriasis'] });
  });
});
