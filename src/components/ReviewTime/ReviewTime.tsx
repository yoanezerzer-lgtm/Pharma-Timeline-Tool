import { useEffect, useState, type ReactNode } from 'react';
import { formatDate, toDateValue } from '../../lib/dates.js';
import { indicationHref } from '../../lib/router.js';
import { MIN_SAMPLE, PrecedentFile, percent, reviewDays, reviewStats, type PrecedentProduct, type ValueSource } from '../../lib/reviewTime.js';
import type { Severity } from '../../lib/diseases.js';
import { Info } from '../Info/Info.js';
import './ReviewTime.css';

// One small file per disease, fetched only when its page opens.
const loaders = import.meta.glob<{ default: unknown }>('../../../data/precedent/*.json');

export function usePrecedent(meshId: string): PrecedentFile | null | undefined {
  const [file, setFile] = useState<PrecedentFile | null | undefined>(undefined);
  useEffect(() => {
    const load = loaders[`../../../data/precedent/${meshId}.json`];
    if (!load) return setFile(null);
    let live = true;
    load().then((m) => live && setFile(PrecedentFile.parse(m.default)), () => live && setFile(null));
    return () => {
      live = false;
    };
  }, [meshId]);
  return file;
}

const isoDay = (iso?: string) => (iso ? formatDate(toDateValue(iso)) : undefined);

/** A small mono chip naming where numbers come from and how fresh they are. */
export function DataChip({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <span className={warn ? 'data-chip data-chip--warn' : 'data-chip'}>{children}</span>;
}

/** A value linking to its record, with the source in its tooltip. */
function Linked({ source, children }: { source?: ValueSource; children: ReactNode }) {
  if (!source) return <>{children}</>;
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.quote ? `${source.label}: “${source.quote}”` : source.label}>
      {children}
    </a>
  );
}

/**
 * How long the FDA took to review comparable approvals in this disease,
 * from the application's receipt to its approval. Shown on the disease
 * page for the severity group in view.
 */
export function ReviewTime({ meshId, severity, split }: { meshId: string; severity: Severity; split: boolean }) {
  const file = usePrecedent(meshId);
  if (file === undefined) return null;
  if (file === null || file.products.length === 0) return null;
  const products = split ? file.products.filter((p) => p.severity === severity) : file.products;
  const left = file.products.length - products.length;
  const stats = reviewStats(products);
  const dataOf = isoDay(file.openFdaUpdated);
  const read = isoDay(file.retrievedAt);
  const lettersRead = products.filter((p) => p.accelerated !== undefined).length;
  const acc = percent(stats.accelerated.yes, stats.accelerated.known);
  const exp = percent(stats.expedited.yes, stats.expedited.total);

  return (
    <section className="review-time" aria-labelledby="review-time-head">
      <div className="disease__timeline-head">
        <h2 id="review-time-head">
          FDA review time
          <Info label="About review time">
            Days from the FDA receiving the application to approving it, for comparable approvals: each use on this
            site (its first approval), and other new medicines whose current label names this disease (their first
            approval, which may have been for another use). Receipt dates are read from the FDA’s approval letters;
            the rest comes from openFDA’s Drugs@FDA records. The count runs from the first receipt, so it includes any
            resubmission after the FDA turned an application down (a complete response letter). A median is shown only when at least {MIN_SAMPLE} products
            have both dates.
          </Info>
        </h2>
      </div>
      <p className="review-time__lede">
        How long past reviews took. Not a forecast: it does not say when a future review will end.
      </p>

      <div className="review-time__chips">
        {dataOf && <DataChip>openFDA · data of {dataOf}</DataChip>}
        {read && <DataChip>FDA letters · read {read}</DataChip>}
        <DataChip warn>openFDA only: breakthrough and fast track designations are not recorded</DataChip>
        <DataChip warn>Other products found by label wording only: approvals whose label words it differently are missing</DataChip>
      </div>

      <div className="review-time__tiles">
        <div className="review-time__tile">
          <span className="review-time__tile-label">Median review time</span>
          {stats.median !== undefined ? (
            <>
              <span className="review-time__tile-value">{stats.median} days</span>
              <span className="review-time__tile-note">
                n = {stats.days.length} of {stats.total} with both dates · ≈ {(stats.median / 30.44).toFixed(1)} months
              </span>
            </>
          ) : (
            <>
              <span className="review-time__tile-gap">
                Not computed: fewer than five products have both dates (n = {stats.days.length})
              </span>
              {stats.days.length > 0 && (
                <span className="review-time__tile-note">
                  {stats.days.map((d) => `${d.brandName} ${d.days} days`).join(' · ')}
                </span>
              )}
            </>
          )}
        </div>
        <div className="review-time__tile">
          <span className="review-time__tile-label">Accelerated approval</span>
          <span className="review-time__tile-value">{acc ?? '—'}</span>
          <span className="review-time__tile-note">
            {stats.accelerated.yes} of {stats.accelerated.known} approval letters say so
            {lettersRead < stats.total && ` · ${stats.total - lettersRead} not available`}
          </span>
        </div>
        <div className="review-time__tile">
          <span className="review-time__tile-label">With an expedited designation</span>
          <span className="review-time__tile-value">{exp ? `≥ ${exp}` : '—'}</span>
          <span className="review-time__tile-note">
            {stats.expedited.yes} of {stats.expedited.total}: accelerated approval or orphan. Breakthrough and fast
            track not in openFDA, so this is a floor.
          </span>
        </div>
      </div>

      <div className="review-time__scroll">
        <table className="precedent__table review-time__table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Pathway</th>
              <th scope="col">Review</th>
              <th scope="col">Expedited</th>
              <th scope="col" className="review-time__num">
                Received
              </th>
              <th scope="col" className="review-time__num">
                Approved
              </th>
              <th scope="col" className="review-time__num">
                Review time
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Row key={`${p.application}-${p.submission}`} p={p} />
            ))}
          </tbody>
        </table>
      </div>
      {left > 0 && (
        <p className="review-time__note">
          {left} {left === 1 ? 'product is' : 'products are'} left out: {left === 1 ? 'its' : 'their'} FDA wording
          names another severity, or none.
        </p>
      )}
    </section>
  );
}

function Row({ p }: { p: PrecedentProduct }) {
  const days = reviewDays(p);
  return (
    <tr>
      <td data-label="Product">
        {p.site ? (
          <a href={indicationHref(p.site.drugSlug, p.site.indicationSlug)}>
            <strong>{p.brandName}</strong>
          </a>
        ) : (
          <strong>{p.brandName}</strong>
        )}
        {p.inn && <span className="precedent__sub">{p.inn}</span>}
        {p.originalOnly && p.indication && (
          <span className="precedent__sub">
            <Linked source={p.indication.source}>Label names it ↗</Linked> · first approval
          </span>
        )}
      </td>
      <td data-label="Pathway" className="review-time__mono">
        <Linked source={p.approvalDate?.source}>{p.application}</Linked>
        <span className="precedent__sub">{p.submission}</span>
      </td>
      <td data-label="Review">
        {p.reviewPriority ? (
          <Linked source={p.reviewPriority.source}>
            <span className={`review-time__badge${p.reviewPriority.value === 'PRIORITY' ? ' is-on' : ''}`}>
              {p.reviewPriority.value === 'PRIORITY' ? 'Priority' : 'Standard'}
            </span>
          </Linked>
        ) : (
          <span className="precedent__gap">Not recorded</span>
        )}
      </td>
      <td data-label="Expedited">
        <span className="review-time__flags">
          {p.accelerated?.value && (
            <Linked source={p.accelerated.source}>
              <span className="review-time__badge is-on">Accelerated</span>
            </Linked>
          )}
          {p.orphan && (
            <Linked source={p.orphan.source}>
              <span className="review-time__badge is-on">Orphan</span>
            </Linked>
          )}
          {!p.accelerated?.value && !p.orphan && <span className="precedent__gap">{p.accelerated ? 'None recorded' : 'Letter not read'}</span>}
        </span>
      </td>
      <td data-label="Received" className="review-time__num review-time__mono">
        {p.receiptDate ? (
          <Linked source={p.receiptDate.source}>{formatDate(p.receiptDate.value)}</Linked>
        ) : (
          <span className="precedent__gap">{p.accelerated ? 'Not in letter' : 'Letter not read'}</span>
        )}
      </td>
      <td data-label="Approved" className="review-time__num review-time__mono">
        {p.approvalDate ? <Linked source={p.approvalDate.source}>{formatDate(p.approvalDate.value)}</Linked> : <span className="precedent__gap">—</span>}
      </td>
      <td data-label="Review time" className="review-time__num review-time__mono">
        {days !== undefined ? `${days} d` : '—'}
      </td>
    </tr>
  );
}
