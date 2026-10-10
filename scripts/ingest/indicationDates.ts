import type { DateValue, Milestone, Provenance } from '../../src/schema/index.js';
import { extractIndicationList } from './roles.js';

export interface LabelDoc {
  submission: string;
  url: string;
  text: string;
}

export interface IndicationApproval {
  date: DateValue;
  submission: string;
  provenance: Provenance;
}

/** Tolerates the typographic drift between label versions (curly vs straight apostrophes, spaced hyphens). */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[‘’']/g, "'").replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * Dates each indication by the earliest approved label that lists it in
 * section 1. Every supplement ships the full label as approved with it, so
 * the first one naming an indication is the supplement that added it.
 *
 * Only trusted when that supplement is the original approval or an
 * openFDA "Efficacy" supplement — the class that adds indications. If the
 * first appearance is anything else, the label that actually added it
 * probably failed to download or parse, and the later date would be wrong;
 * that indication is left undated rather than guessed.
 */
export function dateIndications(
  names: string[],
  labels: LabelDoc[],
  milestones: Milestone[]
): Map<string, IndicationApproval> {
  const milestoneFor = new Map(milestones.flatMap((m) => (m.submissionNumber ? [[m.submissionNumber, m]] : [])));
  const dated = labels
    .map((doc) => ({ doc, milestone: milestoneFor.get(doc.submission) }))
    .filter((l): l is { doc: LabelDoc; milestone: Milestone } => l.milestone !== undefined)
    .sort((a, b) => a.milestone.date.value.localeCompare(b.milestone.date.value))
    .map((l) => ({ ...l, names: new Set(extractIndicationList(l.doc.text).map((e) => normalizeName(e.name))) }));

  const out = new Map<string, IndicationApproval>();
  for (const name of names) {
    const first = dated.find((l) => l.names.has(normalizeName(name)));
    if (!first) continue;
    const { doc, milestone } = first;
    const addsIndications = milestone.type === 'FDA_APPROVAL' || /efficacy/i.test(milestone.description ?? '');
    if (!addsIndications) continue;
    out.set(name, {
      date: milestone.date,
      submission: doc.submission,
      provenance: {
        sourceUrl: doc.url,
        sourceLabel: `Approved label (${doc.submission})`,
        quote: `First listed in section 1 of the label approved with ${doc.submission}.`,
        extractedBy: 'rule',
        verified: false,
      },
    });
  }
  return out;
}
