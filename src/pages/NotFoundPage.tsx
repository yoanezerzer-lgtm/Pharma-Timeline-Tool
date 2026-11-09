import { usePageMeta } from '../lib/usePageMeta.js';
import { notFoundMeta } from '../lib/pageMeta.js';
import { diseasesHref, drugsHref } from '../lib/router.js';
import './IndicationPage.css';
import './DrugPage.css';

/** Any address that isn't a page on the site, and records that don't exist. */
export function NotFoundPage({ message = 'There is no page at this address.' }: { message?: string }) {
  usePageMeta(notFoundMeta());
  return (
    <main className="drug">
      <h1>Page not found</h1>
      <p>
        {message} Start from <a href={drugsHref()}>all drugs</a> or <a href={diseasesHref()}>all diseases</a>.
      </p>
    </main>
  );
}
