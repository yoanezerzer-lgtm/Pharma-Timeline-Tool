import type { Route } from '../../lib/router.js';
import { compareHref, diseasesHref, homeHref } from '../../lib/router.js';
import './SiteHeader.css';

type Section = 'drugs' | 'diseases' | 'compare' | undefined;

function sectionOf(route: Route): Section {
  if (route.name === 'index' || route.name === 'drug' || route.name === 'indication') return 'drugs';
  if (route.name === 'diseases' || route.name === 'disease') return 'diseases';
  if (route.name === 'compare') return 'compare';
  return undefined;
}

/** The same bar on every public page: the site's name and its three sections. */
export function SiteHeader({ route }: { route: Route }) {
  const current = sectionOf(route);
  const link = (section: Section, href: string, label: string) => (
    <a href={href} aria-current={current === section ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <header className="site">
      <div className="site__inner">
        <a className="site__brand" href={homeHref()}>
          Drug Development Timelines
        </a>
        <nav className="site__nav" aria-label="Site">
          {link('drugs', homeHref(), 'Drugs')}
          {link('diseases', diseasesHref(), 'Diseases')}
          {link('compare', compareHref(), 'Compare')}
        </nav>
      </div>
    </header>
  );
}
