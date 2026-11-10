import { useMemo, useState, type ReactNode } from 'react';
import './ListTable.css';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Sort value; columns without one can't be sorted. Missing values sort last either way. */
  sort?: (row: T) => string | number | undefined;
  /** Newest or largest first on the first click (dates, counts). */
  descFirst?: boolean;
  className?: string;
  /** On phones, show the column's label before the value. */
  phoneLabel?: boolean;
}

/** A full-width, sortable list: one row per item, a header per column, stacked into cards on phones. */
export function ListTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort: { key: string; up: boolean };
  caption: string;
}) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const value = col.sort;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.up ? c : -c;
    });
  }, [rows, columns, sort]);

  return (
    <table className="list-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={c.className}
              aria-sort={c.sort ? (sort.key === c.key ? (sort.up ? 'ascending' : 'descending') : 'none') : undefined}
            >
              {c.sort ? (
                <button type="button" onClick={() => setSort((s) => ({ key: c.key, up: s.key === c.key ? !s.up : !c.descFirst }))}>
                  {c.label}
                  <span className="list-table__arrow" aria-hidden="true">
                    {sort.key === c.key ? (sort.up ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              ) : (
                c.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => (
              <td key={c.key} className={c.className} data-label={c.phoneLabel ? c.label : undefined}>
                {c.render(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
