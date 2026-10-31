import { useEffect, useMemo, useState } from 'react';
import { drugIndex } from '../lib/catalog.js';
import { compareHref, diseasesHref, drugHref, indicationHref, reviewHref, ingestHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { indicationLabel, shortIndication } from '../lib/drugs.js';
import { naturalTerm } from '../lib/plainText.js';
import type { DrugSummary } from '../lib/summary.js';
import { CheckBadge } from '../components/CheckBadge/CheckBadge.js';
import './DrugIndex.css';

const approvalDates = drugIndex.flatMap((d) => d.indications.flatMap((i) => (i.approvalDate ? [i.approvalDate] : [])));
const companies = [...new Set(drugIndex.map((d) => d.company))].sort((a, b) => a.localeCompare(b));
const areas = [...new Set(drugIndex.flatMap((d) => d.areas))].sort();
const NO_AREA = 'Therapeutic area not yet matched';
const areasOf = (d: DrugSummary) => (d.areas.length > 0 ? d.areas : [NO_AREA]);
const years = [...new Set(approvalDates.map((a) => a.value.slice(0, 4)))].sort().reverse();
const latestApproval = approvalDates.reduce<(typeof approvalDates)[number] | null>(
  (latest, a) => (!latest || a.value > latest.value ? a : latest),
  null
);
const totalIndications = drugIndex.reduce((n, d) => n + d.indications.length, 0);

const CARD_INDICATIONS = 4;

type View = 'list' | 'cards' | 'table';
const VIEWS: { id: View; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'cards', label: 'Cards' },
  { id: 'table', label: 'Table' },
];
type SortKey = 'drug' | 'approved' | 'trials';

function byApproval<T extends { approvalDate?: { value: string } }>(a: T, b: T): number {
  // Undated last, so a card's first rows are the ones with something to show.
  return (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999');
}

/** Search, filters and view live in the URL ("#/?sponsor=…&view=table") so a filtered view can be shared. */
function readParams(): URLSearchParams {
  const hash = window.location.hash;
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

function writeParams(params: Record<string, string>): void {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  // replaceState, not a hash assignment: typing in search shouldn't add a
  // history entry per keystroke, and doesn't fire hashchange.
  window.history.replaceState(null, '', `#/${qs ? `?${qs}` : ''}`);
}

export function DrugIndex() {
  const [initial] = useState(readParams);
  const [query, setQuery] = useState(initial.get('q') ?? '');
  const [sponsor, setSponsor] = useState(initial.get('sponsor') ?? '');
  const [year, setYear] = useState(initial.get('year') ?? '');
  const [area, setArea] = useState(initial.get('area') ?? '');
  const [view, setView] = useState<View>(() => VIEWS.find((v) => v.id === initial.get('view'))?.id ?? 'list');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    writeParams({ q: query, sponsor, area, year, view: view === 'list' ? '' : view });
  }, [query, sponsor, area, year, view]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drugIndex.filter((d) => {
      if (sponsor && d.company !== sponsor) return false;
      if (area && !areasOf(d).includes(area)) return false;
      if (year && !d.indications.some((i) => i.approvalDate?.value.startsWith(year))) return false;
      if (!q) return true;
      return [d.brandName, d.inn, d.sponsor, d.company, ...d.areas, ...d.indications.flatMap((i) => [i.name, i.displayName ?? '', ...i.diseases.flatMap((x) => [x.term, naturalTerm(x.term)])])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [query, sponsor, area, year]);

  return (
    <main className="index">
      <header className="index__head">
        <div className="index__head-actions">
          <a href={diseasesHref()} className="index__compare">
            Browse by disease
          </a>
          <a href={compareHref()} className="index__compare">
            Compare programs
          </a>
          <a href={ingestHref()} className="index__add-drug">
            + Add a drug
          </a>
        </div>
        <h1>Drug Development Timelines</h1>
        <p className="index__lede">
          Which clinical trials supported each FDA approval, traced from the FDA's own documents.
        </p>
        <p className="index__summary">
          {drugIndex.length} drugs · {totalIndications} approved uses
          {latestApproval && <> · latest approval {formatDate(latestApproval)}</>}
        </p>
      </header>

      <div className="index__controls">
        <div className="index__control index__control--search">
          <label htmlFor="drug-filter">Search by drug, company or disease</label>
          <input
            id="drug-filter"
            type="search"
            placeholder="e.g. Rinvoq, Takeda, polycythemia…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="index__control">
          <label htmlFor="sponsor-filter">Company</label>
          <select id="sponsor-filter" value={sponsor} onChange={(e) => setSponsor(e.target.value)}>
            <option value="">All companies</option>
            {companies.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {areas.length > 0 && (
          <div className="index__control">
            <label htmlFor="area-filter">Therapeutic area</label>
            <select id="area-filter" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {[...areas, NO_AREA].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
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
        <div className="index__control index__control--view" role="group" aria-label="View">
          <span className="index__control-label">View</span>
          <div className="index__view-toggle">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
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
              setArea('');
              setYear('');
            }}
          >
            Clear all
          </button>
        </p>
      ) : view === 'list' ? (
        <DrugList drugs={filtered} area={area} />
      ) : view === 'table' ? (
        <IndicationTable drugs={filtered} year={year} />
      ) : (
        <div className="index__grid">
          {filtered.map((d) => {
            return (
              <article key={d.slug} className="drug-card">
                <header className="drug-card__head">
                  <h2>
                    <a href={drugHref(d.slug)}>{d.brandName}</a> <span className="drug-card__inn">({d.inn})</span>
                  </h2>
                  <p className="drug-card__meta">
                    {d.mechanism ?? d.modality} · {d.company}
                  </p>
                  <p className="drug-card__check">
                    <CheckBadge stats={d.checked} />
                  </p>
                </header>

                {d.indications.length === 0 ? (
                  <p className="index__hint index__hint--card">
                    No indications on record yet — run the ingest pipeline.
                  </p>
                ) : (
                  <ul className="drug-card__indications">
                    {[...d.indications]
                      .sort(byApproval)
                      .slice(0, expanded.has(d.slug) ? undefined : CARD_INDICATIONS)
                      .map((i) => (
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
                    {d.indications.length > CARD_INDICATIONS && (
                      <li>
                        <button
                          type="button"
                          className="drug-card__more"
                          aria-expanded={expanded.has(d.slug)}
                          onClick={() =>
                            setExpanded((s) => {
                              const next = new Set(s);
                              if (next.has(d.slug)) next.delete(d.slug);
                              else next.add(d.slug);
                              return next;
                            })
                          }
                        >
                          {expanded.has(d.slug) ? 'Show fewer' : `+${d.indications.length - CARD_INDICATIONS} more`}
                        </button>
                      </li>
                    )}
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

function IndicationTable({ drugs, year }: { drugs: DrugSummary[]; year: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'approved', desc: true });
  const rows = drugs
    .flatMap((d) => d.indications.map((i) => ({ drug: d, indication: i })))
    // The year filter picks drugs with any approval that year; the table can be exact.
    .filter((r) => !year || r.indication.approvalDate?.value.startsWith(year));
  const value = (r: (typeof rows)[number]): string | number =>
    sort.key === 'drug'
      ? r.drug.brandName.toLowerCase()
      : sort.key === 'trials'
        ? r.indication.trialCount
        : r.indication.approvalDate?.value ?? '';
  rows.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sort.desc ? -cmp : cmp;
  });

  const header = (key: SortKey, label: string, numeric = false) => (
    <th scope="col" className={numeric ? 'is-num' : undefined} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'drug' }))}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}</span>
      </button>
    </th>
  );

  return (
    <div className="index__table-wrap">
      <table className="index__table">
        <thead>
          <tr>
            {header('drug', 'Drug')}
            <th scope="col">Indication</th>
            {header('approved', 'Approved')}
            {header('trials', 'Trials', true)}
            <th scope="col" className="index__table-sponsor">Company</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ drug, indication }) => (
            <tr key={`${drug.slug}/${indication.slug}`}>
              <td>
                <span className="index__table-drug">{drug.brandName}</span>{' '}
                <span className="index__table-inn">{drug.inn}</span>
              </td>
              <td>
                <a href={indicationHref(drug.slug, indication.slug)} title={indication.name}>
                  {indicationLabel(indication)}
                </a>
              </td>
              <td className="nums">{indication.approvalDate ? formatDate(indication.approvalDate) : '—'}</td>
              <td className="nums is-num">{indication.trialCount}</td>
              <td className="index__table-sponsor">{drug.company}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The default view: one line per drug, grouped by therapeutic area (the
 * MeSH disease categories of its approved uses). Each line shows the drug's first approved use in a few words;
 * the drug page has every use in the FDA's full wording.
 */
function DrugList({ drugs, area }: { drugs: DrugSummary[]; area: string }) {
  const grouped = areas.length > 0;
  const groups = new Map<string, DrugSummary[]>();
  for (const d of drugs) {
    // A drug sits under every area its approved uses fall in (Rinvoq: joints, skin, gut).
    for (const key of grouped ? areasOf(d).filter((a) => !area || a === area) : ['']) {
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
  }
  const order = [...groups.keys()].sort((a, b) => Number(a === NO_AREA) - Number(b === NO_AREA) || a.localeCompare(b));
  return (
    <div className="index__list">
      {order.map((key) => (
        <section key={key} className="index__group">
          {grouped && (
            <h2 className="index__group-head">
              {key} <span className="index__group-count">{groups.get(key)!.length}</span>
            </h2>
          )}
          <ul className="index__rows">
            {groups.get(key)!.map((d) => {
              const [first] = [...d.indications].sort(byApproval);
              const more = d.indications.length - 1;
              return (
                <li key={d.slug}>
                  <a className="index__row" href={drugHref(d.slug)}>
                    <span className="index__row-drug">
                      <strong>{d.brandName}</strong> <span className="index__row-inn">{d.inn}</span>
                    </span>
                    <span className="index__row-use" title={first?.name}>
                      {first ? shortIndication(first) : 'No approved use on record yet'}
                      {more > 0 && <span className="index__row-more"> +{more} more</span>}
                    </span>
                    <span className="index__row-company">{d.company}</span>
                    <span className="index__row-year nums">{d.firstApproval?.value.slice(0, 4) ?? '—'}</span>
                    <span className="index__row-check">
                      <CheckBadge stats={d.checked} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
