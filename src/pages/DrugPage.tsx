import { useMemo } from 'react';
import { getDrug, isFullyUnverified } from '../lib/drugs.js';
import { navigate, trialHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import './DrugPage.css';

interface Props {
  slug: string;
  trialId: string | null;
}

export function DrugPage({ slug, trialId }: Props) {
  const drug = getDrug(slug);

  const selectedTrial = useMemo(
    () => (drug && trialId ? drug.trials.find((t) => t.id === trialId) ?? null : null),
    [drug, trialId]
  );

  if (!drug) {
    return (
      <main className="drug">
        <p className="drug__missing">
          No drug record found for “{slug}”. <a href="#/">Back to all drugs</a>
        </p>
      </main>
    );
  }

  const unverified = isFullyUnverified(drug);
  const inFiling = drug.trials.filter((t) => t.role !== 'NOT_IN_FILING');
  const laterTrials = drug.trials.filter((t) => t.role === 'NOT_IN_FILING');

  return (
    <main className="drug">
      <nav className="drug__breadcrumb">
        <a href="#/">All drugs</a>
        <span aria-hidden="true"> / </span>
        <span>{drug.brandName}</span>
      </nav>

      <header className="drug__head">
        <div>
          <h1>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </h1>
          <p className="drug__mechanism">{drug.mechanism ?? drug.modality}</p>
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
            <dt>First US approval</dt>
            <dd>{formatDate(drug.regulatory.us.originalApprovalDate)}</dd>
          </div>
          <div>
            <dt>Trials in filing</dt>
            <dd>{inFiling.length}</dd>
          </div>
        </dl>
      </header>

      {/* The seeded record is placeholder geometry until the first ingest run.
          Saying so plainly matters more than the page looking finished. */}
      {unverified && (
        <div className="drug__warning" role="status">
          <strong>Unverified data.</strong> Nothing on this page has been checked against
          the source documents yet. This record is hand-authored placeholder geometry so
          the timeline has something to render; run{' '}
          <code>npm run ingest -- --drug {drug.slug}</code> to replace it with data pulled
          from openFDA and ClinicalTrials.gov.
        </div>
      )}

      {drug.summary && <p className="drug__summary">{drug.summary}</p>}

      <section className="drug__chart-section">
        <h2>Development timeline</h2>
        <Gantt
          trials={drug.trials}
          milestones={drug.milestones}
          selectedTrialId={trialId}
          onSelectTrial={(id) => navigate(trialHref(drug.slug, id))}
        />
      </section>

      {laterTrials.length > 0 && (
        <section className="drug__note-section">
          <h3>Beyond the original filing</h3>
          <p>
            {laterTrials.length} registered trial{laterTrials.length === 1 ? '' : 's'} for
            this drug {laterTrials.length === 1 ? 'was' : 'were'} not cited in the original
            approval package — later indications and post-approval work. They appear on the
            chart with a dashed outline so the original evidence base stays distinguishable.
          </p>
        </section>
      )}

      <section className="drug__milestones">
        <h2>Regulatory milestones</h2>
        <table className="drug__table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Event</th>
              <th scope="col">Indication</th>
            </tr>
          </thead>
          <tbody>
            {drug.milestones.map((m) => (
              <tr key={m.id} className={m.type === 'FDA_APPROVAL' ? 'is-major' : undefined}>
                <td className="nums">{formatDate(m.date)}</td>
                <td>{m.label}</td>
                <td className="muted">{m.indication ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {drug.sources.length > 0 && (
        <section className="drug__sources">
          <h2>Sources</h2>
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
          onClose={() => navigate(`/drug/${drug.slug}`)}
        />
      )}
    </main>
  );
}
