import { useEffect, useState } from 'react';

/**
 * Minimal hash router.
 *
 * Hash routing avoids needing a server-side rewrite rule, which GitHub Pages
 * does not offer for project sites. Routes look like `#/drug/upadacitinib`.
 */
export type Route = { name: 'index' } | { name: 'drug'; slug: string; trialId: string | null };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '');
  const [section, slug, , trialId] = path.split('/');
  if (section === 'drug' && slug) {
    return { name: 'drug', slug, trialId: trialId ?? null };
  }
  return { name: 'index' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function drugHref(slug: string): string {
  return `#/drug/${slug}`;
}

export function trialHref(slug: string, trialId: string): string {
  return `#/drug/${slug}/trial/${trialId}`;
}
