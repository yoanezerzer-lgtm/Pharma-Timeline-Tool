import { useMemo } from 'react';
import { getDrug, getIndication, trialsForIndication, isFullyUnverified } from '../lib/drugs.js';
import { navigate, indicationHref, indicationTrialHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import './IndicationPage.css';

interface Props {
  slug: string;
  indicationSlug: string;
  trialId: string | null;
}

export function IndicationPage({ slug, indicationSlug, trialId }: Props) {
  const drug = getDrug(slug);
  const indication = drug ? getIndication(drug, indicationSlug) : undefined;

  const scopedTrials = useMemo(
    () => (drug && indication ? trialsForIndication(drug, indication.name) : []),
    [drug, indication]
  );

  const selectedTrial = useMemo(
    () => (trialId ? scopedTrials.find((t) => t.id === trialId) ?? null : null),
    [scopedTrials, trialId]
  );

  if (!drug) {
    return (
      <main className="drug">
        <p className="drug__missing">
          No drug record found for “{slug}”. <a href="#/">Back to search</a>
        </p>
      </main>
    );
  }

  if (!indication) {
    return (
      <main className="drug">
        <p className="drug__missing">
          {drug.brandName} has no indication “{indicationSlug}” on record.{' '}
          <a href={indicationHref(drug.slug, drug.indications[0]?.slug ?? '')}>
            {drug.indications[0] ? `See ${drug.indications[0].name} instead` : 'Back to search'}
          </a>
        </p>
      </main>
    );
  }

  const unverified = isFullyUnverified(drug);
  const scopedMilestones = drug.milestones.filter(
    (m) => m.type === 'FDA_APPROVAL' || !m.indication || m.indication === indication.name
  );

  return (
    <main className="drug">
      <nav className="drug__breadcrumb">
        <a href="#/">Search</a>
        <span aria-hidden="true"> / </span>
        <a href={indicationHref(drug.slug, indication.slug)}>{drug.brandName}</a>
        <span aria-hidden="true"> / </span>
        <span>{indication.name}</span>
      </nav>

      <header className="drug__head">
        <div>
          <h1>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </h1>
          <p className="drug__mechanism">
            {indication.name} — {drug.mechanism ?? drug.modality}
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
            <dt>Sponsor</dt>
            <dd>{drug.sponsor}</dd>
          </div>
          <div>
            <dt>Approved for this use</dt>
            <dd>{indication.approvalDate ? formatDate(indication.approvalDate) : 'Date not determined'}</dd>
          </div>
          <div>
            <dt>Trials supporting this approval</dt>
            <dd>{scopedTrials.length}</dd>
          </div>
        </dl>
      </header>

      {unverified && (
        <div className="drug__warning" role="status">
          <strong>Unverified data.</strong> Nothing on this page has been checked against
          the source documents yet — every field is marked <code>verified: false</code> until
          a person confirms it.
        </div>
      )}

      {drug.indications.length > 1 && (
        <nav className="drug__indication-switch" aria-label="Other approved indications">
          {drug.indications.map((i) => (
            <a
              key={i.slug}
              href={indicationHref(drug.slug, i.slug)}
              className={i.slug === indication.slug ? 'is-active' : undefined}
            >
              {i.name}
            </a>
          ))}
        </nav>
      )}

      {scopedTrials.length === 0 ? (
        <p className="drug__missing">
          No trials are currently attributed to this indication — either the label doesn't
          number its section 14 subsections in a way this pipeline could parse, or the
          section wasn't located at all. Check the ingest log.
        </p>
      ) : (
        <section className="drug__chart-section">
          <h2>Trials supporting the {indication.name} approval</h2>
          <Gantt
            trials={scopedTrials}
            milestones={scopedMilestones}
            selectedTrialId={trialId}
            indication={indication.name}
            onSelectTrial={(id) => navigate(indicationTrialHref(drug.slug, indication.slug, id))}
          />
        </section>
      )}

      <section className="drug__milestones">
        <h2>Regulatory milestones</h2>
        <table className="drug__table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Event</th>
            </tr>
          </thead>
          <tbody>
            {scopedMilestones.map((m) => (
              <tr key={m.id} className={m.type === 'FDA_APPROVAL' ? 'is-major' : undefined}>
                <td className="nums">{formatDate(m.date)}</td>
                <td>{m.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {drug.sources.length > 0 && (
        <section className="drug__sources">
          <h2>Sources</h2>
          <p className="drug__sources-note">
            The approval package and full label — everything this page's classifications
            were read from — so you can check them yourself.
          </p>
          <ul>
            {drug.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedTrial && (
        <TrialDrawer
          trial={selectedTrial}
          indication={indication.name}
          onClose={() => navigate(indicationHref(drug.slug, indication.slug))}
        />
      )}
    </main>
  );
}
