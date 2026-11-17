import { useState, type ReactNode } from 'react';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { homeMeta } from '../lib/pageMeta.js';
import { severityGroups } from '../lib/diseases.js';
import {
  aboutHref,
  compareHref,
  diseaseHref,
  diseasesHref,
  drugHref,
  drugsHref,
  indicationHref,
  indicationTrialHref,
  navigate,
} from '../lib/router.js';
import './HomePage.css';

/** The area made complete first (owner, 4 Nov): atopic dermatitis, by its MeSH id. */
const FEATURED_MESH_ID = 'D003876';

/**
 * The featured area and one real example of each kind of page, so every
 * link on the home page opens something filled in.
 */
function examples() {
  const whole = diseaseIndex.find((d) => d.meshId === FEATURED_MESH_ID);
  if (!whole) return null;
  // Approvals for different severities aren't compared: the home page uses the largest group.
  const group = severityGroups(whole)[0];
  const disease = group.disease;
  const use = disease.uses.find((u) => u.trials.length > 0) ?? disease.uses[0];
  if (!use) return null;
  return {
    disease,
    severity: group.label,
    drugs: new Set(disease.uses.map((u) => u.drugSlug)).size,
    use,
    trial: use.trials[0],
  };
}

export function HomePage() {
  usePageMeta(homeMeta());
  const [query, setQuery] = useState('');
  const ex = examples();
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

      <section className="home__hero" aria-labelledby="home-title">
        <div className="home__intro">
          <p className="home__eyebrow nums">
            <span className="home__eyebrow-mark" aria-hidden="true" />
            FDA documents · ClinicalTrials.gov · {drugIndex.length} drugs · {uses} approved uses
          </p>
          <h1 id="home-title">Which clinical trials led to which FDA approval.</h1>
          <p className="home__tagline">Every fact linked to its source.</p>
          <p className="home__lede">
            See every FDA approval for a disease, the trials behind each one, and how long it took. Built for people who
            make precedent tables.
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
        </div>

        <nav className="home__tasks" aria-labelledby="home-tasks">
          <h2 id="home-tasks">What are you working on?</h2>
          <ul>
            <Task icon={<DiseaseIcon />} href={diseasesHref()}>
              See every approval for a disease
            </Task>
            <Task icon={<DrugIcon />} href={drugsHref()}>
              Look up a drug
            </Task>
            {ex && (
              <Task icon={<UseIcon />} href={indicationHref(ex.use.drugSlug, ex.use.indicationSlug)}>
                Find the trials behind an approval
              </Task>
            )}
            {ex && (
              <Task icon={<TableIcon />} href={`${diseaseHref(ex.disease.meshId)}#precedents-head`}>
                Build a precedent table
              </Task>
            )}
            <Task icon={<CompareIcon />} href={compareHref()}>
              Compare two approvals
            </Task>
          </ul>
          <p className="home__tasks-foot">
            <a href={drugsHref()}>Browse all {drugIndex.length} drugs →</a>
            <a href={aboutHref()}>Where the facts come from →</a>
          </p>
        </nav>
      </section>

      {ex && (
        <p className="home__featured">
          <span className="home__featured-label">Featured area</span>
          <a href={diseaseHref(ex.disease.meshId)}>
            {ex.disease.name}
            {ex.severity && `, ${ex.severity.toLowerCase()}`}
          </a>
          <span className="nums">
            {ex.drugs} drugs · {ex.disease.uses.length} approved uses on one timeline
          </span>
        </p>
      )}

      {ex && (
        <section className="home__kinds" aria-labelledby="home-kinds">
          <h2 id="home-kinds">Choose where to start.</h2>
          <p className="home__kinds-sub">
            Each page answers one question. Every fact links to the FDA or ClinicalTrials.gov document it comes from, and
            where the documents don’t settle something, the page leaves it blank rather than guess.
          </p>
          <ul className="home__cards">
            <Card
              icon={<DiseaseIcon />}
              name="Disease"
              question="What is approved for this disease, and since when?"
              points={['Every approval on one timeline', 'Pivotal trials lined up by drug', 'Excel and PowerPoint downloads']}
              href={diseaseHref(ex.disease.meshId)}
              example={ex.disease.name}
              all={{ href: diseasesHref(), label: 'All diseases' }}
            />
            <Card
              icon={<DrugIcon />}
              name="Drug"
              question="What is this drug for, and how does it work?"
              points={['What it’s for, in the leaflet’s words', 'Each approved use', 'How it works, from the label']}
              href={drugHref(ex.use.drugSlug)}
              example={ex.use.brandName}
              all={{ href: drugsHref(), label: 'All drugs' }}
            />
            <Card
              icon={<UseIcon />}
              name="Approved use"
              question="Which trials led to this approval, and how long did it take?"
              points={['Trials from first patient to approval', 'The FDA’s own wording', 'Every later change to it']}
              href={indicationHref(ex.use.drugSlug, ex.use.indicationSlug)}
              example={`${ex.use.brandName}, ${ex.disease.name}`}
            />
            {ex.trial && (
              <Card
                icon={<TrialIcon />}
                name="Trial"
                question="What did this trial test, and what did it show?"
                points={['Dates and design', 'Endpoints and results', 'Its ClinicalTrials.gov record']}
                href={indicationTrialHref(ex.use.drugSlug, ex.use.indicationSlug, ex.trial.id)}
                example={`${ex.trial.name} (${ex.use.brandName})`}
              />
            )}
          </ul>
        </section>
      )}

    </main>
  );
}

function Task({ icon, href, children }: { icon: ReactNode; href: string; children: ReactNode }) {
  return (
    <li>
      <a className="home__task" href={href}>
        <span className="home__icon">{icon}</span>
        <span className="home__task-text">{children}</span>
        <span className="home__arrow" aria-hidden="true">
          →
        </span>
      </a>
    </li>
  );
}

function Card(props: {
  icon: ReactNode;
  name: string;
  question: string;
  points: string[];
  href: string;
  example: string;
  all?: { href: string; label: string };
}) {
  return (
    <li className="home__card">
      <div className="home__card-head">
        <span className="home__card-icon">{props.icon}</span>
        <h3>
          {props.name}
          <span className="home__dot">.</span>
        </h3>
      </div>
      <p className="home__card-question">{props.question}</p>
      <ul className="home__card-points">
        {props.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div className="home__card-foot">
        <a className="home__open" href={props.href}>
          Open <span aria-hidden="true">→</span>
        </a>
        {props.all && <a href={props.all.href}>{props.all.label}</a>}
      </div>
      <p className="home__card-example">{props.example}</p>
    </li>
  );
}

/* Line icons, drawn in the accent colour. */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

function DiseaseIcon() {
  return svg(
    <>
      <path d="M3 7h10M3 12h14M3 17h8" />
      <circle cx="16" cy="7" r="1.6" />
      <circle cx="20" cy="12" r="1.6" />
      <circle cx="14" cy="17" r="1.6" />
    </>,
  );
}

function DrugIcon() {
  return svg(
    <>
      <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" />
      <path d="M9.3 8.2l5.4 7.6" />
    </>,
  );
}

function UseIcon() {
  return svg(
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 14l2 2 4-4" />
    </>,
  );
}

function TrialIcon() {
  return svg(
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>,
  );
}

function TableIcon() {
  return svg(
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 9h18M3 14.5h18M9 9v11" />
    </>,
  );
}

function CompareIcon() {
  return svg(
    <>
      <path d="M4 8h16M4 16h16" />
      <path d="M16 4l4 4-4 4M8 12l-4 4 4 4" />
    </>,
  );
}
