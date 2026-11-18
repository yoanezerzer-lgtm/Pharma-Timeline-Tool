import type { Approval, DateValue, Trial } from '../../schema/index.js';
import { formatDate } from '../../lib/dates.js';
import { APPROVAL_KIND } from '../../lib/copy.js';

/** An approval to mark on the strip: its date and what kind of letter it was. */
export type TimelineApproval = Pick<Approval, 'date' | 'kind'> & { submission?: string };

/** A date as a fractional year, for placing it along the axis. */
function yearPosition(v: string): number {
  const [y, m, d] = v.split('-').map(Number);
  return y + (m - 1) / 12 + (d - 1) / 365;
}

/**
 * One trial on a line of years: a bar from start to study completion, a dot
 * at primary completion (and at the results announcement, when dated), and a
 * diamond on a stem for each approval it sits beside. Shown only when the
 * trial has a start date and something to set it against.
 */
export function TrialTimeline({ trial, approvals }: { trial: Trial; approvals: TimelineApproval[] }) {
  const start = trial.startDate;
  const end = trial.completionDate ?? trial.primaryCompletionDate;
  if (!start || !end) return null;

  const points: DateValue[] = [start, end, ...approvals.map((a) => a.date)];
  const first = Math.floor(Math.min(...points.map((p) => yearPosition(p.value))));
  const last = Math.max(first + 2, Math.ceil(Math.max(...points.map((p) => yearPosition(p.value))) + 0.01));
  const span = last - first;
  const at = (v: string) => ((yearPosition(v) - first) / span) * 100;
  const step = span > 12 ? 2 : 1;
  const years: number[] = [];
  for (let y = first; y <= last; y += step) years.push(y);

  const kinds = [...new Set(approvals.map((a) => a.kind))];
  const pc = trial.primaryCompletionDate;

  return (
    <figure className="tt" aria-label="Trial timeline">
      <div className="tt__track">
        <div className="tt__axis" />
        {years.map((y) => (
          <span key={y} className="tt__year nums" style={{ left: `${((y - first) / span) * 100}%` }}>
            {y}
          </span>
        ))}
        <span
          className="tt__bar"
          style={{ left: `${at(start.value)}%`, width: `${Math.max(at(end.value) - at(start.value), 0.8)}%` }}
          title={`${formatDate(start)} to ${formatDate(end)}`}
        />
        {pc && <span className="tt__dot" style={{ left: `${at(pc.value)}%` }} title={`Primary completion ${formatDate(pc)}`} />}
        {trial.readoutDate && (
          <span className="tt__dot tt__dot--readout" style={{ left: `${at(trial.readoutDate.value)}%` }} title={`Results announced ${formatDate(trial.readoutDate)}`} />
        )}
        {approvals.map((a) => {
          const x = at(a.date.value);
          return (
            <span
              key={`${a.submission ?? a.kind}-${a.date.value}`}
              className={`tt__marker tt__marker--${a.kind}${x > 65 ? ' tt__marker--end' : ''}`}
              style={{ left: `${x}%` }}
              tabIndex={0}
              aria-label={`${APPROVAL_KIND[a.kind]}, ${formatDate(a.date)}`}
            >
              <span className="tt__stem" aria-hidden="true" />
              <span className="tt__diamond" aria-hidden="true" />
              <span className="tt__tip" aria-hidden="true">
                <span className="tt__tip-name">{APPROVAL_KIND[a.kind]}</span>
                <span className="tt__tip-meta nums">
                  {formatDate(a.date)}
                  {a.submission ? ` · ${a.submission}` : ''}
                </span>
              </span>
            </span>
          );
        })}
      </div>
      <ul className="tt__legend" aria-label="Legend">
        <li>
          <span className="tt__key tt__key--bar" aria-hidden="true" />
          Trial
        </li>
        {pc && (
          <li>
            <span className="tt__key tt__key--dot" aria-hidden="true" />
            Primary completion
          </li>
        )}
        {trial.readoutDate && (
          <li>
            <span className="tt__key tt__key--dot tt__key--readout" aria-hidden="true" />
            Results announced
          </li>
        )}
        {kinds.map((k) => (
          <li key={k}>
            <span className={`tt__key tt__key--diamond tt__key--${k}`} aria-hidden="true" />
            {APPROVAL_KIND[k]}
          </li>
        ))}
      </ul>
      <p className="tt__dates nums">
        {[
          `Start ${formatDate(start)}`,
          pc && `Primary completion ${formatDate(pc)}`,
          trial.readoutDate && `Results announced ${formatDate(trial.readoutDate)}`,
          trial.completionDate && `Study completion ${formatDate(trial.completionDate)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </figure>
  );
}

/** A use's approvals, oldest first; a use with no letters on file falls back to its first approval date. */
export function timelineApprovals(use: {
  approvals?: Approval[];
  approvalDate?: DateValue;
  submissionNumber?: string;
}): TimelineApproval[] {
  if (use.approvals?.length) {
    return [...use.approvals]
      .sort((a, b) => a.date.value.localeCompare(b.date.value))
      .map((a) => ({ date: a.date, kind: a.kind, submission: a.submission }));
  }
  return use.approvalDate ? [{ date: use.approvalDate, kind: 'new', submission: use.submissionNumber }] : [];
}
