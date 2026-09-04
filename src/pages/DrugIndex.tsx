import { useMemo, useState, type FormEvent } from 'react';
import { drugs, getDrug } from '../lib/drugs.js';
import { navigate, indicationHref } from '../lib/router.js';
import './DrugIndex.css';

export function DrugIndex() {
  const [drugSlug, setDrugSlug] = useState('');
  const [indicationSlug, setIndicationSlug] = useState('');

  const matchedDrug = useMemo(() => (drugSlug ? getDrug(drugSlug) ?? null : null), [drugSlug]);
  const indications = matchedDrug?.indications ?? [];

  function handleDrugChange(value: string) {
    setDrugSlug(value);
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
          <label htmlFor="drug-select">Drug</label>
          <select
            id="drug-select"
            value={drugSlug}
            onChange={(e) => handleDrugChange(e.target.value)}
          >
            <option value="">Select a drug…</option>
            {drugs.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.brandName} ({d.inn})
              </option>
            ))}
          </select>
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

      {matchedDrug && indications.length === 0 && (
        <p className="index__hint">
          {matchedDrug.brandName} has no indications on record yet — run the ingest pipeline.
        </p>
      )}

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
