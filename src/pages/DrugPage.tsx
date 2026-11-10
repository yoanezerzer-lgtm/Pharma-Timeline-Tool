import { useState } from 'react';
import { Info } from '../components/Info/Info.js';
import { diseaseIndex, drugIndex, useDrug, useNews } from '../lib/catalog.js';
import { formatDate } from '../lib/dates.js';
import { trialsForIndication } from '../lib/drugs.js';
import { naturalTerm } from '../lib/plainText.js';
import { DATE_UNCLEAR } from '../lib/copy.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { drugMeta } from '../lib/pageMeta.js';
import { NotFoundPage } from './NotFoundPage.js';
import { diseaseHref, indicationHref } from '../lib/router.js';
import { withoutPageFooters } from '../lib/plainText.js';
import type { Drug, Provenance } from '../schema/index.js';
import './IndicationPage.css';
import './DrugPage.css';

/** Each disease's everyday name as its disease page shows it ("Breast Cancer"). */
const diseaseName = new Map(diseaseIndex.map((d) => [d.meshId, d.name]));

export function DrugPage({ slug }: { slug: string }) {
  const state = useDrug(slug);
  if (state.status === 'missing') return <NotFoundPage message={`No drug called “${slug}” on this site.`} />;
  if (state.status === 'ready') return <DrugView drug={state.drug} />;
  return (
    <main className="drug">
      <p className="drug__missing">
        {state.status === 'loading' && 'Loading…'}
        {state.status === 'error' && 'Couldn’t load this page. Check your connection and reload.'}
      </p>
    </main>
  );
}

/** Where a passage came from, as a link to the FDA document and page. */
function SourceLink({ provenance, label }: { provenance: Provenance; label: string }) {
  if (!provenance.sourceUrl) return null;
  const href = provenance.page ? `${provenance.sourceUrl}#page=${provenance.page}` : provenance.sourceUrl;
  return (
    <a className="pharm__source" href={href} target="_blank" rel="noopener noreferrer" title={provenance.quote}>
      {label}
      {provenance.page ? `, page ${provenance.page}` : ''} ↗
    </a>
  );
}

/** Links to the company's own announcements and free news coverage, newest first. Never their text. */
function NewsSection({ slug }: { slug: string }) {
  const links = useNews(slug);
  // No section at all rather than an empty one.
  if (!links || links.length === 0) return null;
  return (
    <section className="news" aria-labelledby="news-head">
      <h2 id="news-head">
        Company news
        <Info label="About this section">
          Links to press releases on the company’s own site and on newswires, and to Fierce Pharma and Fierce Biotech
          stories. Only free pages, newest first. Each link opens the original page; nothing is copied here.
        </Info>
      </h2>
      <ul className="news__list">
          {links.map((l) => (
            <li key={l.url} className="news__item">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="news__title">
                {l.title} ↗
              </a>
              <span className="news__meta">
                {formatDate({ value: l.date, precision: 'day' })} · {l.source}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Lines of the leaflet's answer shown before "Show all". */
const SUMMARY_LINES = 3;

/**
 * The patient leaflet's own description of the medicine, word for word, as
 * the page's opening lines, with a light link to the label it comes from.
 */
function PatientSummary({ summary }: { summary: NonNullable<NonNullable<Drug['pharmacology']>['patientSummary']> }) {
  const [open, setOpen] = useState(false);
  const all = summary.paragraphs;
  const shown = open ? all : all.slice(0, SUMMARY_LINES);
  const href = summary.provenance.page ? `${summary.provenance.sourceUrl}#page=${summary.provenance.page}` : summary.provenance.sourceUrl;
  return (
    <section className="drug__plain" aria-label="Description from the label">
      {shown.map((p, k) => (
        <p key={k} className={k > 0 && /^[a-z(]/.test(p) ? 'drug__plain-item' : undefined}>
          {p}
          {k === shown.length - 1 && href && (
            <>
              {' '}
              <a className="drug__plain-source" href={href} target="_blank" rel="noopener noreferrer" title="Patient information in the FDA-approved label">
                (source ↗)
              </a>
            </>
          )}
        </p>
      ))}
      {all.length > SUMMARY_LINES && (
        <button type="button" className="disease__more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${all.length - 1} uses`}
        </button>
      )}
    </section>
  );
}

function DrugView({ drug }: { drug: Drug }) {
  usePageMeta(drugMeta(drug));
  const listed = drugIndex.find((d) => d.slug === drug.slug);
  const about = drug.pharmacology;
  const indications = [...drug.indications].sort((a, b) =>
    (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999'),
  );

  return (
    <main className="drug">
      <header className="drug__head">
        <div>
          <h1>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </h1>
          <p className="drug__mechanism">
            {listed?.company ?? drug.sponsor} · {indications.length} approved {indications.length === 1 ? 'use' : 'uses'}
            {listed?.firstApproval && <> · first approved {formatDate(listed.firstApproval)}</>}
          </p>
        </div>
      </header>

      {about?.patientSummary && <PatientSummary summary={about.patientSummary} />}

      <section className="uses uses--wide" aria-labelledby="uses-head">
        <h2 id="uses-head">Approved uses</h2>
        <ul className="uselist">
          <li className="uselist__row uselist__head" aria-hidden="true">
            <span>Indication</span>
            <span>Disease</span>
            <span className="uselist__date">First approved</span>
            <span className="uselist__trials">Trials</span>
          </li>
          {indications.map((i) => {
            const trials = trialsForIndication(drug, i.name).length;
            const diseases = i.diseases ?? [];
            return (
              <li key={i.slug} className="uselist__row">
                <a href={indicationHref(drug.slug, i.slug)} className="uselist__name">
                  {i.displayName ?? i.name}
                </a>
                <span className="uselist__disease">
                  {diseases.length > 0 && (
                    <>
                      <span className="uselist__label">Disease: </span>
                      {diseases.map((d, k) => (
                        <span key={d.meshId}>
                          {k > 0 && ', '}
                          <a href={diseaseHref(d.meshId)}>{diseaseName.get(d.meshId) ?? naturalTerm(d.term)}</a>
                        </span>
                      ))}
                    </>
                  )}
                </span>
                <span className="uselist__date">{i.approvalDate ? formatDate(i.approvalDate) : DATE_UNCLEAR}</span>
                <span className="uselist__trials">
                  {trials} {trials === 1 ? 'trial' : 'trials'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="pharm" aria-labelledby="pharm-head">
        <h2 id="pharm-head">
          Clinical pharmacology
          <Info label="About this section">
            Word for word from the FDA-approved label, sections 12.1 to 12.3; each part links to its page of the label.
            The drug class is the FDA’s, from the label or the FDA’s list of drug classes.
          </Info>
        </h2>
        <dl className="pharm__class">
          <dt>Drug class</dt>
          <dd>
            {about?.drugClass ? (
              // The label prints some classes in lower case ("hepcidin mimetic"); shown with a capital, words unchanged.
              about.drugClass.name.charAt(0).toUpperCase() + about.drugClass.name.slice(1)
            ) : (
              <span className="pharm__gap">Not yet matched</span>
            )}
          </dd>
        </dl>
        {about && about.sections.length > 0 ? (
          about.sections.map((s, i) => (
            <details key={s.number} className="pharm__section" open={i === 0}>
              <summary>
                {s.number} {s.title}
              </summary>
              <p className="pharm__text">
                {withoutPageFooters(s.text)}
                {s.truncated && ' …'}
              </p>
              <p className="pharm__cite">
                {s.truncated && 'Continues on the label. '}
                <SourceLink provenance={s.provenance} label={`Label section ${s.number}`} />
              </p>
            </details>
          ))
        ) : (
          <p className="pharm__gap">Not yet read from the label.</p>
        )}
      </section>

      <NewsSection slug={drug.slug} />

      <section className="drug__sources" aria-labelledby="sources-head">
        <h2 id="sources-head">Sources</h2>
        <dl className="drug__facts">
          <div>
            <dt>FDA application</dt>
            <dd>
              {drug.regulatory.us.applicationType} {drug.regulatory.us.applicationNumber}
            </dd>
          </div>
          {listed?.office && (
            <div>
              <dt>Reviewed by</dt>
              <dd>FDA Office of {listed.office}</dd>
            </div>
          )}
          {/* When the weekly refresh last re-read this drug's sources. */}
          {drug.lastIngestedAt && (
            <div>
              <dt>Sources last read</dt>
              <dd>{formatDate({ value: drug.lastIngestedAt.slice(0, 10), precision: 'day' })}</dd>
            </div>
          )}
        </dl>
      </section>
    </main>
  );
}
