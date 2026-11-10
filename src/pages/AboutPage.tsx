import type { ReactNode } from 'react';
import { usePageMeta } from '../lib/usePageMeta.js';
import { aboutMeta } from '../lib/pageMeta.js';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { APPROVAL_KIND, DATE_UNCLEAR, NOT_YET_MATCHED } from '../lib/copy.js';
import { MIN_SAMPLE } from '../lib/reviewTime.js';
import './AboutPage.css';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

const SOURCES: { name: ReactNode; takes: string }[] = [
  {
    name: (
      <a href="https://open.fda.gov/" {...ext}>
        FDA labels and approval letters (openFDA, Drugs@FDA) ↗
      </a>
    ),
    takes:
      'Each approved use in the FDA’s own words, approval dates and types, the company, the pivotal trials the label names, application receipt dates, clinical pharmacology and the patient leaflet.',
  },
  {
    name: (
      <a href="https://clinicaltrials.gov/" {...ext}>
        ClinicalTrials.gov ↗
      </a>
    ),
    takes: 'Each trial’s phase, design, enrollment, start and primary completion dates, primary endpoint and posted results.',
  },
  {
    name: (
      <a href="https://www.nlm.nih.gov/mesh/" {...ext}>
        MeSH, U.S. National Library of Medicine ↗
      </a>
    ),
    takes:
      'Disease names and medical definitions. A disease is linked to an approved use when a trial behind the approval is tagged with it and the FDA’s wording names it.',
  },
  {
    name: (
      <>
        <a href="https://medlineplus.gov/" {...ext}>
          MedlinePlus ↗
        </a>{' '}
        and the{' '}
        <a href="https://www.cancer.gov/publications/dictionaries/cancer-terms" {...ext}>
          NCI Dictionary of Cancer Terms ↗
        </a>
      </>
    ),
    takes: 'The plain-language summary on disease pages, word for word, used only when the page is about that disease itself.',
  },
  {
    name: 'Company news and press releases',
    takes:
      'Links only, never quoted: the company’s own site, PR Newswire, Business Wire, GlobeNewswire, Fierce Pharma and Fierce Biotech. A link is kept only when the page’s own headline or summary names the drug.',
  },
  {
    name: 'Therapeutic areas',
    takes: 'Chosen by the site’s editor and filed by disease, so one drug’s uses can sit in different areas.',
  },
];

const TERMS: { term: string; meaning: string }[] = [
  {
    term: 'Pivotal trial',
    meaning:
      'A Phase 3 or Phase 2/3 trial run by the company that the label’s Clinical Studies section (section 14) names for the approved use.',
  },
  {
    term: 'Supportive trial',
    meaning: 'A trial the label names for the use that the approval did not rest on, such as a post-approval (Phase 4) study.',
  },
  {
    term: 'Primary completion',
    meaning: 'The date the last participant was assessed for the primary endpoint, as recorded on ClinicalTrials.gov.',
  },
  {
    term: 'Months from primary completion to approval',
    meaning:
      'From the latest primary completion among the pivotal trials completed before the approval, to the approval. Left blank when a date is known only to the year, or when the records don’t tie the trials to one approval letter.',
  },
  { term: APPROVAL_KIND.new, meaning: 'The first approval of a use, on the drug’s original application (ORIG-1).' },
  { term: 'New indication', meaning: 'A new use approved on a supplement to the application (SUPPL).' },
  { term: APPROVAL_KIND.expansion, meaning: 'An approved use widened: a new population, line of therapy or combination.' },
  { term: APPROVAL_KIND.revision, meaning: 'The use’s wording changed, and the approval letter does not say it was widened or narrowed.' },
  { term: APPROVAL_KIND.conversion, meaning: 'An accelerated approval converted to traditional approval.' },
  {
    term: 'FDA review time',
    meaning: `Days from the FDA first receiving the application to approving it, including any resubmission after a complete response letter. A median is shown only when at least ${MIN_SAMPLE} products have both dates.`,
  },
  {
    term: 'Severity',
    meaning:
      'Read from the FDA’s wording (moderate-to-severe, mild-to-moderate, or not stated). Approvals of different severities are shown separately and never compared side by side.',
  },
  {
    term: 'Results announced',
    meaning: 'The company’s first press release reporting a trial’s main result. Linked, never quoted.',
  },
];

/** Where every fact on the site comes from, what the site's terms mean, and how facts are checked. */
export function AboutPage() {
  usePageMeta(aboutMeta());
  const confirmed = drugIndex.reduce((n, d) => n + d.checked.confirmed, 0);
  const total = drugIndex.reduce((n, d) => n + d.checked.total, 0);
  return (
    <main className="about">
      <header className="about__head">
        <h1>About the data</h1>
        <p className="about__lead">
          Every fact on this site comes from a public source and links back to it. Facts are read from those sources by
          code, not written by a person or an AI. The site covers <strong>{drugIndex.length}</strong> drugs and{' '}
          <strong>{diseaseIndex.length}</strong> diseases; atopic dermatitis is the first area being made complete.
        </p>
      </header>

      <div className="about__grid">
        <div>
        <section aria-labelledby="sources-head">
          <h2 id="sources-head">Sources</h2>
          <table className="about__table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">What the site takes from it</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s, k) => (
                <tr key={k}>
                  <th scope="row">{s.name}</th>
                  <td>{s.takes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
          <section className="about__note" aria-labelledby="checks-head">
            <h2 id="checks-head">How facts are checked</h2>
            <p>
              Code reads each fact from its source. Each link between a trial and an approval is then checked against the
              FDA documents, with the passage that supports it quoted; code confirms the quote is really in the document.
              Facts not yet checked are shown all the same, read straight from the FDA and ClinicalTrials.gov. So far,{' '}
              <strong>{confirmed}</strong> of <strong>{total}</strong> trial links have been checked this way.
            </p>
          </section>
          <section className="about__note" aria-labelledby="gaps-head">
            <h2 id="gaps-head">Gaps are left blank</h2>
            <p>
              When the documents don’t settle something, the site says so (“{NOT_YET_MATCHED}”, “{DATE_UNCLEAR}”) rather
              than guess. FDA, ClinicalTrials.gov, MeSH and MedlinePlus wording is shown exactly as published.
            </p>
          </section>
        </div>

        <section aria-labelledby="terms-head">
          <h2 id="terms-head">Definitions</h2>
          <table className="about__table">
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col">What it means on this site</th>
              </tr>
            </thead>
            <tbody>
              {TERMS.map((t) => (
                <tr key={t.term}>
                  <th scope="row">{t.term}</th>
                  <td>{t.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
