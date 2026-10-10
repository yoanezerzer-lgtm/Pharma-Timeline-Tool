import type { PostedOutcome } from '../../schema/index.js';

function formatValue(m: PostedOutcome['measurements'][number]): string {
  if (m.lowerLimit !== undefined && m.upperLimit !== undefined) return `${m.value} (${m.lowerLimit} to ${m.upperLimit})`;
  if (m.spread !== undefined) return `${m.value} ± ${m.spread}`;
  return m.value;
}

function formatP(p: string): string {
  return /^[<>≤≥]/.test(p.trim()) ? `p ${p.trim()}` : `p = ${p.trim()}`;
}

/** Posted primary-outcome results, shown exactly as the sponsor reported them. */
export function PostedResults({ outcomes, sourceUrl }: { outcomes: PostedOutcome[]; sourceUrl?: string }) {
  return (
    <div className="posted-results">
      {outcomes.map((o, i) => {
        const groupTitle = new Map(o.groups.map((g) => [g.id, g.title]));
        const hasCategory = o.measurements.some((m) => m.category);
        return (
          <div key={i} className="posted-results__outcome">
            <p className="posted-results__title">{o.title}</p>
            {(o.timeFrame || o.unitOfMeasure) && (
              <p className="posted-results__meta">{[o.unitOfMeasure, o.timeFrame].filter(Boolean).join(' · ')}</p>
            )}
            {o.measurements.length > 0 && (
              <table className="posted-results__table">
                <tbody>
                  {o.measurements.map((m, j) => (
                    <tr key={j}>
                      <th scope="row">{groupTitle.get(m.groupId) ?? m.groupId}</th>
                      {hasCategory && <td className="posted-results__category">{m.category}</td>}
                      <td className="posted-results__value">{formatValue(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {o.analyses
              .filter((a) => a.pValue)
              .map((a, j) => (
                <p key={j} className="posted-results__analysis">
                  {a.groupIds.map((id) => groupTitle.get(id) ?? id).join(' vs ')}: {formatP(a.pValue!)}
                  {a.method && <span> ({a.method})</span>}
                </p>
              ))}
          </div>
        );
      })}
      {sourceUrl && (
        <a className="posted-results__source" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          As posted to ClinicalTrials.gov ↗
        </a>
      )}
    </div>
  );
}
