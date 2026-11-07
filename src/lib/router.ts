import { useEffect, useState } from 'react';

/**
 * Minimal path router: every page has its own address
 * (`/drug/upadacitinib/indication/rheumatoid-arthritis/`), so search engines
 * can list each one. The build writes an HTML file for every page (see
 * vite.config.ts), and `404.html` serves the app for any other address, so
 * no server rewrite rule is needed.
 *
 * Old `#/drug/...` links still work: they are moved to the path on load.
 */
type Route =
  | { name: 'index' }
  | {
      name: 'indication';
      slug: string;
      indicationSlug: string;
      trialId: string | null;
    }
  | { name: 'drug'; slug: string }
  | { name: 'diseases' }
  | { name: 'disease'; meshId: string }
  | { name: 'compare' }
  | { name: 'review' }
  | { name: 'review-drug'; slug: string }
  | { name: 'ingest' };

/** The site's folder ("/Pharma-Timeline-Tool/"), always ending in "/". */
const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');

/** A page's address under the site's folder; `path` has no leading slash ("drug/x/"). */
export function href(path: string): string {
  return `${BASE}${path.replace(/^\/+/, '')}`;
}

/** The route of a path relative to the site's folder ("drug/x/indication/y/"). */
export function parsePath(path: string): Route {
  const clean = path.split(/[?#]/)[0].replace(/^\/+/, '');
  const [section, slug, sub1, sub1Value, sub2, sub2Value] = clean.split('/').map((p) => decodeURIComponent(p));
  if (section === 'drug' && slug && sub1 === 'indication' && sub1Value) {
    const trialId = sub2 === 'trial' ? sub2Value || null : null;
    return { name: 'indication', slug, indicationSlug: sub1Value, trialId };
  }
  if (section === 'drug' && slug && !sub1) return { name: 'drug', slug };
  if (section === 'diseases') return { name: 'diseases' };
  if (section === 'disease' && slug) return { name: 'disease', meshId: slug };
  if (section === 'compare') return { name: 'compare' };
  if (section === 'review') {
    return slug ? { name: 'review-drug', slug } : { name: 'review' };
  }
  if (section === 'ingest') {
    return { name: 'ingest' };
  }
  return { name: 'index' };
}

function currentPath(): string {
  const { pathname } = window.location;
  return pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\/+/, '');
}

/** An old "#/drug/x?q=1" link becomes "/drug/x/?q=1". */
function upgradeHashLink(): void {
  const { hash } = window.location;
  if (!hash.startsWith('#/')) return;
  const [path, query] = hash.slice(2).split('?');
  const trimmed = path.replace(/\/+$/, '');
  window.history.replaceState(null, '', href(`${trimmed}${trimmed ? '/' : ''}${query ? `?${query}` : ''}`));
}

const listeners = new Set<() => void>();

/** Open another page of the site. `scroll: false` keeps the reader's place (opening a trial's details). */
export function navigate(to: string, { scroll = true }: { scroll?: boolean } = {}): void {
  window.history.pushState(null, '', to);
  if (scroll) window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

/** Links to another page of the site open without reloading it. */
function onClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(BASE)) return;
  // A link to a spot on this same page: the browser scrolls to it.
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    upgradeHashLink();
    return parsePath(currentPath());
  });
  useEffect(() => {
    const onChange = () => setRoute(parsePath(currentPath()));
    listeners.add(onChange);
    window.addEventListener('popstate', onChange);
    document.addEventListener('click', onClick);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('popstate', onChange);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return route;
}

/** Replace the query string of the current page ("?area=oncology") without a new history entry. */
export function replaceQuery(params: Record<string, string>): void {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export function homeHref(): string {
  return href('');
}

export function diseasesHref(): string {
  return href('diseases/');
}

/** A disease page, by its MeSH id ("D001172"). */
export function diseaseHref(meshId: string): string {
  return href(`disease/${meshId}/`);
}

export function drugHref(slug: string): string {
  return href(`drug/${slug}/`);
}

export function indicationHref(slug: string, indicationSlug: string): string {
  return href(`drug/${slug}/indication/${indicationSlug}/`);
}

export function indicationTrialHref(slug: string, indicationSlug: string, trialId: string): string {
  return href(`drug/${slug}/indication/${indicationSlug}/trial/${trialId}/`);
}

export function reviewHref(): string {
  return href('review/');
}

export function reviewDrugHref(slug: string): string {
  return href(`review/${slug}/`);
}

export function ingestHref(): string {
  return href('ingest/');
}

/** The comparison page, optionally with programs chosen ("upadacitinib:rheumatoid-arthritis"). */
export function compareHref(a?: string, b?: string): string {
  const qs = new URLSearchParams(Object.entries({ a, b }).filter((e): e is [string, string] => !!e[1])).toString();
  return href(`compare/${qs ? `?${qs}` : ''}`);
}
