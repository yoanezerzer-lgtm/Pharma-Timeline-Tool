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
