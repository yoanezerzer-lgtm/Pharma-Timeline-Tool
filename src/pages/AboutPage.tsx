import { usePageMeta } from '../lib/usePageMeta.js';
import { aboutMeta } from '../lib/pageMeta.js';
import './IndicationPage.css';
import './DrugPage.css';
import './AboutPage.css';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Where every fact on the site comes from, and how it is checked. */
export function AboutPage() {
  usePageMeta(aboutMeta());
  return (
    <main className="drug about">
      <h1>About the data</h1>
      <p className="about__lead">
        Every fact on this site comes from a public source and links back to it. The facts are read from those sources
        by code, not written by a person or an AI.
      </p>

      <section aria-labelledby="sources-head">
        <h2 id="sources-head">Where the facts come from</h2>
        <dl className="about__sources">
          <dt>
            <a href="https://open.fda.gov/" {...ext}>
              FDA documents, through openFDA ↗
            </a>
          </dt>
          <dd>
            Drug labels and approval letters: each approved use in the FDA’s own words, approval dates, the company,
            how the drug works and the patient leaflet (“What it’s for”).
          </dd>
          <dt>
            <a href="https://clinicaltrials.gov/" {...ext}>
              ClinicalTrials.gov ↗
            </a>
          </dt>
          <dd>The clinical trials behind each approval: phase, dates, size and posted results.</dd>
          <dt>
            <a href="https://www.nlm.nih.gov/mesh/" {...ext}>
              MeSH, U.S. National Library of Medicine ↗
            </a>
          </dt>
          <dd>
            Disease names, their medical definitions and therapeutic areas. A disease is linked to an approved use
            when a trial behind the approval is tagged with it and the FDA’s wording names it.
          </dd>
          <dt>
            <a href="https://medlineplus.gov/" {...ext}>
              MedlinePlus ↗
            </a>{' '}
            and the{' '}
            <a href="https://www.cancer.gov/publications/dictionaries/cancer-terms" {...ext}>
              NCI Dictionary of Cancer Terms ↗
            </a>
          </dt>
          <dd>
            The plain-language summary on disease pages, word for word. It is used only when the page’s title is the
            disease itself.
          </dd>
          <dt>Company news</dt>
          <dd>
            Links to press releases and news stories on free pages only: the company’s own site, PR Newswire, Business
            Wire, GlobeNewswire, Fierce Pharma and Fierce Biotech. Each link is kept only when the page’s own headline
            or summary names the drug. Nothing from these pages is copied here.
          </dd>
        </dl>
      </section>

      <section aria-labelledby="checks-head">
        <h2 id="checks-head">How facts are checked</h2>
        <p>
          Code reads each fact from its source. A fact can then be checked against the source document, with the
          passage that supports it quoted; code confirms the quote is really in the document. Each drug shows how far
          this has gone:
        </p>
        <dl className="about__states">
          <dt>Checked</dt>
          <dd>Every trial link on the drug’s page has been confirmed against the FDA documents.</dd>
          <dt>Partly checked</dt>
          <dd>Some trial links are confirmed (the page says how many); the rest are not yet checked.</dd>
          <dt>Not yet checked</dt>
          <dd>Read automatically from FDA documents and ClinicalTrials.gov, not yet checked against them.</dd>
        </dl>
      </section>

      <section aria-labelledby="gaps-head">
        <h2 id="gaps-head">Gaps are left blank</h2>
        <p>
          When the documents don’t settle something, the site says so (“Not yet matched”, “Date unclear”) rather
          than guess. FDA, MeSH and MedlinePlus wording is shown exactly as published.
        </p>
      </section>
    </main>
  );
}
