import { useMemo, useState } from 'react';
import type { PrecedentRow } from '../../lib/precedent.js';
import { formatDate } from '../../lib/dates.js';
import { drugHref, indicationHref, indicationTrialHref } from '../../lib/router.js';
import { approvalKindLabel, DATE_UNCLEAR, NOT_YET_MATCHED } from '../../lib/copy.js';
import './PrecedentTable.css';

type SortKey = 'date' | 'drug' | 'months';

/**
 * Every FDA approval letter for one disease, one row each: when, which drug,
 * what it covers in the FDA's words, the pivotal trials behind it and how
 * long after them it came. Sortable; can be cut to first approvals only.
 */
export function PrecedentTable({ rows }: { rows: PrecedentRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: 'date', up: true });
  const [firstOnly, setFirstOnly] = useState(false);
  const later = rows.filter((r) => r.kind !== 'new').length;

  const shown = useMemo(() => {
    const list = rows.filter((r) => !firstOnly || r.kind === 'new');
    const value = (r: PrecedentRow): string | number =>
      sort.key === 'date' ? (r.date?.value ?? '9999') : sort.key === 'drug' ? r.brandName : (r.monthsAfterTrials ?? Infinity);
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (sort.up ? c : -c) || (a.date?.value ?? '').localeCompare(b.date?.value ?? '');
    });
  }, [rows, sort, firstOnly]);

  const header = (key: SortKey, label: string, className?: string) => (
    <th scope="col" className={className} aria-sort={sort.key === key ? (sort.up ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, up: s.key === key ? !s.up : true }))}>
        {label}
        <span className="precedent__arrow" aria-hidden="true">
          {sort.key === key ? (sort.up ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div className="precedent">
      {later > 0 && (
        <div className="precedent__filter" role="group" aria-label="Which approvals">
          <button type="button" aria-pressed={!firstOnly} onClick={() => setFirstOnly(false)}>
            All approvals · {rows.length}
          </button>
          <button type="button" aria-pressed={firstOnly} onClick={() => setFirstOnly(true)}>
            First approvals only · {rows.length - later}
          </button>
        </div>
      )}
      <table className="precedent__table">
        <thead>
          <tr>
            {header('date', 'Approved', 'precedent__when')}
            {header('drug', 'Drug', 'precedent__drug')}
            <th scope="col" className="precedent__covers">
              What the FDA approved
            </th>
            <th scope="col" className="precedent__trials">
              Pivotal trials
            </th>
            {header('months', 'Months after trials', 'precedent__months')}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className={r.kind === 'new' ? undefined : 'is-later'}>
              <td className="precedent__when" data-label="Approved">
                <span className={`precedent__kind precedent__kind--${r.kind}`}>{approvalKindLabel(r.kind, r.submissions)}</span>
                {r.date ? (
                  r.letterUrl ? (
                    <a className="nums" href={r.letterUrl} target="_blank" rel="noopener noreferrer" title="FDA approval letter">
                      {formatDate(r.date)} ↗
                    </a>
                  ) : (
                    <span className="nums">{formatDate(r.date)}</span>
                  )
                ) : (
                  <span className="precedent__gap">{DATE_UNCLEAR}</span>
                )}
                <span className="precedent__sub">
                  {r.application}
                  {r.submissions.length > 0 && ` · ${r.submissions.join(', ')}`}
                </span>
              </td>
              <td className="precedent__drug" data-label="Drug">
                <a href={drugHref(r.drugSlug)}>
                  <strong>{r.brandName}</strong>
                </a>
                <span className="precedent__sub">{r.inn}</span>
                <span className="precedent__sub">{r.company}</span>
              </td>
              <td className="precedent__covers" data-label="What the FDA approved">
                {r.covers}
              </td>
              <td className="precedent__trials" data-label="Pivotal trials">
                {r.trials && r.trials.length > 0 ? (
                  <ul>
                    {r.trials.map((t) => (
                      <li key={t.id}>
                        <a href={indicationTrialHref(r.drugSlug, r.indicationSlug, t.id)} title={t.nctId}>
                          {t.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <a className="precedent__gap" href={indicationHref(r.drugSlug, r.indicationSlug)}>
                    {NOT_YET_MATCHED}
                  </a>
                )}
              </td>
              <td className="precedent__months nums" data-label="Months after trials">
                {r.monthsAfterTrials ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
