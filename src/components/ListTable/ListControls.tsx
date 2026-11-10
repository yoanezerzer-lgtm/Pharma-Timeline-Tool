import type { Area } from '../../lib/areas.js';

/** Search, area filter and a count, above a list table. */
export function ListControls({
  query,
  onQuery,
  area,
  onArea,
  areas,
  placeholder,
  count,
  noun,
}: {
  query: string;
  onQuery: (q: string) => void;
  area: string;
  onArea: (a: string) => void;
  areas: Area[];
  placeholder: string;
  count: number;
  noun: string;
}) {
  return (
    <div className="index__controls">
      <input className="index__search" type="search" aria-label={placeholder} placeholder={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} />
      <select className="index__area" aria-label="Therapeutic area" value={area} onChange={(e) => onArea(e.target.value)}>
        <option value="">All areas</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <span className="index__count" aria-live="polite">
        {count} {noun}
        {count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

/** A few names, then "+N more" with the rest on hover. */
export function Names({ names, max }: { names: string[]; max: number }) {
  const shown = names.slice(0, max);
  const rest = names.slice(max);
  return (
    <>
      {shown.join(', ')}
      {rest.length > 0 && (
        <span className="list-table__more" title={rest.join(', ')}>
          {' '}
          +{rest.length} more
        </span>
      )}
    </>
  );
}
