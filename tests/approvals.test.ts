import { describe, it, expect } from 'vitest';
import type { Milestone, Trial } from '../src/schema/index.js';
import {
  approvalKind,
  approvalNamingTrial,
  approvalStatement,
  approvalsByIndication,
  historyComplete,
  letterPurpose,
  linkRolesToApprovals,
} from '../scripts/ingest/approvals.js';
import type { LabelDoc } from '../scripts/ingest/indicationDates.js';

// Excerpts of real FDA approval letters, as their text layers read.
const RINVOQ_ORIG =
  '<<<PAGE 1>>> NDA 211675 NDA APPROVAL AbbVie Inc. Attention: Juliana Correa Leite-Schnell Director, Regulatory Affairs Please refer to your new drug application (NDA) dated December 18, 2018, received December 18, 2018, and your amendments, submitted under section 505(b) of the Federal Food, Drug, and Cosmetic Act (FDCA) for Rinvoq (upadacitinib) Extended- Release Tablets, 15 mg. This new drug application provides for the use of Rinvoq (upadacitinib) Extended- Release Tablets for the treatment of adults with moderately to severely active rheumatoid arthritis who have had an inadequate response or intolerance to methotrexate. APPROVAL & LABELING We have completed our review of this application, as amended.';

const RINVOQ_PSA =
  'Dear Ms. Smith: Please refer to your supplemental new drug application (sNDA) dated and received June 30, 2020, and your amendments, submitted under section 505(b) of the Federal Food, Drug, and Cosmetic Act (FDCA) for Rinvoq (upadacitinib) extended-release tablets. This Prior Approval supplemental new drug application provides for the addition of the indication of treatment of adults with active psoriatic arthritis who have had an inadequate response or intolerance to one or more TNF blockers. This supplement is based on the results of studies SELECT-PsA 1 and SELECT-PsA 2. APPROVAL & LABELING We have completed our review of this application. POSTMARKETING REQUIREMENTS 4012-1 Complete study SELECT-PsA 3.';

const RINVOQ_CORRECTED =
  'Dear Kenneth Johnson: Please refer to your supplemental new drug applications (sNDA) dated and received January 17, 2025 (NDA 211675/S-028), submitted under section 505(b) of the Federal Food, Drug, and Cosmetic Act (FDCA) for Rinvoq (upadacitinib) extended-release tablets. We also refer to our approval letter dated October 10, 2025, which contained the following error(s): inclusion of a statement (in strikeout) that is not part of the approved labeling. This corrected action letter incorporates the correction of the error. The effective action date will remain October 10, 2025, the date of the original letter. These Prior Approval supplemental new drug applications provide for updates to the INDICATIONS AND USAGE section of the Prescribing Information for the treatment of adults with moderately to severely active ulcerative colitis (UC) and moderately to severely active Crohn’s disease (CD) as shown ( double-underline = addition): 1.4 Ulcerative Colitis RINVOQ is indicated for the treatment of adult patients with moderately to severely active ulcerative colitis (UC) who have had an inadequate response or intolerance to one or more TNF blockers. APPROVAL & LABELING We have completed our review of this application, as amended.';

const SKYRIZI_ORIG =
  'Dear Ms. Konkowski: Please refer to your Biologics License Application (BLA) dated and received April 23, 2018, and your amendments, submitted under section 351(a) of the Public Health Service Act for Skyrizi ( risankizumab - rzaa ) injection, 75 mg/0.83 mL. We also refer to our approval letter date d April 23, 2019 which contained the following error s : inaccuracies with regard to manufacturing locations. This replacement approval letter incorporates the correction of the error s . The effective approval date will remain April 23, 2019 , the date of the original approval letter. LICENSING We have approved your BLA for Skyrizi ( risankizumab - rzaa ) injection, 75 mg/0.83 mL effective this date. You are hereby authorized to in troduce or deliver for introduction into interstate commerce, Skyrizi under your existing Department of Health and Human Services U.S. License No. 1889. Skyrizi is indicated for the treatment of moderate - to - severe plaque psoriasis in adults who are candid ates for systemic therapy or phototherapy. MANUFACTURING LOCATIONS Under this license, you are approved to manufacture risankizumab.';

const KEYTRUDA_S182 =
  'Dear Dr. Cox: Please refer to your supplemental biologics license application (sBLA) received February 25, 2025, and your amendments, submitted under section 351(a) of the Public Health Service Act for KEYTRUDA (pembrolizumab), injection. This Prior Approval supplemental biologics license application updates the KEYTRUDA (pembrolizumab) Prescribing Information (PI) and Medication Guide (MG) revising the following indications to reflect the population [i.e., PD-L1 (CPS ≥1) ] with a favorable risk- benefit assessment: • KEYTRUDA, in combination with fluoropyrimidine- and platinum-containing chemotherapy, is indicated for the first-line treatment of adults with locally advanced unresectable or metastatic HER2-negative gastric or gastroesophageal junction (GEJ) adenocarcinoma whose tumors express PD-L1 (CPS ≥ 1) as determined by an FDA approved tes t. APPROVAL & LABELING We have completed our review of this application, as amended.';

// Page 1 was a scanned image; only the later pages have text.
const KEYTRUDA_S180_NO_FIRST_PAGE =
  '<<<PAGE 1>>> <<<PAGE 2>>> BLA 125514/S-180 Page 2 To facilitate review of your submission(s), provide a highlighted or marked-up copy that shows all changes. POSTMARKETING COMMITMENTS We remind you of your postmarketing commitment: Complete clinical trial, KEYNOTE-689 (NCT03765918).';

const SAFETY_ONLY =
  'Dear Ms. Smith: Please refer to your supplemental new drug application (sNDA) submitted for Rinvoq (upadacitinib). This Prior Approval supplemental new drug application provides for revisions to the WARNINGS AND PRECAUTIONS section of the labeling. APPROVAL & LABELING We have completed our review of this application.';

const letter = (submission: string, text: string): LabelDoc => ({ submission, url: `https://www.accessdata.fda.gov/${submission}.pdf`, text });
const milestone = (submissionNumber: string, date: string, type: Milestone['type'] = 'FDA_SUPPLEMENT', description = 'Efficacy'): Milestone => ({
  id: submissionNumber,
  type,
  region: 'US',
  date: { value: date, precision: 'day' },
  label: submissionNumber,
  description,
  submissionNumber,
});

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, changeLog: [], ...o,
  };
}
const src = { sourceUrl: 'https://www.accessdata.fda.gov/label.pdf', extractedBy: 'rule' as const, verified: false };

describe('letterPurpose', () => {
  it("takes the opening section's sentence about the application", () => {
    expect(letterPurpose(RINVOQ_ORIG)).toMatch(/^This new drug application provides for the use of Rinvoq .* methotrexate\.$/);
  });

  it('skips the preamble of a corrected letter', () => {
    expect(letterPurpose(RINVOQ_CORRECTED)).toMatch(/^These Prior Approval supplemental new drug applications provide for updates to the INDICATIONS AND USAGE/);
  });

  it("uses the LICENSING section's indication when an original biologics letter has no purpose sentence", () => {
    expect(letterPurpose(SKYRIZI_ORIG)).toBe(
      'Skyrizi is indicated for the treatment of moderate - to - severe plaque psoriasis in adults who are candid ates for systemic therapy or phototherapy.'
    );
  });

  it("returns nothing when the letter's first page didn't extract", () => {
    expect(letterPurpose(KEYTRUDA_S180_NO_FIRST_PAGE)).toBeUndefined();
  });
});

describe('approvalKind and approvalStatement', () => {
  it('reads new, wider and revised uses from the wording', () => {
    expect(approvalKind(letterPurpose(RINVOQ_PSA)!)).toBe('new');
    expect(approvalKind('This supplement provides for the expansion of the indication to include pediatric patients.')).toBe('expansion');
    expect(approvalKind(letterPurpose(KEYTRUDA_S182)!)).toBe('revision');
    expect(approvalKind('Prior Approval sBLA 152 (S-152) provides for regular approval, following prior Accelerated Approval, and conversion to full approval.')).toBe('conversion');
    expect(approvalKind(letterPurpose(SAFETY_ONLY)!)).toBe('update');
  });

  it("keeps the letter's first sentence unedited", () => {
    expect(approvalStatement(letterPurpose(RINVOQ_PSA)!)).toBe(
      'This Prior Approval supplemental new drug application provides for the addition of the indication of treatment of adults with active psoriatic arthritis who have had an inadequate response or intolerance to one or more TNF blockers.'
    );
  });
});

describe('approvalsByIndication', () => {
  const names = ['Rheumatoid Arthritis', 'Psoriatic Arthritis', 'Ulcerative Colitis', 'Crohn’s Disease'];
  const letters = [
    letter('ORIG-1', RINVOQ_ORIG),
    letter('SUPPL-2', RINVOQ_PSA),
    letter('SUPPL-28', RINVOQ_CORRECTED),
    letter('SUPPL-30', SAFETY_ONLY),
  ];
  const milestones = [
    milestone('ORIG-1', '2019-08-16', 'FDA_APPROVAL', 'Original'),
    milestone('SUPPL-2', '2021-12-14'),
    milestone('SUPPL-7', '2022-03-16'),
    milestone('SUPPL-28', '2025-10-10'),
    milestone('SUPPL-30', '2025-11-01', 'FDA_SUPPLEMENT', 'Labeling'),
  ];
  const datedBy = new Map([['Rheumatoid Arthritis', 'ORIG-1'], ['Psoriatic Arthritis', 'SUPPL-2'], ['Ulcerative Colitis', 'SUPPL-7']]);
  const history = approvalsByIndication(names, letters, milestones, datedBy);

  it("lists each indication's approvals with the letter's date and wording", () => {
    expect(history.get('Rheumatoid Arthritis')).toEqual([
      expect.objectContaining({ submission: 'ORIG-1', kind: 'new', date: { value: '2019-08-16', precision: 'day' } }),
    ]);
    expect(history.get('Psoriatic Arthritis')?.map((a) => [a.submission, a.kind])).toEqual([['SUPPL-2', 'new']]);
  });

  it('attaches a letter to another indication only when its wording names that use', () => {
    expect(history.get('Ulcerative Colitis')?.map((a) => a.submission)).toEqual(['SUPPL-28']);
    expect(history.get('Crohn’s Disease')?.map((a) => [a.submission, a.kind])).toEqual([['SUPPL-28', 'expansion']]);
    expect(history.get('Psoriatic Arthritis')?.some((a) => a.submission === 'SUPPL-28')).toBe(false);
  });

  it('leaves out letters that only update labeling', () => {
    expect([...history.values()].flat().some((a) => a.submission === 'SUPPL-30')).toBe(false);
  });

  it("uses the label's wording, and says so, when an original letter is unreadable", () => {
    const h = approvalsByIndication(['Melanoma'], [letter('ORIG-1', 'Dear Dr. Smith: Keytmda is indicated for the u·eatment of patients. LICENSING')], [milestone('ORIG-1', '2014-09-04', 'FDA_APPROVAL')], new Map([['Melanoma', 'ORIG-1']]));
    expect(h.get('Melanoma')?.[0]).toMatchObject({ statement: 'Melanoma', provenance: { sourceLabel: expect.stringContaining("wording from the label's section 1") } });
  });

  it('knows when every efficacy letter since the first approval was read', () => {
    expect(historyComplete('2019-08-16', letters, milestones)).toBe(false); // SUPPL-7 has no letter
    expect(historyComplete('2019-08-16', [...letters, letter('SUPPL-7', RINVOQ_PSA)], milestones)).toBe(true);
    expect(historyComplete(undefined, letters, milestones)).toBe(false);
  });
});

describe('linking pivotal trials to approvals', () => {
  const letters = [letter('ORIG-1', RINVOQ_ORIG), letter('SUPPL-2', RINVOQ_PSA)];
  const milestones = [milestone('ORIG-1', '2019-08-16', 'FDA_APPROVAL'), milestone('SUPPL-2', '2021-12-14')];
  const history = approvalsByIndication(['Rheumatoid Arthritis', 'Psoriatic Arthritis'], letters, milestones, new Map([['Rheumatoid Arthritis', 'ORIG-1'], ['Psoriatic Arthritis', 'SUPPL-2']]));

  it("links a trial the letter's opening names, quoting that sentence", () => {
    const link = approvalNamingTrial({ acronym: 'SELECT-PsA 1' }, history.get('Psoriatic Arthritis')!, letters);
    expect(link).toMatchObject({ submission: 'SUPPL-2', provenance: { quote: 'This supplement is based on the results of studies SELECT-PsA 1 and SELECT-PsA 2.' } });
  });

  it('ignores names in later sections, which list required future studies', () => {
    expect(approvalNamingTrial({ acronym: 'SELECT-PsA 3' }, history.get('Psoriatic Arthritis')!, letters)).toBeUndefined();
  });

  it('links to the only approval when the history is complete, and otherwise leaves the trial unlinked', () => {
    const trials = [
      trial({ id: 'compare', acronym: 'SELECT-COMPARE', roles: [{ indication: 'Rheumatoid Arthritis', role: 'PIVOTAL', provenance: src }] }),
      trial({ id: 'psa3', acronym: 'SELECT-PsA 3', roles: [{ indication: 'Psoriatic Arthritis', role: 'PIVOTAL', provenance: src }] }),
    ];
    const linked = linkRolesToApprovals(trials, history, letters, new Set(['Rheumatoid Arthritis']));
    expect(linked[0].roles[0].approval).toMatchObject({ submission: 'ORIG-1', provenance: { sourceLabel: expect.stringContaining('the only approval') } });
    expect(linked[1].roles[0].approval).toBeUndefined();
    expect(linkRolesToApprovals(trials, history, letters, new Set())[0].roles[0].approval).toBeUndefined();
  });
});
