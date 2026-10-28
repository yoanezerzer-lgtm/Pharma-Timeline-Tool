import type { DateValue, Drug, Provenance, Trial } from '../../src/schema/index.js';
import { runByApplicant } from '../ingest/roles.js';
import { getSpec } from '../ingest/registry.js';

/**
 * Rule-based quality checks on one drug record. Each finding names the value
 * it is about, so the overnight fixer (or a person) can go straight to it.
 *
 * - `error`: the record contradicts itself or its own sources; CI fails.
 * - `warn`: plausible but unusual, worth a look (a Phase 4 trial marked
 *   pivotal, an indication with no date). Reported, never blocking.
 */
export type Severity = 'error' | 'warn';

export interface Finding {
  severity: Severity;
  code: string;
  /** Where in the record, e.g. "indications[psoriatic-arthritis].approvalDate". */
  path: string;
  message: string;
}

/** Trials had to be registered from this date (FDAAA 801), so later approvals should cite registered trials. */
const REGISTRATION_REQUIRED = '2007-09-27';

const UNUSUAL_PIVOTAL_PHASES = new Set<Trial['phase']>(['EARLY_PHASE1', 'PHASE1', 'PHASE4']);

// A date known only to the year can't be ordered against a day.
const comparable = (d: DateValue | undefined): d is DateValue => !!d && d.precision !== 'year';

function trialName(t: Trial): string {
  return t.acronym ?? t.labelName ?? t.nctId ?? t.id;
}

function duplicates<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const dup = new Set<T>();
  for (const i of items) (seen.has(i) ? dup : seen).add(i);
  return [...dup];
}

function checkProvenance(p: Provenance, path: string, out: Finding[]): void {
  if (p.extractedBy === 'seed') {
    out.push({ severity: 'error', code: 'placeholder-value', path, message: 'Hand-authored placeholder with no source; replace it from a source or remove it.' });
    return;
  }
  if (p.extractedBy !== 'human' && !p.sourceUrl) {
    out.push({ severity: 'error', code: 'provenance-no-source', path, message: `Extracted by ${p.extractedBy} but has no source link.` });
  }
  if (p.extractedBy === 'regex' && !p.quote) {
    out.push({ severity: 'warn', code: 'provenance-no-quote', path, message: 'Read out of a document but no passage was kept to check it against.' });
  }
}

export function checkDrug(drug: Drug): Finding[] {
  const out: Finding[] = [];
  const indicationNames = new Set(drug.indications.map((i) => i.name));
  const milestoneFor = new Map(drug.milestones.flatMap((m) => (m.submissionNumber ? [[m.submissionNumber, m]] : [])));

  for (const id of duplicates(drug.trials.map((t) => t.id))) {
    out.push({ severity: 'error', code: 'duplicate-trial', path: `trials[${id}]`, message: 'Two trials share this id.' });
  }
  for (const nct of duplicates(drug.trials.flatMap((t) => (t.nctId ? [t.nctId] : [])))) {
    out.push({ severity: 'error', code: 'duplicate-nct', path: `trials[${nct}]`, message: 'Two trials share this NCT number.' });
  }
  for (const slug of duplicates(drug.indications.map((i) => i.slug))) {
    out.push({ severity: 'error', code: 'duplicate-indication', path: `indications[${slug}]`, message: 'Two indications share this slug.' });
  }
  for (const sub of duplicates(drug.milestones.flatMap((m) => (m.submissionNumber ? [m.submissionNumber] : [])))) {
    out.push({ severity: 'error', code: 'duplicate-submission', path: `milestones[${sub}]`, message: 'Two milestones share this submission number.' });
  }

  const original = drug.regulatory.us.originalApprovalDate;
  const origMilestone = drug.milestones.find((m) => m.type === 'FDA_APPROVAL' && m.region === 'US');
  if (original && origMilestone && origMilestone.date.value !== original.value) {
    out.push({
      severity: 'error',
      code: 'original-approval-mismatch',
      path: 'regulatory.us.originalApprovalDate',
      message: `Original approval is ${original.value} but the approval milestone says ${origMilestone.date.value}.`,
    });
  }

  for (const ind of drug.indications) {
    const path = `indications[${ind.slug}]`;
    if (!ind.approvalDate) {
      out.push({ severity: 'warn', code: 'indication-undated', path: `${path}.approvalDate`, message: `No approval date for "${ind.name}".` });
    } else {
      if (original && ind.approvalDate.value < original.value) {
        out.push({
          severity: 'error',
          code: 'approval-before-original',
          path: `${path}.approvalDate`,
          message: `Approved ${ind.approvalDate.value}, before the drug's first approval (${original.value}).`,
        });
      }
      if (ind.submissionNumber) {
        const m = milestoneFor.get(ind.submissionNumber);
        if (!m) {
          out.push({ severity: 'error', code: 'approval-unknown-submission', path: `${path}.submissionNumber`, message: `${ind.submissionNumber} is not among the drug's FDA submissions.` });
        } else if (m.date.value !== ind.approvalDate.value) {
          out.push({
            severity: 'error',
            code: 'approval-date-mismatch',
            path: `${path}.approvalDate`,
            message: `Dated ${ind.approvalDate.value} but ${ind.submissionNumber} was approved ${m.date.value}.`,
          });
        }
      }
    }
    if (ind.approvalProvenance) checkProvenance(ind.approvalProvenance, `${path}.approvalProvenance`, out);

    const pivotal = drug.trials.filter((t) => t.roles.some((r) => r.indication === ind.name && r.role === 'PIVOTAL'));
    const registryEra = !ind.approvalDate || ind.approvalDate.value >= REGISTRATION_REQUIRED;
    if (pivotal.length === 0 && registryEra) {
      out.push({ severity: 'warn', code: 'indication-no-pivotal', path, message: `No pivotal trial found for "${ind.name}".` });
    }
  }

  for (const t of drug.trials) {
    const path = `trials[${t.id}]`;
    if (comparable(t.startDate) && comparable(t.primaryCompletionDate) && t.startDate.value > t.primaryCompletionDate.value) {
      out.push({ severity: 'error', code: 'trial-date-order', path: `${path}.primaryCompletionDate`, message: `${trialName(t)} reads out (${t.primaryCompletionDate.value}) before it starts (${t.startDate.value}).` });
    }
    if (comparable(t.primaryCompletionDate) && comparable(t.completionDate) && t.primaryCompletionDate.value > t.completionDate.value) {
      out.push({ severity: 'error', code: 'trial-date-order', path: `${path}.completionDate`, message: `${trialName(t)} completes (${t.completionDate.value}) before its primary readout (${t.primaryCompletionDate.value}).` });
    }
    for (const [field, p] of Object.entries(t.provenance)) checkProvenance(p, `${path}.provenance.${field}`, out);
    if (t.readoutDate) {
      if (!t.provenance.readoutDate?.quote) {
        out.push({ severity: 'error', code: 'readout-no-quote', path: `${path}.readoutDate`, message: `${trialName(t)} has a readout date with no release sentence to check it against.` });
      }
      if (comparable(t.primaryCompletionDate) && t.readoutDate.value < t.primaryCompletionDate.value.slice(0, 7)) {
        out.push({ severity: 'warn', code: 'readout-before-completion', path: `${path}.readoutDate`, message: `${trialName(t)}'s results were announced ${t.readoutDate.value}, before its primary completion (${t.primaryCompletionDate.value}).` });
      }
    }

    t.roles.forEach((r, k) => {
      const rpath = `${path}.roles[${k}]`;
      checkProvenance(r.provenance, `${rpath}.provenance`, out);
      if (r.indication !== undefined && !indicationNames.has(r.indication)) {
        out.push({ severity: 'error', code: 'role-unknown-indication', path: rpath, message: `Role refers to "${r.indication}", which is not one of the drug's indications.` });
        return;
      }
      if (r.role !== 'PIVOTAL') return;
      const name = trialName(t);
      if (t.studyType?.toUpperCase() === 'OBSERVATIONAL') {
        out.push({ severity: 'error', code: 'pivotal-observational', path: rpath, message: `${name} is observational but marked pivotal.` });
      }
      if (UNUSUAL_PIVOTAL_PHASES.has(t.phase)) {
        out.push({ severity: 'warn', code: 'pivotal-phase', path: rpath, message: `${name} is ${t.phase} but marked pivotal for "${r.indication}".` });
      }
      if (!runByApplicant(t, drug.regulatory.us.sponsor ?? drug.sponsor, getSpec(drug.slug)?.knownTrialSponsors)) {
        out.push({ severity: 'warn', code: 'pivotal-not-applicant', path: rpath, message: `${name} was run by ${t.sponsor}, not the applicant.` });
      }
    });
  }

  return out;
}
