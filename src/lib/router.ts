import { useEffect, useState } from 'react';

/**
 * Minimal hash router.
 *
 * Hash routing avoids needing a server-side rewrite rule, which GitHub Pages
 * does not offer for project sites. Routes look like
 * `#/drug/upadacitinib/indication/rheumatoid-arthritis`.
 */
export type Route =
  | { name: 'index' }
  | {
      name: 'indication';
      slug: string;
      indicationSlug: string;
      trialId: string | null;
    };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '');
  const [section, slug, sub1, sub1Value, sub2, sub2Value] = path.split('/');
  if (section === 'drug' && slug && sub1 === 'indication' && sub1Value) {
    const trialId = sub2 === 'trial' ? sub2Value ?? null : null;
    return { name: 'indication', slug, indicationSlug: sub1Value, trialId };
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

export function indicationHref(slug: string, indicationSlug: string): string {
  return `#/drug/${slug}/indication/${indicationSlug}`;
}

export function indicationTrialHref(slug: string, indicationSlug: string, trialId: string): string {
  return `#/drug/${slug}/indication/${indicationSlug}/trial/${trialId}`;
}
