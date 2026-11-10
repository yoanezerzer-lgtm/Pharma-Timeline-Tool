import { useEffect, useMemo, useState } from 'react';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { drugsMeta } from '../lib/pageMeta.js';
import { replaceQuery, drugHref } from '../lib/router.js';
import { shortIndication } from '../lib/drugs.js';
import { naturalTerm } from '../lib/plainText.js';
import { AREAS, areasOfDrug } from '../lib/areas.js';
import { formatDate } from '../lib/dates.js';
import { ListTable } from '../components/ListTable/ListTable.js';
import { ListControls, Names } from '../components/ListTable/ListControls.js';
import type { DrugSummary } from '../lib/summary.js';
import './DrugIndex.css';

const NOT_SORTED = 'not-sorted';

/** Search and area live in the URL ("/drugs/?area=oncology") so a filtered list can be shared. */
function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

// Replaces the address rather than adding to history: typing shouldn't add an entry per keystroke.
const writeParams = replaceQuery;

/** Each disease's everyday name as its disease page shows it ("Breast Cancer"). */
const diseaseName = new Map(diseaseIndex.map((d) => [d.meshId, d.name]));

/** What a drug is approved for, oldest first: its diseases' names where matched, else the FDA's wording, shortened. */
function approvedFor(d: DrugSummary): string[] {
  return [
    ...new Set(
      [...d.indications]
        .sort((a, b) => (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999'))
        .map((i) => (i.diseases[0] ? diseaseName.get(i.diseases[0].meshId) ?? naturalTerm(i.diseases[0].term) : shortIndication(i, 48))),
    ),
  ];
}

export function DrugIndex() {
  usePageMeta(drugsMeta());
  const [initial] = useState(readParams);
  const [query, setQuery] = useState(initial.get('q') ?? '');
  const [area, setArea] = useState(initial.get('area') ?? '');

  useEffect(() => writeParams({ q: query, area }), [query, area]);

  const rows = useMemo(() => drugIndex.map((d) => ({ d, areas: areasOfDrug(d), uses: approvedFor(d) })), []);
  const areasShown = AREAS.filter((a) => rows.some((r) => r.areas.some((x) => x.id === a.id)));
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    ({ d, areas }) =>
      (!area || (area === NOT_SORTED ? areas.length === 0 : areas.some((a) => a.id === area))) &&
      (!q ||
        [
          d.brandName,
          d.inn,
          d.company,
          d.firstApproval?.value.slice(0, 4) ?? '',
          ...areas.map((a) => a.name),
          ...d.indications.flatMap((i) => [i.name, i.displayName ?? '', ...i.diseases.flatMap((x) => [x.term, diseaseName.get(x.meshId) ?? ''])]),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );

  return (
    <main className="index">
      <header className="index__head">
        <h1>Drugs</h1>
        <p className="index__lede">Every drug on the site, with its company, therapeutic area and first FDA approval.</p>
      </header>
      <ListControls
        query={query}
        onQuery={setQuery}
        area={area}
        onArea={setArea}
        areas={areasShown}
        placeholder="Search a drug, disease or company"
        count={shown.length}
        noun="drug"
      />
      {shown.length > 0 ? (
        <ListTable
          caption="Drugs on the site"
          rows={shown}
          rowKey={(r) => r.d.slug}
          initialSort={{ key: 'drug', up: true }}
          columns={[
            {
              key: 'drug',
              label: 'Drug',
              sort: (r) => r.d.brandName.toLowerCase(),
              render: (r) => (
                <>
                  <a className="index__name" href={drugHref(r.d.slug)}>
                    {r.d.brandName}
                  </a>{' '}
                  <span className="list-table__sub">{r.d.inn}</span>
                </>
              ),
            },
            { key: 'company', label: 'Company', sort: (r) => r.d.company.toLowerCase() || undefined, render: (r) => r.d.company || '—' },
            { key: 'area', label: 'Area', sort: (r) => r.areas[0]?.name, render: (r) => <span className="list-table__sub">{r.areas.map((a) => a.name).join(', ') || 'Not yet sorted'}</span> },
            { key: 'uses', label: 'Approved for', sort: (r) => r.uses.length, descFirst: true, phoneLabel: true, render: (r) => <Names names={r.uses} max={2} /> },
            {
              key: 'first',
              label: 'First FDA approval',
              sort: (r) => r.d.firstApproval?.value,
              descFirst: true,
              className: 'is-date',
              phoneLabel: true,
              render: (r) => (r.d.firstApproval ? formatDate(r.d.firstApproval) : '—'),
            },
          ]}
        />
      ) : (
        <p className="index__none">{query ? 'No drugs match your search.' : 'No drugs here yet.'}</p>
      )}
    </main>
  );
}
