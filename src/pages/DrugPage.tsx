import { BackLink } from '../components/BackLink/BackLink.js';
import { CheckBadge, checkSentence } from '../components/CheckBadge/CheckBadge.js';
import { drugIndex, useDrug } from '../lib/catalog.js';
import { formatDate } from '../lib/dates.js';
import { trialsForIndication } from '../lib/drugs.js';
import { diseaseHref, indicationHref } from '../lib/router.js';
import type { Drug, Provenance } from '../schema/index.js';
import './IndicationPage.css';
import './DrugPage.css';

export function DrugPage({ slug }: { slug: string }) {
  const state = useDrug(slug);
  if (state.status === 'ready') return <DrugView drug={state.drug} />;
  return (
    <main className="drug">
      <BackLink href="#/" label="All drugs" />
      <p className="drug__missing">
        {state.status === 'loading' && 'Loading…'}
        {state.status === 'missing' && `No drug record found for “${slug}”.`}
        {state.status === 'error' && 'Couldn’t load this drug’s data — check your connection and reload.'}
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

function DrugView({ drug }: { drug: Drug }) {
  const listed = drugIndex.find((d) => d.slug === drug.slug);
  const checked = listed?.checked ?? { confirmed: 0, total: 0 };
  const about = drug.pharmacology;
  const indications = [...drug.indications].sort((a, b) =>
    (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999')
  );

  return (
    <main className="drug">
      <BackLink href="#/" label="All drugs" />

      <header className="drug__head">
        <div>
          <h1>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </h1>
          <p className="drug__mechanism">
            {about?.drugClass?.name ?? drug.modality}
            {listed?.office && <> · Reviewed by the FDA Office of {listed.office}</>}
          </p>
        </div>
        <dl className="drug__facts">
          <div>
            <dt>Application</dt>
            <dd>
              {drug.regulatory.us.applicationType} {drug.regulatory.us.applicationNumber}
            </dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{listed?.company ?? drug.sponsor}</dd>
          </div>
          <div>
            <dt>First approved</dt>
            <dd>{listed?.firstApproval ? formatDate(listed.firstApproval) : 'Date not determined'}</dd>
          </div>
        </dl>
      </header>

      <p className="drug__status" role="status">
        <CheckBadge stats={checked} />
        {checkSentence(checked)}
      </p>

      <section className="uses" aria-labelledby="uses-head">
        <h2 id="uses-head">Approved uses · {indications.length}</h2>
        <ul className="uses__list">
          {indications.map((i) => {
            const trials = trialsForIndication(drug, i.name).length;
            return (
              <li key={i.slug}>
                <a href={indicationHref(drug.slug, i.slug)} className="uses__item">
                  <span className="uses__name">{i.displayName ?? i.name}</span>
                  <span className="uses__meta">
                    {i.approvalDate ? formatDate(i.approvalDate) : 'Date not determined'} · {trials}{' '}
                    {trials === 1 ? 'trial' : 'trials'}
                  </span>
                </a>
                {(i.diseases ?? []).length > 0 && (
                  <p className="uses__diseases">
                    Disease:{' '}
                    {i.diseases!.map((d, k) => (
                      <span key={d.meshId}>
                        {k > 0 && ', '}
                        <a href={diseaseHref(d.meshId)}>{d.term}</a>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="about" aria-labelledby="about-head">
        <h2 id="about-head">About this drug</h2>
        <p className="about__note">Quoted word for word from the FDA-approved label, as its PDF reads. Some words come out split (“fun ction”); the linked label has the original.</p>
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
                {s.text}
                {s.truncated && ' …'}
              </p>
              <p className="about__cite">
                {s.truncated && 'Continues on the label. '}
                <SourceLink provenance={s.provenance} label={`Label section ${s.number}`} />
              </p>
            </details>
          ))
        ) : (
          <p className="about__gap">The label's clinical pharmacology sections couldn't be read from its text.</p>
        )}
      </section>

    </main>
  );
}
