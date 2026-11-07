import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from '../../lib/router.js';
import { aboutHref, compareHref, diseaseHref, diseasesHref, drugHref, homeHref, navigate } from '../../lib/router.js';
import { drugIndex, diseaseIndex } from '../../lib/catalog.js';
import { AREAS, areasOfDrug } from '../../lib/areas.js';
import './SidePanel.css';

/** Drugs and diseases filed under each area, worked out once. */
function useAreaTree() {
  return useMemo(
    () =>
      AREAS.map((a) => {
        const drugs = drugIndex
          .filter((d) => areasOfDrug(d).some((x) => x.id === a.id))
          .sort((x, y) => x.brandName.localeCompare(y.brandName));
        const ids = new Set(drugs.flatMap((d) => d.indications.flatMap((i) => i.diseases.map((x) => x.meshId))));
        const diseases = diseaseIndex.filter((d) => ids.has(d.meshId));
        return { ...a, drugs, diseases };
      }).filter((a) => a.drugs.length > 0),
    [],
  );
}

/**
 * The panel down the left of every public page on a wide screen: search,
 * the site's sections, and its areas with counts. The open page's area is
 * expanded to list its drugs (or, on a disease page, its diseases).
 */
export function SidePanel({ route }: { route: Route }) {
  const tree = useAreaTree();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  // "/" jumps to search, as on most reference sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const drugSlug = route.name === 'drug' || route.name === 'indication' ? route.slug : undefined;
  const meshId = route.name === 'disease' ? route.meshId : undefined;
  const areaParam = route.name === 'index' ? new URLSearchParams(window.location.search).get('area') : null;
  const openArea =
    (drugSlug && tree.find((a) => a.drugs.some((d) => d.slug === drugSlug))?.id) ||
    (meshId && tree.find((a) => a.diseases.some((d) => d.meshId === meshId))?.id) ||
    areaParam ||
    undefined;

  const section =
    route.name === 'index' || drugSlug ? 'drugs' : route.name === 'diseases' || meshId ? 'diseases' : route.name;
  const item = (key: string, href: string, label: string) => (
    <li>
      <a href={href} aria-current={section === key ? 'page' : undefined}>
        {label}
      </a>
    </li>
  );

  return (
    <aside className="side" aria-label="Site">
      <a className="side__brand" href={homeHref()}>
        <span className="side__mark" aria-hidden="true" />
        Drug Development Timelines
      </a>
      <form
        className="side__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`${homeHref()}${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
        }}
      >
        <input
          ref={search}
          id="side-search"
          type="search"
          placeholder="Search drugs, diseases…"
          aria-label="Search drugs, diseases or companies"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </form>

      <nav aria-label="Sections">
        <ul className="side__list">
          {item('drugs', homeHref(), 'Drugs')}
          {item('diseases', diseasesHref(), 'Diseases')}
          {item('compare', compareHref(), 'Compare')}
          {item('about', aboutHref(), 'About the data')}
        </ul>
      </nav>

      <nav aria-label="Therapeutic areas">
        <h2 className="side__label">Areas</h2>
        <ul className="side__list">
          {tree.map((a) => {
            const open = a.id === openArea;
            const children = meshId
              ? a.diseases.map((d) => ({ key: d.meshId, href: diseaseHref(d.meshId), label: d.name, on: d.meshId === meshId }))
              : a.drugs.map((d) => ({ key: d.slug, href: drugHref(d.slug), label: d.brandName, on: d.slug === drugSlug }));
            return (
              <li key={a.id}>
                <a className={`side__area${open ? ' is-open' : ''}`} href={`${homeHref()}?area=${a.id}`}>
                  <span>{a.name}</span>
                  <span className="side__count">{meshId ? a.diseases.length : a.drugs.length}</span>
                </a>
                {open && (
                  <ul className="side__sub">
                    {children.map((c) => (
                      <li key={c.key}>
                        <a href={c.href} aria-current={c.on ? 'page' : undefined}>
                          {c.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
