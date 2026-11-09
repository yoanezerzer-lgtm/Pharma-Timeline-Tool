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
    <a className="about__source" href={href} target="_blank" rel="noopener noreferrer" title={provenance.quote}>
      {label}
      {provenance.page ? `, page ${provenance.page}` : ''} ↗
    </a>
  );
}

/** Links to the company's own announcements and free news coverage, newest first. Never their text. */
function NewsSection({ slug }: { slug: string }) {
  const links = useNews(slug);
  if (!links) return null;
  return (
    <section className="news" aria-labelledby="news-head">
      <h2 id="news-head">
        Company news
        <Info label="About this section">
          Links to press releases on the company’s own site and on newswires, and to Fierce Pharma and Fierce Biotech
          stories. Only free pages, newest first. Each link opens the original page; nothing is copied here.
        </Info>
      </h2>
      {links.length > 0 ? (
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
      ) : (
        <p className="about__gap">No news links found yet.</p>
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

      {about?.patientSummary && (
        <section className="drug__plain" aria-labelledby="plain-head">
          <h2 id="plain-head">What it’s for</h2>
          {about.patientSummary.paragraphs.map((p, k) => (
            <p key={k} className={k > 0 && /^[a-z(]/.test(p) ? 'drug__plain-item' : undefined}>
              {p}
            </p>
          ))}
          <p className="drug__plain-source">
            From the patient information in the FDA-approved label.{' '}
            <SourceLink provenance={about.patientSummary.provenance} label="Read the label" />
          </p>
        </section>
      )}

      <section className="uses uses--wide" aria-labelledby="uses-head">
        <h2 id="uses-head">Approved uses</h2>
        <ul className="uselist">
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
      <section className="about" aria-labelledby="about-head">
        <h2 id="about-head">
          How it works
          <Info label="About this section">
            Word for word from the FDA-approved label (sections 12.1 to 12.3). Each part links to the page of the label
            it comes from.
          </Info>
        </h2>
        <dl className="about__class">
          <dt>Drug class (FDA)</dt>
          <dd>
            {about?.drugClass ? (
              <>
                {about.drugClass.name}{' '}
                <SourceLink
                  provenance={about.drugClass.provenance}
                  label={about.drugClass.provenance.extractedBy === 'api' ? 'openFDA' : 'Label highlights'}
                />
              </>
            ) : (
              <span className="about__gap">Not yet matched</span>
            )}
          </dd>
        </dl>
        {about && about.sections.length > 0 ? (
          about.sections.map((s, i) => (
            <details key={s.number} className="about__section" open={i === 0}>
              <summary>
                {s.number} {s.title}
              </summary>
              <p className="about__text">
                {withoutPageFooters(s.text)}
                {s.truncated && ' …'}
              </p>
              <p className="about__cite">
                {s.truncated && 'Continues on the label. '}
                <SourceLink provenance={s.provenance} label={`Label section ${s.number}`} />
              </p>
            </details>
          ))
        ) : (
          <p className="about__gap">Not yet read from the label.</p>
        )}
      </section>

      <NewsSection slug={drug.slug} />

      <section className="drug__sources" aria-labelledby="sources-head">
        <h2 id="sources-head">Sources and checks</h2>
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
