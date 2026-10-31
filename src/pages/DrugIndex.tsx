import { useEffect, useMemo, useState } from 'react';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { compareHref, diseasesHref, drugHref } from '../lib/router.js';
import { shortIndication } from '../lib/drugs.js';
import { naturalTerm } from '../lib/plainText.js';
import { AREAS, areasOfDrug } from '../lib/areas.js';
import type { DrugSummary } from '../lib/summary.js';
import './DrugIndex.css';

const NOT_SORTED = 'not-sorted';

/** Search and area live in the URL ("#/?area=oncology") so a filtered list can be shared. */
function readParams(): URLSearchParams {
  const hash = window.location.hash;
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

function writeParams(params: Record<string, string>): void {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  // replaceState, not a hash assignment: typing shouldn't add a history entry per keystroke.
  window.history.replaceState(null, '', `#/${qs ? `?${qs}` : ''}`);
}

/** Each disease's everyday name as its disease page shows it ("Breast Cancer"). */
const diseaseName = new Map(diseaseIndex.map((d) => [d.meshId, d.name]));

/** What a drug is for, in a few words: its diseases' names where matched, else the FDA's wording, shortened. */
function usesLabel(d: DrugSummary): { text: string; more: number } {
  const names = [
    ...new Set(
      [...d.indications]
        .sort((a, b) => (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999'))
        .map((i) => (i.diseases[0] ? diseaseName.get(i.diseases[0].meshId) ?? naturalTerm(i.diseases[0].term) : shortIndication(i, 48)))
    ),
  ];
  return { text: names[0] ?? 'No approved use on record yet', more: Math.max(0, names.length - 1) };
}

export function DrugIndex() {
  const [initial] = useState(readParams);
  const [query, setQuery] = useState(initial.get('q') ?? '');
  const [area, setArea] = useState(initial.get('area') ?? '');

  useEffect(() => writeParams({ q: query, area }), [query, area]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drugIndex;
    return drugIndex.filter((d) =>
      [
        d.brandName,
        d.inn,
        d.company,
        d.firstApproval?.value.slice(0, 4) ?? '',
        ...areasOfDrug(d).map((a) => a.name),
        ...d.indications.flatMap((i) => [i.name, i.displayName ?? '', ...i.diseases.flatMap((x) => [x.term, diseaseName.get(x.meshId) ?? ''])]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [query]);

  const groups = AREAS.map((a) => ({ ...a, drugs: matching.filter((d) => areasOfDrug(d).some((x) => x.id === a.id)) }));
  const unsorted = matching.filter((d) => areasOfDrug(d).length === 0);
  const shown = groups.filter((g) => (!area || g.id === area) && g.drugs.length > 0);
  const empty = query ? [] : groups.filter((g) => (!area || g.id === area) && g.drugs.length === 0);

  return (
    <main className="index">
      <nav className="index__nav" aria-label="Site">
        <a href={diseasesHref()}>Diseases</a>
        <a href={compareHref()}>Compare</a>
      </nav>
      <header className="index__head">
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">The clinical trials behind each FDA approval.</p>
      </header>

      <div className="index__controls">
        <input
          className="index__search"
          type="search"
          aria-label="Search drugs"
          placeholder="Search a drug, disease or company"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="index__area" aria-label="Therapeutic area" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">All areas</option>
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="index__list">
        {shown.map((g) => (
          <Group key={g.id} title={g.name} drugs={g.drugs} />
        ))}
        {(!area || area === NOT_SORTED) && unsorted.length > 0 && <Group title="Being sorted" drugs={unsorted} />}
        {shown.length === 0 && unsorted.length === 0 && (query || empty.length === 0) && <p className="index__none">No drugs match.</p>}
        {empty.length > 0 && (
          <p className="index__empty">
            <span>No approvals on the site yet:</span> {empty.map((g) => g.name).join(', ')}
            {empty.some((g) => g.rule) && <> (being added from official records)</>}
          </p>
        )}
      </div>
    </main>
  );
}

function Group({ title, drugs }: { title: string; drugs: DrugSummary[] }) {
  return (
    <section className="index__group">
      <h2 className="index__group-head">
        {title} <span className="index__group-count">{drugs.length}</span>
      </h2>
      <ul className="index__rows">
        {drugs.map((d) => {
          const uses = usesLabel(d);
          return (
            <li key={d.slug}>
              <a className="index__row" href={drugHref(d.slug)}>
                <span className="index__row-drug">
                  <strong>{d.brandName}</strong> <span className="index__row-inn">{d.inn}</span>
                </span>
                <span className="index__row-use">
                  {uses.text}
                  {uses.more > 0 && <span className="index__row-more"> +{uses.more} more</span>}
                </span>
                <span className="index__row-year nums">{d.firstApproval?.value.slice(0, 4) ?? '—'}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
