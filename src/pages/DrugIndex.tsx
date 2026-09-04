import { useMemo, useState, type FormEvent } from 'react';
import { drugs } from '../lib/drugs.js';
import { navigate, indicationHref } from '../lib/router.js';
import './DrugIndex.css';

export function DrugIndex() {
  const [drugQuery, setDrugQuery] = useState('');
  const [indicationSlug, setIndicationSlug] = useState('');

  const matchedDrug = useMemo(() => {
    const q = drugQuery.trim().toLowerCase();
    if (!q) return null;
    return drugs.find((d) => d.brandName.toLowerCase() === q || d.inn.toLowerCase() === q) ?? null;
  }, [drugQuery]);

  const indications = matchedDrug?.indications ?? [];

  function handleDrugChange(value: string) {
    setDrugQuery(value);
    setIndicationSlug('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (matchedDrug && indicationSlug) {
      navigate(indicationHref(matchedDrug.slug, indicationSlug));
    }
  }

  return (
    <main className="index">
      <header className="index__head">
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">
          Look up a drug and an approved indication to see exactly which clinical trials
          supported that specific approval — traced from the FDA approval package, not
          padded out with every trial the drug has ever run.
        </p>
      </header>

      <form className="index__search" onSubmit={handleSubmit}>
        <div className="index__field">
          <label htmlFor="drug-search">Drug</label>
          <input
            id="drug-search"
            list="drug-options"
            value={drugQuery}
            onChange={(e) => handleDrugChange(e.target.value)}
            placeholder="e.g. Rinvoq"
            autoComplete="off"
          />
          <datalist id="drug-options">
            {drugs.map((d) => (
              <option key={d.slug} value={d.brandName} />
            ))}
          </datalist>
        </div>

        <div className="index__field">
          <label htmlFor="indication-select">Indication</label>
          <select
            id="indication-select"
            value={indicationSlug}
            onChange={(e) => setIndicationSlug(e.target.value)}
            disabled={!matchedDrug || indications.length === 0}
          >
            <option value="">
              {matchedDrug ? 'Select an indication…' : 'Choose a drug first'}
            </option>
            {indications.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="index__submit" disabled={!matchedDrug || !indicationSlug}>
          View timeline
        </button>
      </form>

      {drugQuery && !matchedDrug && (
        <p className="index__hint">No drug matches “{drugQuery}” yet — try the list below.</p>
      )}
      {matchedDrug && indications.length === 0 && (
        <p className="index__hint">
          {matchedDrug.brandName} has no indications on record yet — run the ingest pipeline.
        </p>
      )}

      <section className="index__browse">
        <h2>Or browse everything indexed so far</h2>
        <ul className="index__list">
          {drugs.flatMap((d) =>
            d.indications.map((i) => (
              <li key={`${d.slug}-${i.slug}`}>
                <a href={indicationHref(d.slug, i.slug)}>
                  <span className="index__list-drug">{d.brandName}</span>
                  <span className="index__list-indication">{i.name}</span>
                </a>
              </li>
            ))
          )}
          {drugs.every((d) => d.indications.length === 0) && (
            <li className="index__list-empty">Nothing ingested yet.</li>
          )}
        </ul>
      </section>

      <footer className="index__foot">
        <p>
          Built from public sources: openFDA Drugs@FDA, FDA approval packages, and
          ClinicalTrials.gov. No data is generated or inferred by a language model —
          structured fields come from the registries and approval documents, and narrative
          fields are written by hand.
        </p>
      </footer>
    </main>
  );
}
