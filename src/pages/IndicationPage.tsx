import { Info } from '../components/Info/Info.js';
import { useMemo } from 'react';
import {
  getIndication,
  indicationLabel,
  shortIndication,
  trialsForIndication,
  isMeaningfulMilestone,
  primaryCompletionToApprovalMonths,
  roleFor,
} from '../lib/drugs.js';
import { IndicationTimeline } from '../components/IndicationTimeline/IndicationTimeline.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { drugMeta, indicationMeta, trialMeta } from '../lib/pageMeta.js';
import { aboutHref, compareHref, drugHref, navigate, indicationHref, indicationTrialHref, drugsHref, openedAsPanel } from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { drugIndex, useDrug } from '../lib/catalog.js';
import type { Drug, Milestone, Source } from '../schema/index.js';
import { APPROVAL_KIND, DATE_UNCLEAR } from '../lib/copy.js';
import { NotFoundPage } from './NotFoundPage.js';
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
  if (state.status === 'missing') return <NotFoundPage message={`No drug called “${slug}” on this site.`} />;
  if (state.status === 'ready') {
    return <IndicationView drug={state.drug} indicationSlug={indicationSlug} trialId={trialId} />;
  }
  return (
    <main className="drug">
      <p className="drug__missing">
        {state.status === 'loading' && 'Loading…'}
        {state.status === 'error' && 'Couldn’t load this page. Check your connection and reload.'}
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
  // A trial opened from the chart shows in the side panel; its address opened any other way shows a full page.
  const trialPage = selectedTrial && indication && !openedAsPanel() ? selectedTrial : null;
  usePageMeta(
    trialPage && indication
      ? trialMeta(drug, indication, trialPage, scopedTrials)
      : indication
        ? indicationMeta(drug, indication)
        : drugMeta(drug),
  );

  if (!indication) {
    return (
      <main className="drug">
        <p className="drug__missing">
          {drug.brandName} has no approved use “{indicationSlug}” on this site.{' '}
          <a href={drug.indications[0] ? indicationHref(drug.slug, drug.indications[0].slug) : drugsHref()}>
            {drug.indications[0] ? `See ${indicationLabel(drug.indications[0])} instead` : 'All drugs'}
          </a>
        </p>
      </main>
    );
  }

  if (trialPage) {
    return (
      <main className="drug">
        <TrialDrawer
          asPage
          trial={trialPage}
          indication={indication.name}
          onClose={() => navigate(indicationHref(drug.slug, indication.slug))}
          crumbs={
            <p className="drawer__crumbs">
              <a href={drugHref(drug.slug)}>{drug.brandName}</a>
              <span aria-hidden="true">›</span>
              <a href={indicationHref(drug.slug, indication.slug)} title={indication.name}>
                {shortIndication(indication, 80)}
              </a>
            </p>
          }
        />
        <p className="drawer__page-foot">
          <a href={indicationHref(drug.slug, indication.slug)}>
            See this trial on the approval’s timeline, with the other trials behind it →
          </a>
        </p>
      </main>
    );
  }

  const listed = drugIndex.find((d) => d.slug === drug.slug);
  const company = listed?.company ?? drug.sponsor;
  // The supplement that added this indication (dated from the labels at
  // ingest) is shown as this page's approval; other indications' efficacy
  // supplements and administrative ones stay hidden.
  const ownSubmission = indication.submissionNumber;
  const widenings = (indication.approvals ?? []).filter((a) => a.kind !== 'new').length;
  const label = indicationLabel(indication);
  // Every letter in this use's history (first approval, then each widening
  // or wording change) is shown, so trials that finished after the first
  // approval line up with the approval they led to.
  const useApprovals = new Map((indication.approvals ?? []).map((a) => [a.submission, a]));
  const scopedMilestones = drug.milestones
    .filter((m) => isMeaningfulMilestone(m) || m.submissionNumber === ownSubmission || useApprovals.has(m.submissionNumber ?? ''))
    .map((m) => {
      const a = useApprovals.get(m.submissionNumber ?? '');
      if (a && a.kind !== 'new') {
        return { ...m, label: `${APPROVAL_KIND[a.kind]} — ${label}`, shortLabel: APPROVAL_KIND[a.kind] };
      }
      return m.type === 'FDA_SUPPLEMENT' && m.submissionNumber === ownSubmission
        ? { ...m, label: `FDA approval — ${label}`, shortLabel: 'Approved for this use' }
        : m;
    });

  const labelUrl = newestLabelUrl(drug);
  const lagMonths = primaryCompletionToApprovalMonths(scopedTrials, indication.name, indication.approvalDate);
  const sourceGroups = groupSources(drug.sources, drug.milestones);
  const ownSources = sourceGroups.find((g) => g.submission === ownSubmission);

  return (
    <main className={`drug${selectedTrial ? ' has-drawer' : ''}`}>
      <header className="drug__head">
        <div>
          <p className="page-eyebrow">
            <a href={drugHref(drug.slug)}>
              {drug.brandName} <span className="drug__inn">({drug.inn})</span>
            </a>{' '}
            · approved use
          </p>
          <h1>{label}</h1>
          <p className="drug__mechanism">
            {indication.approvalDate ? <>Approved {formatDate(indication.approvalDate)}</> : DATE_UNCLEAR}
            {widenings > 0 && <> · widened {widenings === 1 ? 'once' : `${widenings} times`}</>} · {company}
          </p>
          {drug.indications.length > 1 && (
            <p className="drug__other-indications">
              One of {drug.indications.length} approved uses ·{' '}
              <a href="#approved-indications" onClick={scrollTo('approved-indications')}>
                see all
              </a>
            </p>
          )}
          <p className="drug__compare">
            <a href={compareHref(`${drug.slug}:${indication.slug}`)}>Compare with another approval →</a>
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
                  Company’s announcement ↗
                </a>
              )}
              {indication.fdaAnnouncementUrl && (
                <a
                  className="drug__press-release"
                  href={indication.fdaAnnouncementUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  FDA’s announcement ↗
                </a>
              )}
            </div>
          )}
        </div>
        <dl className="drug__facts">
          <div>
            <dt>FDA application</dt>
            <dd>
              {drug.regulatory.us.applicationType} {drug.regulatory.us.applicationNumber}
            </dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{company}</dd>
          </div>
          <div>
            <dt>First approved</dt>
            <dd>
              {indication.approvalDate ? formatDate(indication.approvalDate) : DATE_UNCLEAR}
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
            <dt>Trials behind it</dt>
            <dd>{scopedTrials.length}</dd>
          </div>
          {lagMonths !== undefined && (
            <div>
              <dt>
                Trials to approval
                <Info label="What this measures">
                  From the date the last patient was assessed for the primary endpoint in the final pivotal trial
                  (ClinicalTrials.gov) to this FDA approval.
                </Info>
              </dt>
              <dd>
                {lagMonths} month{lagMonths === 1 ? '' : 's'}
              </dd>
            </div>
          )}
        </dl>
      </header>


      {scopedTrials.length === 0 ? (
        <div className="drug__no-trials">
          <h2>Trials behind this approval</h2>
          {indication.approvalDate && indication.approvalDate.value < REGISTRATION_REQUIRED ? (
            <p>
              No registered trial is linked to this approval. It was approved in{' '}
              {indication.approvalDate.value.slice(0, 4)}, before trials had to be registered on
              ClinicalTrials.gov (2007), so its trials usually have no registry record.
            </p>
          ) : (
            <p>
              Not yet matched to a registered trial. The label may describe the trials without
              their ClinicalTrials.gov numbers, or they were run by an organization other than{' '}
              {company}, such as a cooperative research group.
            </p>
          )}
          {labelUrl && (
            <p>
              <a href={labelUrl} target="_blank" rel="noopener noreferrer">
                Read the label’s clinical studies section ↗
              </a>
            </p>
          )}
        </div>
      ) : (
        <section className="drug__chart-section">
          <h2>Trials behind this approval</h2>
          <Gantt
            trials={scopedTrials}
            milestones={scopedMilestones}
            selectedTrialId={trialId}
            indication={indication.name}
            majorSubmission={ownSubmission}
            onSelectTrial={(id) => navigate(indicationTrialHref(drug.slug, indication.slug, id), { scroll: false, panel: true })}
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
        <h2>Approval history</h2>
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
                className={m.type === 'FDA_APPROVAL' || m.submissionNumber === ownSubmission || useApprovals.has(m.submissionNumber ?? '') ? 'is-major' : undefined}
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
          <h2>
            Sources
            <Info label="About sources">The FDA documents everything on this page comes from, so you can check it yourself.</Info>
          </h2>
          <ApprovalTrail
            letter={ownSources?.sources.find((x) => x.type === 'fda_letter' || x.label.startsWith('Letter'))?.url ?? indication.approvalProvenance?.sourceUrl}
            date={indication.approvalDate}
            label={ownSources?.sources.find((x) => x.type === 'fda_label')?.url ?? labelUrl}
            pivotal={scopedTrials.filter((t) => roleFor(t, indication.name) === 'PIVOTAL')}
          />
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
          onClose={() => navigate(indicationHref(drug.slug, indication.slug), { scroll: false })}
        />
      )}
    </main>
  );
}

// Smooth scrolling, and the address stays clean.
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

/**
 * How this approval is backed up, as a chain a reader can follow: the FDA
 * letter, the label that names the pivotal trials, their registry records,
 * and how the site reads them (the About the data page).
 */
function ApprovalTrail({
  letter,
  date,
  label,
  pivotal,
}: {
  letter?: string;
  date?: Milestone['date'];
  label?: string;
  pivotal: Drug['trials'];
}) {
  const registered = pivotal.filter((t) => t.nctId);
  const step = (title: string, detail: string, href?: string) => (
    <li className="trail-chain__step">
      {href ? (
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
          <strong>{title}</strong>
          {href.startsWith('http') && ' ↗'}
        </a>
      ) : (
        <strong>{title}</strong>
      )}
      <span>{detail}</span>
    </li>
  );
  return (
    <ol className="trail-chain" aria-label="How this approval is backed up">
      {step('FDA approval letter', date ? formatDate(date) : DATE_UNCLEAR, letter)}
      {step('FDA label', `names ${pivotal.length} pivotal ${pivotal.length === 1 ? 'trial' : 'trials'}`, label)}
      {step(
        'ClinicalTrials.gov',
        `${registered.length} registry ${registered.length === 1 ? 'record' : 'records'}`,
        registered.length > 0 ? `https://clinicaltrials.gov/search?term=${registered.map((t) => t.nctId).join('%20OR%20')}` : undefined,
      )}
      {step('How we read them', 'methods and sources', aboutHref())}
    </ol>
  );
}
