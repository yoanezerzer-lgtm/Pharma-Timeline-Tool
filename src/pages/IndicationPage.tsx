import { useMemo } from 'react';
import {
  getIndication,
  indicationLabel,
  trialsForIndication,
  isFullyUnverified,
  isMeaningfulMilestone,
  readoutToApprovalMonths,
} from '../lib/drugs.js';
import { IndicationTimeline } from '../components/IndicationTimeline/IndicationTimeline.js';
import { navigate, indicationHref, indicationTrialHref, reviewDrugHref } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { BackLink } from '../components/BackLink/BackLink.js';
import { useDrug } from '../lib/catalog.js';
import type { Drug, Milestone, Source } from '../schema/index.js';
import './IndicationPage.css';

/** FDAAA 801: registration on ClinicalTrials.gov became mandatory for most trials in late 2007. */
const REGISTRATION_REQUIRED = '2007-09-27';

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

  const labelUrl = newestLabelUrl(drug);
  const lagMonths = readoutToApprovalMonths(scopedTrials, indication.name, indication.approvalDate);
  const sourceGroups = groupSources(drug.sources, drug.milestones);
  const ownSources = sourceGroups.find((g) => g.submission === ownSubmission);

  return (
    <main className={`drug${selectedTrial ? ' has-drawer' : ''}`}>
      <BackLink href="#/" label="All drugs" />

      <header className="drug__head">
        <div>
          <h1>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </h1>
          <p className="drug__mechanism">
            {label} — {drug.mechanism ?? drug.modality}
          </p>
          {drug.indications.length > 1 && (
            <p className="drug__other-indications">
              One of {drug.indications.length} approved indications ·{' '}
              <a href="#approved-indications" onClick={scrollTo('approved-indications')}>
                see all
              </a>
            </p>
          )}
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
          {lagMonths !== undefined && (
            <div title="From the latest primary completion date among this indication's pivotal trials (ClinicalTrials.gov) to its approval.">
              <dt>Last pivotal readout to approval</dt>
              <dd>
                {lagMonths} month{lagMonths === 1 ? '' : 's'}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {unverified && (
        <p className="drug__status" role="status">
          <span className="drug__status-badge">Unverified</span>
          Extracted automatically and not yet checked against the source documents.{' '}
          <a href={reviewDrugHref(drug.slug)}>Review it</a>
        </p>
      )}

      {scopedTrials.length === 0 ? (
        <div className="drug__no-trials">
          <h2>Trials supporting this approval</h2>
          {indication.approvalDate && indication.approvalDate.value < REGISTRATION_REQUIRED ? (
            <p>
              No registered trial is linked to this approval. It was approved in{' '}
              {indication.approvalDate.value.slice(0, 4)}, before trials had to be registered on
              ClinicalTrials.gov (from 2007), so the trials behind it generally have no registry
              record to link to.
            </p>
          ) : (
            <p>
              No registered trial could be matched to this approval. Usually either the label
              describes the trials without their ClinicalTrials.gov numbers, or they were run by
              an organization other than {drug.sponsor} (a cooperative research group, for
              example), which this site doesn't yet count as the applicant's own.
            </p>
          )}
          {labelUrl && (
            <p>
              <a href={labelUrl} target="_blank" rel="noopener noreferrer">
                Read the label's clinical studies section ↗
              </a>
            </p>
          )}
        </div>
      ) : (
        <section className="drug__chart-section">
          <h2>Trials supporting {label.length > 60 ? 'this' : `the ${label}`} approval</h2>
          <Gantt
            trials={scopedTrials}
            milestones={scopedMilestones}
            selectedTrialId={trialId}
            indication={indication.name}
            majorSubmission={ownSubmission}
            onSelectTrial={(id) => navigate(indicationTrialHref(drug.slug, indication.slug, id))}
          />
        </section>
      )}

      {drug.indications.length > 1 && (
        <div id="approved-indications">
          <IndicationTimeline
            indications={drug.indications}
            currentSlug={indication.slug}
            hrefFor={(slug) => indicationHref(drug.slug, slug)}
          />
        </div>
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
            The FDA documents everything on this page was read from, so you can check them yourself.
          </p>
          {ownSources && (
            <ul className="drug__sources-own">
              <SourceGroupRow group={ownSources} highlight />
            </ul>
          )}
          <details className="drug__sources-all">
            <summary>
              All {drug.sources.length} source documents, by submission
            </summary>
            <ul>
              {sourceGroups.map((g) => (
                <SourceGroupRow key={g.submission ?? 'other'} group={g} />
              ))}
            </ul>
          </details>
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

// A hash link would change the route (the router reads location.hash), so scroll instead.
function scrollTo(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

interface SourceGroup {
  submission?: string;
  date?: Milestone['date'];
  sources: Source[];
}

/** Sources grouped by the submission in their label ("Label (SUPPL-22)"), newest first; others last. */
function groupSources(sources: Source[], milestones: Milestone[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const other: Source[] = [];
  for (const s of sources) {
    const submission = /\(([A-Z]+-\d+)\)$/.exec(s.label)?.[1];
    if (!submission) {
      other.push(s);
      continue;
    }
    const g = groups.get(submission) ?? {
      submission,
      date: milestones.find((m) => m.submissionNumber === submission)?.date,
      sources: [],
    };
    g.sources.push(s);
    groups.set(submission, g);
  }
  const sorted = [...groups.values()].sort((a, b) => (b.date?.value ?? '').localeCompare(a.date?.value ?? ''));
  return other.length > 0 ? [...sorted, { sources: other }] : sorted;
}

function SourceGroupRow({ group, highlight }: { group: SourceGroup; highlight?: boolean }) {
  return (
    <li className={`drug__source-group${highlight ? ' is-own' : ''}`}>
      <span className="drug__source-sub">
        {highlight ? 'This approval' : group.submission ?? 'Other'}
        {group.date && <span className="nums"> · {formatDate(group.date)}</span>}
      </span>
      <span>
        {group.sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ' · '}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {group.submission ? s.label.replace(` (${group.submission})`, '') : s.label}
            </a>
          </span>
        ))}
      </span>
    </li>
  );
}

/** The most recently approved label among the sources ("Label (SUPPL-34)"), by its supplement's date. */
function newestLabelUrl(drug: Drug): string | undefined {
  const dateOf = (label: string) => {
    const sub = /\(([A-Z]+-\d+)\)$/.exec(label)?.[1];
    return drug.milestones.find((m) => m.submissionNumber === sub)?.date.value ?? '';
  };
  return drug.sources
    .filter((src) => src.type === 'fda_label')
    .sort((a, b) => dateOf(b.label).localeCompare(dateOf(a.label)))[0]?.url;
}
