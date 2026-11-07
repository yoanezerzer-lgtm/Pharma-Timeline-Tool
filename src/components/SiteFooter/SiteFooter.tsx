import { aboutHref } from '../../lib/router.js';
import './SiteFooter.css';

/** The same plain footer on every public page: where the facts come from. */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-foot__inner">
        <span>Facts from the FDA, ClinicalTrials.gov and the U.S. National Library of Medicine.</span>
        <a href={aboutHref()}>About the data</a>
      </div>
    </footer>
  );
}
