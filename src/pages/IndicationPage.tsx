import { Info } from '../components/Info/Info.js';
import { useMemo, useState } from 'react';
import {
  getIndication,
  indicationLabel,
  shortIndication,
  trialsForIndication,
  isMeaningfulMilestone,
  primaryCompletionToApprovalMonths,
  roleFor,
  trialShortName,
} from '../lib/drugs.js';
import { approvalWording } from '../lib/diseases.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { drugMeta, indicationMeta, trialMeta } from '../lib/pageMeta.js';
import {
  aboutHref,
  compareHref,
  drugHref,
  navigate,
  indicationHref,
  indicationTrialHref,
  drugsHref,
  openedAsPanel,
} from '../lib/router.js';
import { formatDate } from '../lib/dates.js';
import { Gantt } from '../components/Gantt/Gantt.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { PostedResults } from '../components/TrialDetail/PostedResults.js';
import { drugIndex, useDrug } from '../lib/catalog.js';
import type { Drug, Milestone, Source, Trial } from '../schema/index.js';
import { approvalKindLabel, DATE_UNCLEAR } from '../lib/copy.js';
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

  const scopedTrials = useMemo(() => (indication ? trialsForIndication(drug, indication.name) : []), [drug, indication]);

  // The trials behind the first approval show by default; those that finished after it are one switch away.
  const [withLater, setWithLater] = useState(false);

  const selectedTrial = useMemo(() => (trialId ? (scopedTrials.find((t) => t.id === trialId) ?? null) : null), [scopedTrials, trialId]);
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
          supports={supportsLine(trialPage, indication)}
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
        return {
          ...m,
          label: `${approvalKindLabel(a.kind, a.submission)} — ${label}`,
          shortLabel: approvalKindLabel(a.kind, a.submission),
        };
      }
      return m.type === 'FDA_SUPPLEMENT' && m.submissionNumber === ownSubmission
        ? {
            ...m,
            label: `FDA approval — ${label}`,
            shortLabel: 'Approved for this use',
          }
        : m;
    });

  const firstDate = indication.approvalDate?.value;
  const labelUrl = newestLabelUrl(drug);
  const lagMonths = primaryCompletionToApprovalMonths(scopedTrials, indication.name, indication.approvalDate);
  const sourceGroups = groupSources(drug.sources, drug.milestones);
  const ownSources = sourceGroups.find((g) => g.submission === ownSubmission);

  // Trials whose primary completion came after the first approval back a later label change, not this approval.
  const isLater = (t: Trial) => !!firstDate && !!t.primaryCompletionDate && t.primaryCompletionDate.value > firstDate;
  const behindFirst = scopedTrials.filter((t) => !isLater(t));
  const after = scopedTrials.filter(isLater);
  // Called by what they are: pivotal trials for the later label expansions, or otherwise simply "later trials".
  const afterAllPivotal = after.every((t) => roleFor(t, indication.name) === 'PIVOTAL');
  const afterLabel = afterAllPivotal ? 'trials behind later label expansions' : 'trials that finished after this approval';
  const shownTrials = withLater || behindFirst.length === 0 ? scopedTrials : behindFirst;
  const pivotalShown = shownTrials.filter((t) => roleFor(t, indication.name) === 'PIVOTAL');
  const pivotalFirst = behindFirst.filter((t) => roleFor(t, indication.name) === 'PIVOTAL');
  const letterUrl = indication.approvalProvenance?.sourceUrl;

  return (
    <main className={`drug up${selectedTrial ? ' has-drawer' : ''}`}>
      <header className="up__head">
        <p className="up__crumb">
          <a href={drugHref(drug.slug)}>
            {drug.brandName} <span className="drug__inn">({drug.inn})</span>
          </a>
          {drug.indications.length > 1 && (
            <>
              {' · '}
              <a href={drugHref(drug.slug)}>all {drug.indications.length} approvals</a>
            </>
          )}
        </p>
        <h1>{label}</h1>
        <p className="up__meta nums">
          {drug.regulatory.us.applicationType} {drug.regulatory.us.applicationNumber} · {company}
        </p>
        {(indication.wording?.text ?? indication.name) !== label && (
          <blockquote className="up__wording">
            <p>{indication.wording?.text ?? indication.name}</p>
            <footer>
              {indication.wording ? (
                <>
                  The FDA’s wording on the current label ·{' '}
                  <a
                    href={indication.wording.provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={indication.wording.provenance.quote}
                  >
                    {indication.wording.provenance.sourceLabel ?? 'FDA label'} ↗
                  </a>
                </>
              ) : (
                'The FDA’s wording'
              )}
            </footer>
          </blockquote>
        )}
        <p className="up__links">
          {indication.pressReleaseUrl && (
            <a href={indication.pressReleaseUrl} target="_blank" rel="noopener noreferrer">
              Company’s announcement ↗
            </a>
          )}
          {indication.fdaAnnouncementUrl && (
            <a href={indication.fdaAnnouncementUrl} target="_blank" rel="noopener noreferrer">
              FDA’s announcement ↗
            </a>
          )}
          <a href={compareHref(`${drug.slug}:${indication.slug}`)}>Compare with another approval →</a>
        </p>
      </header>

      <dl className="up__numbers">
        <div>
          <dt>Approved</dt>
          <dd className="nums">{indication.approvalDate ? formatDate(indication.approvalDate) : DATE_UNCLEAR}</dd>
          <span className="up__numbers-sub">
            {letterUrl && (
              <a href={letterUrl} target="_blank" rel="noopener noreferrer" title={indication.approvalProvenance?.quote}>
                Approval letter
                {indication.submissionNumber ? ` (${indication.submissionNumber})` : ''} ↗
              </a>
            )}
            {letterUrl && widenings > 0 && ' · '}
            {widenings > 0 && `then ${widenings} label ${widenings === 1 ? 'expansion' : 'expansions'}`}
          </span>
        </div>
        <div>
          <dt>
            Trials to approval
            <Info label="What this measures">
              Months from the primary completion of the last pivotal trial (the date its last patient was assessed for the primary endpoint,
              per ClinicalTrials.gov) to the first FDA approval of this use.
            </Info>
          </dt>
          <dd className="nums">{lagMonths !== undefined ? `${lagMonths} month${lagMonths === 1 ? '' : 's'}` : '—'}</dd>
          <span className="up__numbers-sub">
            {lagMonths !== undefined ? 'from the last pivotal trial’s primary completion' : 'Not known: no dated pivotal trial before it'}
          </span>
        </div>
        <div>
          <dt>Pivotal trials</dt>
          <dd className="nums">{pivotalFirst.length}</dd>
          {after.length > 0 && (
            <span className="up__numbers-sub">
              + {after.length} {afterLabel}
            </span>
          )}
        </div>
      </dl>

      {scopedTrials.length === 0 ? (
        <div className="drug__no-trials">
          <h2>Trials behind this approval</h2>
          {indication.approvalDate && indication.approvalDate.value < REGISTRATION_REQUIRED ? (
            <p>
              No registered trial is linked to this approval. It was approved in {indication.approvalDate.value.slice(0, 4)}, before trials
              had to be registered on ClinicalTrials.gov (2007), so its trials usually have no registry record.
            </p>
          ) : (
            <p>
              Not yet matched to a registered trial. The label may describe the trials without their ClinicalTrials.gov numbers, or they
              were run by an organization other than {company}, such as a cooperative research group.
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
        <>
          <section className="drug__chart-section">
            <div className="up__section-head">
              <h2>
                {shownTrials.length > behindFirst.length && afterAllPivotal
                  ? 'Trials behind this approval and its label expansions'
                  : 'Trials behind this approval'}
              </h2>
              {after.length > 0 && behindFirst.length > 0 && (
                <label className="up__switch">
                  <input type="checkbox" checked={withLater} onChange={(e) => setWithLater(e.target.checked)} />
                  <span className="up__switch-track" aria-hidden="true" />
                  Show {afterLabel} ({after.length})
                </label>
              )}
            </div>
            <Gantt
              trials={shownTrials}
              milestones={scopedMilestones}
              selectedTrialId={trialId}
              indication={indication.name}
              majorSubmission={ownSubmission}
              onSelectTrial={(id) =>
                navigate(indicationTrialHref(drug.slug, indication.slug, id), {
                  scroll: false,
                  panel: true,
                })
              }
            />
          </section>

          {pivotalShown.length > 0 && (
            <section className="up__results" aria-labelledby="results-head">
              <h2 id="results-head">What the pivotal trials showed</h2>
              <p className="up__sub">The main result of each trial, as posted to ClinicalTrials.gov.</p>
              <ul className="up__cards">
                {pivotalShown.map((t) => (
                  <ResultCard
                    key={t.id}
                    trial={t}
                    name={trialShortName(t, scopedTrials)}
                    href={indicationTrialHref(drug.slug, indication.slug, t.id)}
                    onOpen={() => navigate(indicationTrialHref(drug.slug, indication.slug, t.id), { scroll: false, panel: true })}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="drug__milestones">
        <h2>Approval history</h2>
        <table className="drug__table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Type</th>
              <th scope="col">What the FDA approved</th>
            </tr>
          </thead>
          <tbody>
            {scopedMilestones.map((m) => {
              const a = useApprovals.get(m.submissionNumber ?? '');
              const major = m.type === 'FDA_APPROVAL' || m.submissionNumber === ownSubmission || !!a;
              const letter = a?.provenance.sourceUrl ?? m.provenance?.sourceUrl;
              return (
                <tr key={m.id} className={major ? 'is-major' : undefined}>
                  <td className="nums">
                    {letter ? (
                      <a href={letter} target="_blank" rel="noopener noreferrer" title="FDA letter">
                        {formatDate(m.date)} ↗
                      </a>
                    ) : (
                      formatDate(m.date)
                    )}
                    {m.submissionNumber && <span className="drug__table-sub">{m.submissionNumber}</span>}
                  </td>
                  <td>{a ? approvalKindLabel(a.kind, a.submission) : (m.shortLabel ?? m.label)}</td>
                  <td className="drug__table-wording">
                    {a
                      ? approvalWording(drug, indication, a)
                      : m.type === 'FDA_APPROVAL' || m.submissionNumber === ownSubmission
                        ? indication.name
                        : ''}
                  </td>
                </tr>
              );
            })}
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
            letter={
              ownSources?.sources.find((x) => x.type === 'fda_letter' || x.label.startsWith('Letter'))?.url ??
              indication.approvalProvenance?.sourceUrl
            }
            date={indication.approvalDate}
            label={ownSources?.sources.find((x) => x.type === 'fda_label')?.url ?? labelUrl}
            pivotal={scopedTrials.filter((t) => roleFor(t, indication.name) === 'PIVOTAL')}
          />
          <details className="drug__sources-all">
            <summary>All {drug.sources.length} source documents, by submission</summary>
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
          supports={supportsLine(selectedTrial, indication)}
          onClose={() =>
            navigate(indicationHref(drug.slug, indication.slug), {
              scroll: false,
            })
          }
        />
      )}
    </main>
  );
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
        {highlight ? 'This approval' : (group.submission ?? 'Other')}
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
  return drug.sources.filter((src) => src.type === 'fda_label').sort((a, b) => dateOf(b.label).localeCompare(dateOf(a.label)))[0]?.url;
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

/** Where a trial sits against the use's first approval, from the two dates: a fact, not a guess at which letter it backed. */
function supportsLine(trial: Trial, indication: Drug['indications'][number]): string | undefined {
  const first = indication.approvalDate;
  const pc = trial.primaryCompletionDate;
  if (!first || !pc) return undefined;
  const when = pc.value <= first.value ? 'before' : 'after';
  return `Primary completion ${formatDate(pc)}, ${when} the first approval for this use (${formatDate(first)}).`;
}

/**
 * One pivotal trial's main result: its first primary outcome as posted to
 * ClinicalTrials.gov, word for word, or a plain note when nothing is posted.
 */
function ResultCard({ trial, name, href, onOpen }: { trial: Trial; name: string; href: string; onOpen: () => void }) {
  const first = trial.postedResults?.[0];
  const more = (trial.postedResults?.length ?? 0) - 1;
  return (
    <li className="up__card">
      <div className="up__card-head">
        <a
          className="up__card-name"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          {name}
        </a>
        {trial.metPrimaryEndpoint !== null && trial.metPrimaryEndpoint !== undefined && (
          <span className={`drawer__met ${trial.metPrimaryEndpoint ? 'is-met' : 'is-not-met'}`}>
            {trial.metPrimaryEndpoint ? 'Met primary endpoint' : 'Did not meet primary endpoint'}
          </span>
        )}
      </div>
      <p className="up__card-meta nums">
        {[trial.nctId, trial.enrollment && `${trial.enrollment.count.toLocaleString()} patients`].filter(Boolean).join(' · ')}
      </p>
      {first ? (
        <PostedResults outcomes={[first]} sourceUrl={trial.provenance.postedResults?.sourceUrl} />
      ) : (
        <>
          {trial.primaryEndpoints[0] && <p className="up__card-endpoint">{trial.primaryEndpoints[0]}</p>}
          <p className="pharm__gap">No results posted to ClinicalTrials.gov.</p>
        </>
      )}
      <a
        className="up__card-more"
        href={href}
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        {more > 0 ? `${more} more ${more === 1 ? 'outcome' : 'outcomes'} and the full trial →` : 'The full trial →'}
      </a>
    </li>
  );
}
