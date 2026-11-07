import { BackLink } from '../components/BackLink/BackLink.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { notFoundMeta } from '../lib/pageMeta.js';
import { diseasesHref, homeHref } from '../lib/router.js';
import './IndicationPage.css';
import './DrugPage.css';

/** Any address that isn't a page on the site, and records that don't exist. */
export function NotFoundPage({ message = 'There is no page at this address.' }: { message?: string }) {
  usePageMeta(notFoundMeta());
  return (
    <main className="drug">
      <BackLink href={homeHref()} label="All drugs" />
      <h1>Page not found</h1>
      <p>
        {message} Start from <a href={homeHref()}>all drugs</a> or <a href={diseasesHref()}>all diseases</a>.
      </p>
    </main>
  );
}
