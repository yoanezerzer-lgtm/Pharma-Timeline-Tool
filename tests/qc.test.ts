import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug, type Trial } from '../src/schema/index.js';
import { checkDrug } from '../scripts/qc/checks.js';
import { Reference, scoreAgainstReference, snapshotReference } from '../scripts/qc/reference.js';

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}

const src = { sourceUrl: 'https://www.accessdata.fda.gov/x.pdf', extractedBy: 'rule' as const, verified: false };

function drug(o: Partial<Drug> = {}): Drug {
  return Drug.parse({
    slug: 'testdrug',
    brandName: 'Testa',
    inn: 'testamab',
    modality: 'mAb',
    sponsor: 'Acme',
    regulatory: { us: { applicationNumber: '1', applicationType: 'BLA', sponsor: 'ACME', originalApprovalDate: { value: '2019-01-10', precision: 'day' } } },
    indications: [
      { name: 'Psoriasis', slug: 'psoriasis', approvalDate: { value: '2019-01-10', precision: 'day' }, submissionNumber: 'ORIG-1', approvalProvenance: src },
    ],
    milestones: [
      { id: 'o', type: 'FDA_APPROVAL', region: 'US', date: { value: '2019-01-10', precision: 'day' }, label: 'x', submissionNumber: 'ORIG-1' },
      { id: 's', type: 'FDA_SUPPLEMENT', region: 'US', date: { value: '2021-03-02', precision: 'day' }, label: 'x', submissionNumber: 'SUPPL-4' },
    ],
    trials: [trial({ id: 'ultima', nctId: 'NCT00000001', sponsor: 'Acme Inc.', roles: [{ indication: 'Psoriasis', role: 'PIVOTAL', provenance: src }] })],
    ...o,
  });
}

const codes = (d: Drug) => checkDrug(d).map((f) => `${f.severity}:${f.code}`);

describe('checkDrug', () => {
  it('passes a consistent record', () => {
    expect(checkDrug(drug())).toEqual([]);
  });

  it('catches two indications sharing one page address', () => {
    const d = drug();
    d.indications.push({ ...d.indications[0], name: 'Psoriatic Arthritis' });
    expect(codes(d)).toContain('error:duplicate-indication');
  });

  it("catches an indication date that disagrees with its submission's approval date", () => {
    const d = drug();
    d.indications.push({ name: 'Crohn', slug: 'crohn', approvalDate: { value: '2021-03-01', precision: 'day' }, submissionNumber: 'SUPPL-4', approvalProvenance: src });
    expect(codes(d)).toContain('error:approval-date-mismatch');
  });

  it('catches a role pointing at an indication the drug does not have', () => {
    const d = drug();
    d.trials[0].roles[0].indication = 'Psoriasis (old name)';
    expect(codes(d)).toContain('error:role-unknown-indication');
  });

  it('rejects placeholder values and extracted values with no source', () => {
    const d = drug();
    d.trials[0].provenance.phase = { extractedBy: 'seed', verified: false };
    d.trials[0].provenance.startDate = { extractedBy: 'api', verified: false };
    expect(codes(d)).toEqual(expect.arrayContaining(['error:placeholder-value', 'error:provenance-no-source']));
  });

  it('warns on a Phase 4 or observational pivotal trial', () => {
    const d = drug();
    d.trials[0].phase = 'PHASE4';
    d.trials[0].studyType = 'OBSERVATIONAL';
    expect(codes(d)).toEqual(expect.arrayContaining(['warn:pivotal-phase', 'error:pivotal-observational']));
  });

  it('warns on a registry-era indication with no pivotal trial', () => {
    const d = drug();
    d.trials[0].roles = [];
    expect(codes(d)).toContain('warn:indication-no-pivotal');
  });
});

describe('reference set', () => {
  it('scores confirmed facts and leaves them untouched on a new snapshot', () => {
    const d = drug();
    const ref = Reference.parse({
      slug: 'testdrug',
      indications: [{ name: 'Psoriasis', approvalDate: '2019-01-10', submission: 'ORIG-1', status: 'confirmed' }],
      pivotal: [{ indication: 'Psoriasis', trial: 'NCT00000001', pivotal: false, status: 'confirmed' }],
    });
    const results = scoreAgainstReference(d, ref);
    expect(results.map((r) => r.pass)).toEqual([true, false]);

    const snap = snapshotReference(d, ref);
    expect(snap.pivotal).toEqual(ref.pivotal);
    expect(snap.indications).toEqual(ref.indications);
  });

  it('adds what the pipeline currently says as baseline', () => {
    const snap = snapshotReference(drug());
    expect(snap.indications[0]).toMatchObject({ approvalDate: '2019-01-10', status: 'baseline' });
    expect(snap.pivotal).toEqual([{ indication: 'Psoriasis', trial: 'NCT00000001', pivotal: true, status: 'baseline' }]);
  });

  const REF_DIR = join(process.cwd(), 'data', 'reference');
  it.each(readdirSync(REF_DIR).filter((f) => f.endsWith('.json')))('%s matches a committed drug record', (file) => {
    const ref = Reference.parse(JSON.parse(readFileSync(join(REF_DIR, file), 'utf8')));
    expect(`${ref.slug}.json`).toBe(file);
    expect(readdirSync(join(process.cwd(), 'data', 'drugs'))).toContain(file);
  });
});
