import { useMemo, useState } from 'react';
import { drugs, trialsForIndication } from '../lib/drugs.js';
import { indicationHref, reviewHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import './DrugIndex.css';

export function DrugIndex() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drugs;
    return drugs.filter((d) => {
      const haystack = [d.brandName, d.inn, d.sponsor, ...d.indications.map((i) => i.name)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  return (
    <main className="index">
      <header className="index__head">
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">
          Browse approved indications and see exactly which clinical trials supported each
          one — traced from the FDA approval package, not padded out with every trial the
          drug has ever run.
        </p>
      </header>

      <div className="index__search">
        <label htmlFor="drug-filter" className="index__search-label">
          Search by drug, sponsor, or indication
        </label>
        <input
          id="drug-filter"
          type="search"
          className="index__search-input"
          placeholder="e.g. Rinvoq, Takeda, polycythemia…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="index__hint">No drugs match “{query}”.</p>
      ) : (
        <div className="index__grid">
          {filtered.map((d) => (
            <article key={d.slug} className="drug-card">
              <header className="drug-card__head">
                <h2>
                  {d.brandName} <span className="drug-card__inn">({d.inn})</span>
                </h2>
                <p className="drug-card__meta">
                  {d.mechanism ?? d.modality} · {d.sponsor}
                </p>
              </header>

              {d.indications.length === 0 ? (
                <p className="index__hint index__hint--card">
                  No indications on record yet — run the ingest pipeline.
                </p>
              ) : (
                <ul className="drug-card__indications">
                  {d.indications.map((i) => {
                    const trialCount = trialsForIndication(d, i.name).length;
                    return (
                      <li key={i.slug}>
                        <a href={indicationHref(d.slug, i.slug)} className="drug-card__indication">
                          <span className="drug-card__indication-name">{i.name}</span>
                          <span className="drug-card__indication-meta">
                            {i.approvalDate ? formatDate(i.approvalDate) : 'Date not determined'}
                            {' · '}
                            {trialCount} {trialCount === 1 ? 'trial' : 'trials'}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
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
