import type { Indication } from '../../schema/index.js';
import { formatDate, toTime } from '../../lib/dates.js';
import { indicationLabel } from '../../lib/drugs.js';
import './IndicationTimeline.css';

const DAY = 86_400_000;

/**
 * Every approved indication as one row, in approval order, with a dot on a
 * shared time axis — the drug's expansion story at a glance. Rows rather than
 * one horizontal strip because approvals cluster (four of Rinvoq's within
 * five months) and a single line of labels would collide. Each row links to
 * that indication's page, so this doubles as the indication switcher.
 */
export function IndicationTimeline({
  indications,
  currentSlug,
  hrefFor,
}: {
  indications: Indication[];
  currentSlug: string;
  hrefFor: (slug: string) => string;
}) {
  const dated = indications
    .filter((i) => i.approvalDate)
    .sort((a, b) => a.approvalDate!.value.localeCompare(b.approvalDate!.value));
  const undated = indications.filter((i) => !i.approvalDate);

  const times = dated.map((i) => toTime(i.approvalDate!));
  // Half a year of padding keeps the first and last dots off the track ends;
  // also gives a lone date a non-zero domain.
  const min = Math.min(...times) - 180 * DAY;
  const max = Math.max(...times) + 180 * DAY;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;

  const firstYear = new Date(min).getUTCFullYear() + 1;
  const lastYear = new Date(max).getUTCFullYear();
  const years: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);
  // Thin the axis labels if there are too many years to fit legibly.
  const step = Math.ceil(years.length / 8);

  return (
    <section className="ind-timeline" aria-label="Approved indications">
      <h2>
        Approved indications <span className="ind-timeline__count">{indications.length}</span>
      </h2>
      {dated.length > 0 && (
        <div className="ind-timeline__axis" aria-hidden="true">
          <div />
          <div className="ind-timeline__years">
            {years.map((y, i) =>
              i % step === 0 ? (
                <span key={y} style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }}>
                  {y}
                </span>
              ) : null
            )}
          </div>
          <div />
        </div>
      )}
      <ol className="ind-timeline__rows">
        {[...dated, ...undated].map((i) => {
          const current = i.slug === currentSlug;
          const label = indicationLabel(i);
          return (
            <li key={i.slug}>
              <a
                href={hrefFor(i.slug)}
                className={`ind-timeline__row${current ? ' is-current' : ''}`}
                aria-current={current ? 'page' : undefined}
                title={i.name}
              >
                <span className="ind-timeline__name">{label}</span>
                <span className="ind-timeline__track" aria-hidden="true">
                  {years.map((y) => (
                    <span key={y} className="ind-timeline__gridline" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }} />
                  ))}
                  {i.approvalDate && (
                    <span className="ind-timeline__dot" style={{ left: `${pct(toTime(i.approvalDate))}%` }} />
                  )}
                </span>
                <span className="ind-timeline__date">
                  {i.approvalDate ? formatDate(i.approvalDate) : 'Date not determined'}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
