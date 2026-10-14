import { describe, it, expect } from 'vitest';
import { dateIndications, type LabelDoc } from '../scripts/ingest/indicationDates.js';
import type { Milestone } from '../src/schema/index.js';

function label(submission: string, ...names: string[]): LabelDoc {
  const toc = names.map((n, i) => `1.${i + 1} ${n}`).join(' ');
  return {
    submission,
    url: `https://www.accessdata.fda.gov/${submission}.pdf`,
    text: `FULL PRESCRIBING INFORMATION: CONTENTS 1 INDICATIONS AND USAGE ${toc} 2 DOSAGE AND ADMINISTRATION`,
  };
}

function milestone(submission: string, date: string, description: string): Milestone {
  return {
    id: submission.toLowerCase(),
    type: submission === 'ORIG-1' ? 'FDA_APPROVAL' : 'FDA_SUPPLEMENT',
    region: 'US',
    date: { value: date, precision: 'day' },
    label: submission,
    submissionNumber: submission,
    description,
  };
}

function letter(submission: string, text: string): LabelDoc {
  return { submission, url: `https://www.accessdata.fda.gov/${submission}ltr.pdf`, text };
}

const milestones = [
  milestone('ORIG-1', '2019-08-16', 'Type 1 - New Molecular Entity'),
  milestone('SUPPL-1', '2020-07-10', 'Labeling'),
  milestone('SUPPL-2', '2021-12-14', 'Efficacy'),
  milestone('SUPPL-4', '2022-01-14', 'Efficacy'),
];

describe('dateIndications', () => {
  it('dates each indication by the earliest label that lists it, whatever order the documents arrive in', () => {
    const labels = [
      label('SUPPL-4', 'Rheumatoid Arthritis', 'Psoriatic Arthritis', 'Atopic Dermatitis'),
      label('ORIG-1', 'Rheumatoid Arthritis'),
      label('SUPPL-2', 'Rheumatoid Arthritis', 'Psoriatic Arthritis'),
    ];
    const result = dateIndications(['Rheumatoid Arthritis', 'Psoriatic Arthritis', 'Atopic Dermatitis'], labels, milestones);
    expect(result.get('Rheumatoid Arthritis')?.date.value).toBe('2019-08-16');
    expect(result.get('Psoriatic Arthritis')?.date.value).toBe('2021-12-14');
    expect(result.get('Atopic Dermatitis')?.submission).toBe('SUPPL-4');
    expect(result.get('Atopic Dermatitis')?.provenance).toMatchObject({
      sourceUrl: 'https://www.accessdata.fda.gov/SUPPL-4.pdf',
      extractedBy: 'rule',
      verified: false,
    });
  });

  it('matches across typographic drift between label versions', () => {
    const labels = [label('ORIG-1', 'Rheumatoid Arthritis'), label('SUPPL-2', 'Rheumatoid Arthritis', "Crohn's Disease")];
    const result = dateIndications(['Crohn’s Disease'], labels, milestones);
    expect(result.get('Crohn’s Disease')?.date.value).toBe('2021-12-14');
  });

  it('leaves an indication undated when it first appears in a non-Efficacy supplement', () => {
    // The supplement that really added it must have failed to parse; the
    // labeling-only supplement's date would be wrong.
    const labels = [label('ORIG-1', 'Rheumatoid Arthritis'), label('SUPPL-1', 'Rheumatoid Arthritis', 'Psoriatic Arthritis')];
    const result = dateIndications(['Psoriatic Arthritis'], labels, milestones);
    expect(result.has('Psoriatic Arthritis')).toBe(false);
  });

  it('ignores a label whose submission has no matching milestone', () => {
    const result = dateIndications(['Rheumatoid Arthritis'], [label('SUPPL-99', 'Rheumatoid Arthritis')], milestones);
    expect(result.size).toBe(0);
  });
});

describe('dateIndications — real-label quirks', () => {
  const ms = [
    milestone('ORIG-1', '2014-09-04', 'Type 1 - New Molecular Entity'),
    milestone('SUPPL-9', '2016-08-05', 'Efficacy'),
    milestone('SUPPL-37', '2018-12-28', 'Efficacy'),
    milestone('SUPPL-17', '2017-05-18', 'Efficacy'),
    milestone('SUPPL-18', '2017-05-18', 'Efficacy'),
    milestone('SUPPL-14', '2017-05-23', 'Efficacy'),
    milestone('SUPPL-79', '2020-04-28', 'Efficacy'),
    milestone('SUPPL-92', '2020-06-24', 'Efficacy'),
    milestone('SUPPL-84', '2020-06-29', 'Efficacy'),
  ];

  it('matches a section renamed between label versions (Keytruda head and neck)', () => {
    const labels = [
      label('ORIG-1', 'Melanoma'),
      label('SUPPL-9', 'Melanoma', 'Head and Neck Cancer'),
      label('SUPPL-37', 'Melanoma', 'Head and Neck Squamous Cell Cancer'),
    ];
    const r = dateIndications(['Head and Neck Squamous Cell Cancer'], labels, ms);
    expect(r.get('Head and Neck Squamous Cell Cancer')?.date.value).toBe('2016-08-05');
  });

  it('dates the original indication from an unnumbered single-sentence label', () => {
    const orig: LabelDoc = {
      submission: 'ORIG-1',
      url: 'https://x/orig.pdf',
      text: '1 INDICATIONS AND USAGE KEYTRUDA is indicated for the treatment of patients with unresectable or metastatic melanoma. 2 DOSAGE AND ADMINISTRATION',
    };
    const r = dateIndications(['Melanoma'], [orig, label('SUPPL-9', 'Melanoma', 'Head and Neck Cancer')], ms);
    expect(r.get('Melanoma')?.date.value).toBe('2014-09-04');
  });

  it('ignores a label file that is a later revision filed under an older supplement', () => {
    // SUPPL-79 (April) lists CRC, which the June 24 label drops and June 29 adds.
    const labels = [
      label('ORIG-1', 'Melanoma'),
      label('SUPPL-79', 'Melanoma', 'TMB-High Cancer', 'Colorectal Cancer'),
      label('SUPPL-92', 'Melanoma', 'TMB-High Cancer'),
      label('SUPPL-84', 'Melanoma', 'TMB-High Cancer', 'Colorectal Cancer'),
    ];
    const r = dateIndications(['Colorectal Cancer'], labels, ms);
    expect(r.get('Colorectal Cancer')?.date.value).toBe('2020-06-29');
  });

  it('uses approval letters to find the supplement whose own label file is an older revision', () => {
    // Keytruda: both May 18, 2017 urothelial supplements carry a label without urothelial.
    const labels = [
      label('ORIG-1', 'Melanoma'),
      label('SUPPL-18', 'Melanoma'),
      label('SUPPL-14', 'Melanoma', 'Urothelial Cancer', 'Microsatellite Instability-High Cancer'),
    ];
    const letters = [
      letter('ORIG-1', 'approval for unresectable or metastatic melanoma'),
      letter('SUPPL-17', 'provides for the treatment of locally advanced or metastatic urothelial carcinoma'),
      letter('SUPPL-14', 'provides for microsatellite instability-high cancer'),
    ];
    const r = dateIndications(['Urothelial Cancer', 'Microsatellite Instability-High Cancer'], labels, ms, letters);
    expect(r.get('Urothelial Cancer')).toMatchObject({ submission: 'SUPPL-17', date: { value: '2017-05-18' } });
    expect(r.get('Microsatellite Instability-High Cancer')?.date.value).toBe('2017-05-23');
  });

  it('leaves an indication undated when the label before its first appearance is unreadable', () => {
    const garbled: LabelDoc = { submission: 'SUPPL-9', url: 'https://x/9.pdf', text: 'scanned image, no text layer' };
    const labels = [label('ORIG-1', 'Melanoma'), garbled, label('SUPPL-37', 'Melanoma', 'Head and Neck Cancer')];
    expect(dateIndications(['Head and Neck Cancer'], labels, ms).has('Head and Neck Cancer')).toBe(false);
  });

  it('reads an old-format label (before numbered sections) as text to search', () => {
    const lexMs = [milestone('ORIG-1', '2002-08-14', 'Type 1'), milestone('SUPPL-3', '2003-12-18', 'Efficacy'), milestone('SUPPL-58', '2023-05-12', 'Efficacy')];
    const old = (sub: string, body: string): LabelDoc => ({ submission: sub, url: `https://x/${sub}.pdf`, text: `INDICATIONS AND USAGE ${body} CONTRAINDICATIONS` });
    const labels = [
      old('ORIG-1', 'Major Depressive Disorder Lexapro is indicated for the treatment of major depressive disorder.'),
      old('SUPPL-3', 'Major Depressive Disorder … Generalized Anxiety Disorder Lexapro is indicated for generalized anxiety disorder.'),
      {
        submission: 'SUPPL-58',
        url: 'https://x/58.pdf',
        text: '1 INDICATIONS AND USAGE Lexapro is indicated for the treatment of: • major depressive disorder (MDD) in adults. • generalized anxiety disorder (GAD) in adults. 2 DOSAGE AND ADMINISTRATION',
      },
    ];
    const names = ['Major depressive disorder (MDD) in adults', 'Generalized anxiety disorder (GAD) in adults'];
    const r = dateIndications(names, labels, lexMs);
    expect(r.get(names[0])?.date.value).toBe('2002-08-14');
    expect(r.get(names[1])?.date.value).toBe('2003-12-18');
  });
});
