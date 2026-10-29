import { checkState, type CheckStats } from '../../lib/summary.js';
import './CheckBadge.css';

/**
 * Whether the overnight checker has confirmed a drug's trial links against
 * the FDA's documents. Anything short of all of them stays visibly marked,
 * so unchecked data never passes for checked.
 */
export function CheckBadge({ stats }: { stats: CheckStats }) {
  const state = checkState(stats);
  const text =
    state === 'checked' ? 'Checked' : state === 'partial' ? `Partly checked · ${stats.confirmed} of ${stats.total}` : 'Not yet checked';
  const title =
    state === 'checked'
      ? 'Every trial link has been confirmed against the FDA documents.'
      : state === 'partial'
        ? `${stats.confirmed} of ${stats.total} trial links confirmed against the FDA documents; the rest are not yet checked.`
        : 'Read automatically from FDA documents and ClinicalTrials.gov, not yet checked against them.';
  return (
    <span className={`check-badge check-badge--${state}`} title={title}>
      {text}
    </span>
  );
}

/** The same, as a sentence for the top of a drug page. */
export function checkSentence(stats: CheckStats): string {
  const state = checkState(stats);
  if (state === 'checked') return 'Every trial link on this page has been confirmed against the FDA documents.';
  if (state === 'partial')
    return `${stats.confirmed} of ${stats.total} trial links have been confirmed against the FDA documents. The rest are not yet checked.`;
  return 'Read automatically from FDA documents and ClinicalTrials.gov. Not yet checked against them.';
}
