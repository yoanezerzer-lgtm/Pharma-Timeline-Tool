import { useState } from 'react';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { homeMeta } from '../lib/pageMeta.js';
import { formatDate } from '../lib/dates.js';
import { shortIndication } from '../lib/drugs.js';
import { precedentRows } from '../lib/precedent.js';
import {
  aboutHref,
  diseaseHref,
  diseasesHref,
  drugHref,
  drugsHref,
  indicationHref,
  indicationTrialHref,
  navigate,
} from '../lib/router.js';
import { PrecedentTable } from '../components/PrecedentTable/PrecedentTable.js';
import { DiseaseTimeline } from './DiseasePage.js';
import '../components/IndicationTimeline/IndicationTimeline.css';
import './IndicationPage.css';
import './DrugPage.css';
import './DiseasePage.css';
import './HomePage.css';

/** The area made complete first (owner, 4 Nov): atopic dermatitis, by its MeSH id. */
const FEATURED_MESH_ID = 'D003876';
const PREVIEW_ROWS = 4;
const RECENT_COUNT = 6;

const companyOf = (slug: string) => drugIndex.find((d) => d.slug === slug)?.company ?? '';

/** The newest first approvals of a use across the site, newest first. */
function recentApprovals() {
  return drugIndex
    .flatMap((d) => d.indications.filter((i) => i.approvalDate).map((i) => ({ drug: d, use: i, date: i.approvalDate! })))
    .sort((a, b) => b.date.value.localeCompare(a.date.value))
    .slice(0, RECENT_COUNT);
}

export function HomePage() {
  usePageMeta(homeMeta());
  const [query, setQuery] = useState('');
  const featured = diseaseIndex.find((d) => d.meshId === FEATURED_MESH_ID);
  const uses = drugIndex.reduce((n, d) => n + d.indications.length, 0);

  return (
    <main className="home">
      <div className="home__account" aria-label="Account">
        {/* Accounts come with the move off GitHub Pages; this is where log-in will sit. */}
        <span className="home__account-note">Accounts open soon</span>
        <button type="button" className="home__login" disabled>
          Log in
        </button>
      </div>

      <header className="home__hero">
        <h1>Which clinical trials led to which FDA approval</h1>
        <p className="home__lede">
          Every approval traced to its pivotal trials: when each trial ran, when the FDA approved, what the FDA’s letter
          says, and a link to the document behind each fact.
        </p>
        <form
          className="home__search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            navigate(`${drugsHref()}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
          }}
        >
          <input
            type="search"
            aria-label="Search drugs, diseases or companies"
            placeholder="Search a drug, disease or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <p className="home__counts nums">
          <a href={drugsHref()}>{drugIndex.length} drugs</a> · <a href={diseasesHref()}>{diseaseIndex.length} diseases</a> ·{' '}
          {uses} approved uses
        </p>
      </header>

      {featured && <Featured disease={featured} />}

      <RecentApprovals />

      <section className="home__sources" aria-labelledby="home-sources">
        <h2 id="home-sources">Where the facts come from</h2>
        <ul>
          <li>
            <strong>FDA</strong> approval letters and drug labels: approval dates and the FDA’s own wording.
          </li>
          <li>
            <strong>ClinicalTrials.gov</strong>: each trial’s dates, design and results.
          </li>
          <li>
            <strong>U.S. National Library of Medicine</strong> (MeSH, MedlinePlus) and the National Cancer Institute: disease
            names and plain-language summaries.
          </li>
        </ul>
        <p>
          Nothing is written from memory: each fact links to its document, and where the documents don’t settle a fact
          the page leaves it blank. <a href={aboutHref()}>About the data →</a>
        </p>
      </section>
    </main>
  );
}

/** The complete area: its timeline, a few rows of its approvals table, and one example of each kind of page. */
function Featured({ disease }: { disease: (typeof diseaseIndex)[number] }) {
  const rows = precedentRows(disease, companyOf);
  const preview = rows
    .filter((r) => r.kind === 'new' && r.date)
    .sort((a, b) => b.date!.value.localeCompare(a.date!.value))
    .slice(0, PREVIEW_ROWS);
  const drugs = new Set(disease.uses.map((u) => u.drugSlug)).size;
  const example = disease.uses.find((u) => u.trials.length > 0) ?? disease.uses[0];
  const trial = example?.trials[0];

  return (
    <>
      <section className="home__featured" aria-labelledby="home-featured">
        <div className="home__section-head">
          <p className="home__eyebrow">Featured area</p>
          <h2 id="home-featured">
            <a href={diseaseHref(disease.meshId)}>{disease.name}</a>
          </h2>
          <p className="home__section-sub">
            {drugs} drugs · {rows.length} FDA approval letters, each with the trials behind it.
          </p>
        </div>
        <DiseaseTimeline disease={disease} companyOf={companyOf} headingLevel={3} />
        <div className="home__preview">
          <h3>Latest first approvals</h3>
          <PrecedentTable rows={preview} />
          <p className="home__more">
            <a href={`${diseaseHref(disease.meshId)}#precedents-head`}>
              See all {rows.length} approvals, with Excel and PowerPoint downloads →
            </a>
          </p>
        </div>
      </section>

      {example && (
        <section className="home__kinds" aria-labelledby="home-kinds">
          <h2 id="home-kinds">What you can open</h2>
          <ul className="home__cards">
            <Card kind="Disease" href={diseaseHref(disease.meshId)} title={disease.name}>
              Every FDA approval for one disease on a single timeline, with a table you can sort and download.
            </Card>
            <Card kind="Drug" href={drugHref(example.drugSlug)} title={example.brandName}>
              What the drug is for, in the patient leaflet’s words, each approved use, and how it works.
            </Card>
            <Card kind="Approved use" href={indicationHref(example.drugSlug, example.indicationSlug)} title={`${example.brandName}, ${disease.name}`}>
              The trials behind one approval, from first patient to the FDA’s letter, and every later change to it.
            </Card>
            {trial && (
              <Card
                kind="Trial"
                href={indicationTrialHref(example.drugSlug, example.indicationSlug, trial.id)}
                title={`${trial.name} (${example.brandName})`}
              >
                One trial’s dates, design, endpoints and results, linked to its ClinicalTrials.gov record.
              </Card>
            )}
          </ul>
        </section>
      )}
    </>
  );
}

function Card({ kind, href, title, children }: { kind: string; href: string; title: string; children: React.ReactNode }) {
  return (
    <li>
      <a className="home__card" href={href}>
        <span className="home__card-kind">{kind}</span>
        <span className="home__card-title">{title}</span>
        <span className="home__card-text">{children}</span>
      </a>
    </li>
  );
}

/** The newest approvals on the site, one line each, in the FDA's wording (cut short). */
function RecentApprovals() {
  const recent = recentApprovals();
  if (recent.length === 0) return null;
  return (
    <section className="home__recent" aria-labelledby="home-recent">
      <h2 id="home-recent">Recent FDA approvals</h2>
      <ol className="home__recent-list">
        {recent.map(({ drug, use, date }) => (
          <li key={`${drug.slug}-${use.slug}`}>
            <span className="home__recent-date nums">{formatDate(date)}</span>
            <a className="home__recent-drug" href={drugHref(drug.slug)}>
              <strong>{drug.brandName}</strong> <span>{drug.inn}</span>
            </a>
            <a className="home__recent-use" href={indicationHref(drug.slug, use.slug)}>
              {shortIndication(use, 90)}
            </a>
          </li>
        ))}
      </ol>
      <p className="home__more">
        <a href={drugsHref()}>All {drugIndex.length} drugs, by therapeutic area →</a>
      </p>
    </section>
  );
}
