import { useMemo, useState } from 'react';
import { drugIndex } from '../lib/catalog.js';
import { indicationHref, reviewHref, ingestHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { indicationLabel } from '../lib/drugs.js';
import './DrugIndex.css';

const approvalDates = drugIndex.flatMap((d) => d.indications.flatMap((i) => (i.approvalDate ? [i.approvalDate] : [])));
const sponsors = [...new Set(drugIndex.map((d) => d.sponsor))].sort();
const years = [...new Set(approvalDates.map((a) => a.value.slice(0, 4)))].sort().reverse();
const latestApproval = approvalDates.reduce<(typeof approvalDates)[number] | null>(
  (latest, a) => (!latest || a.value > latest.value ? a : latest),
  null
);
const totalIndications = drugIndex.reduce((n, d) => n + d.indications.length, 0);
const totalTrials = drugIndex.reduce((n, d) => n + d.trialCount, 0);

export function DrugIndex() {
  const [query, setQuery] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [year, setYear] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drugIndex.filter((d) => {
      if (sponsor && d.sponsor !== sponsor) return false;
      if (year && !d.indications.some((i) => i.approvalDate?.value.startsWith(year))) return false;
      if (!q) return true;
      return [d.brandName, d.inn, d.sponsor, ...d.indications.flatMap((i) => [i.name, i.displayName ?? ''])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [query, sponsor, year]);

  return (
    <main className="index">
      <header className="index__head">
        <a href={ingestHref()} className="index__add-drug">
          + Add a drug
        </a>
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">
          Browse approved indications and see exactly which clinical trials supported each
          one — traced from the FDA approval package, not padded out with every trial the
          drug has ever run.
        </p>
      </header>

      <dl className="index__stats">
        <div>
          <dt>Drugs tracked</dt>
          <dd>{drugIndex.length}</dd>
        </div>
        <div>
          <dt>Approved indications</dt>
          <dd>{totalIndications}</dd>
        </div>
        <div>
          <dt>Trials catalogued</dt>
          <dd>{totalTrials}</dd>
        </div>
        <div>
          <dt>Most recent approval</dt>
          <dd>{latestApproval ? formatDate(latestApproval) : '—'}</dd>
        </div>
      </dl>

      <div className="index__controls">
        <div className="index__control index__control--search">
          <label htmlFor="drug-filter">Search by drug, sponsor, or indication</label>
          <input
            id="drug-filter"
            type="search"
            placeholder="e.g. Rinvoq, Takeda, polycythemia…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="index__control">
          <label htmlFor="sponsor-filter">Sponsor</label>
          <select id="sponsor-filter" value={sponsor} onChange={(e) => setSponsor(e.target.value)}>
            <option value="">All sponsors</option>
            {sponsors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="index__control">
          <label htmlFor="year-filter">Approval year</label>
          <select id="year-filter" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="index__hint">
          No drugs match the current search and filters.{' '}
          <button
            type="button"
            className="index__clear"
            onClick={() => {
              setQuery('');
              setSponsor('');
              setYear('');
            }}
          >
            Clear all
          </button>
        </p>
      ) : (
        <div className="index__grid">
          {filtered.map((d) => {
            const { verified, total } = d.verification;
            const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
            return (
              <article key={d.slug} className="drug-card">
                <header className="drug-card__head">
                  <h2>
                    {d.brandName} <span className="drug-card__inn">({d.inn})</span>
                  </h2>
                  <p className="drug-card__meta">
                    {d.mechanism ?? d.modality} · {d.sponsor}
                  </p>
                  <div className="drug-card__verification" title={`${verified} of ${total} fields verified`}>
                    <div className="drug-card__verification-bar">
                      <div className="drug-card__verification-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="drug-card__verification-label">{pct}% verified</span>
                  </div>
                </header>

                {d.indications.length === 0 ? (
                  <p className="index__hint index__hint--card">
                    No indications on record yet — run the ingest pipeline.
                  </p>
                ) : (
                  <ul className="drug-card__indications">
                    {d.indications.map((i) => (
                      <li key={i.slug}>
                        <a href={indicationHref(d.slug, i.slug)} className="drug-card__indication">
                          <span className="drug-card__indication-name" title={i.name}>
                            {indicationLabel(i)}
                          </span>
                          <span className="drug-card__indication-meta">
                            {i.approvalDate ? formatDate(i.approvalDate) : 'Date not determined'}
                            {' · '}
                            {i.trialCount} {i.trialCount === 1 ? 'trial' : 'trials'}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}

      <footer className="index__foot">
        <p>
          Built from public sources: openFDA Drugs@FDA, FDA approval packages, and
          ClinicalTrials.gov. No data is generated or inferred by a language model —
          structured fields come from the registries and approval documents, and narrative
          fields are written by hand.
        </p>
        <p>
          <a href={reviewHref()}>Review extracted data</a>
        </p>
      </footer>
    </main>
  );
}
