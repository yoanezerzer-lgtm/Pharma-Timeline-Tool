import { describe, it, expect } from 'vitest';
import { isBiosimilar, newMedicines, slugFor } from '../scripts/ingest/novel.js';

const orig = (date: string, cls?: string) => ({ submission_type: 'ORIG', submission_number: '1', submission_status: 'AP', submission_status_date: date, submission_class_code: cls });
const app = (n: string, generic: string, brand: string, date: string, cls?: string) => ({
  application_number: n,
  openfda: { generic_name: [generic] },
  products: [{ brand_name: brand }],
  submissions: [orig(date, cls), { submission_type: 'SUPPL', submission_number: '5', submission_status: 'AP', submission_status_date: '20260101' }],
});

describe('new medicines from Drugs@FDA', () => {
  const results = [
    app('NDA219000', 'ZORIFERTINIB', 'ZEGFROVY', '20251009', 'TYPE 1'),
    app('NDA219001', 'METFORMIN HYDROCHLORIDE', 'NEWMET', '20251001', 'TYPE 3'),
    app('ANDA219002', 'IBUPROFEN', 'IBUPROFEN', '20251001'),
    app('BLA761400', 'DATOPOTAMAB DERUXTECAN-DLNK', 'DATROWAY', '20250117'),
    app('NDA219003', 'OLDDRUG', 'OLD', '20200101', 'TYPE 1'),
  ];

  it('keeps first approvals of new molecular entities and biologics in range, newest first', () => {
    expect(newMedicines(results, '2025-01-01', '2026-10-29').map((a) => [a.slug, a.applicationType, a.applicationNumber, a.approved])).toEqual([
      ['zorifertinib', 'NDA', '219000', '2025-10-09'],
      ['datopotamab-deruxtecan', 'BLA', '761400', '2025-01-17'],
    ]);
  });

  it('makes slugs from the generic name without the biologic suffix', () => {
    expect(slugFor('RISANKIZUMAB-RZAA')).toBe('risankizumab');
    expect(slugFor('NIVOLUMAB AND RELATLIMAB-RMBW')).toBe('nivolumab-and-relatlimab');
  });

  it('tells a biosimilar by an earlier application with the same base name', () => {
    const [, dato] = newMedicines(results, '2025-01-01', '2026-10-29');
    const humira = app('BLA125057', 'ADALIMUMAB', 'HUMIRA', '20021231');
    const biosim = { ...dato, slug: 'adalimumab', applicationNumber: '761500', genericName: 'ADALIMUMAB-AATY' };
    expect(isBiosimilar(biosim, [humira, app('BLA761500', 'ADALIMUMAB-AATY', 'YUFLYMA', '20250101')])).toBe(true);
    expect(isBiosimilar(dato, [app('BLA761400', 'DATOPOTAMAB DERUXTECAN-DLNK', 'DATROWAY', '20250117')])).toBe(false);
  });
});
