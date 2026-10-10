import { useMemo } from 'react';
import {
  getIndication,
  indicationLabel,
  trialsForIndication,
  isFullyUnverified,
  isMeaningfulMilestone,
} from '../lib/drugs.js';
import { navigate, indicationHref, indicationTrialHref, reviewDrugHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { BackLink } from '../components/BackLink/BackLink.js';
import { useDrug } from '../lib/catalog.js';
import type { Drug } from '../schema/index.js';
import './IndicationPage.css';

interface Props {
  slug: string;
  indicationSlug: string;
  trialId: string | null;
}

export function IndicationPage({ slug, indicationSlug, trialId }: Props) {
  const state = useDrug(slug);
  if (state.status === 'ready') {
    return <IndicationView drug={state.drug} indicationSlug={indicationSlug} trialId={trialId} />;
  }
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

function IndicationView({ drug, indicationSlug, trialId }: { drug: Drug; indicationSlug: string; trialId: string | null }) {
  const indication = getIndication(drug, indicationSlug);

  const scopedTrials = useMemo(
    () => (indication ? trialsForIndication(drug, indication.name) : []),
    [drug, indication]
  );

  const selectedTrial = useMemo(
    () => (trialId ? scopedTrials.find((t) => t.id === trialId) ?? null : null),
    [scopedTrials, trialId]
  );

  if (!indication) {
    return (
      <main className="drug">
        <BackLink href="#/" label="All drugs" />
        <p className="drug__missing">
          {drug.brandName} has no indication “{indicationSlug}” on record.{' '}
          <a href={indicationHref(drug.slug, drug.indications[0]?.slug ?? '')}>
            {drug.indications[0] ? `See ${indicationLabel(drug.indications[0])} instead` : 'Back to search'}
          </a>
        </p>
      </main>
    );
  }

  const unverified = isFullyUnverified(drug);
  // The supplement that added this indication (dated from the labels at
  // ingest) is shown as this page's approval; other indications' efficacy
  // supplements and administrative ones stay hidden.
  const ownSubmission = indication.submissionNumber;
  const label = indicationLabel(indication);
  const scopedMilestones = drug.milestones
    .filter((m) => isMeaningfulMilestone(m) || m.submissionNumber === ownSubmission)
    .map((m) =>
      m.type === 'FDA_SUPPLEMENT' && m.submissionNumber === ownSubmission
        ? { ...m, label: `FDA approval — ${label}`, shortLabel: 'Approved for this use' }
        : m
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
            {label} — {drug.mechanism ?? drug.modality}
          </p>
          {label !== indication.name && (
            <p className="drug__label-wording">
              <span>Label wording:</span> {indication.name}
            </p>
          )}
          {(indication.pressReleaseUrl || indication.fdaAnnouncementUrl) && (
            <div className="drug__announcements">
              {indication.pressReleaseUrl && (
                <a
                  className="drug__press-release"
                  href={indication.pressReleaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sponsor's announcement of this approval ↗
                </a>
              )}
              {indication.fdaAnnouncementUrl && (
                <a
                  className="drug__press-release"
                  href={indication.fdaAnnouncementUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  FDA's announcement of this approval ↗
                </a>
              )}
            </div>
          )}
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
            <dd>
              {indication.approvalDate ? formatDate(indication.approvalDate) : 'Date not determined'}
              {indication.approvalProvenance?.sourceUrl && (
                <a
                  className="drug__fact-source"
                  href={indication.approvalProvenance.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={indication.approvalProvenance.quote}
                >
                  {indication.submissionNumber ?? 'label'} ↗
                </a>
              )}
            </dd>
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
          a person confirms it.{' '}
          <a href={reviewDrugHref(drug.slug)}>Review it</a>.
        </div>
      )}

      {drug.indications.length > 1 && (
        <nav className="drug__indication-switch" aria-label="Other approved indications">
          {drug.indications.map((i) => (
            <a
              key={i.slug}
              href={indicationHref(drug.slug, i.slug)}
              className={i.slug === indication.slug ? 'is-active' : undefined}
              title={i.name}
            >
              {indicationLabel(i)}
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
          <h2>Trials supporting {label.length > 60 ? 'this' : `the ${label}`} approval</h2>
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
              <tr
                key={m.id}
                className={m.type === 'FDA_APPROVAL' || m.submissionNumber === ownSubmission ? 'is-major' : undefined}
              >
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
