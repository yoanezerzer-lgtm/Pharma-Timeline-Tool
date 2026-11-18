import { useEffect } from 'react';
import { PostedResults } from './PostedResults.js';
import { SourceTrail } from './SourceTrail.js';
import { TrialTimeline, type TimelineApproval } from './TrialTimeline.js';
import { registryText, maskingText } from '../../lib/registryText.js';
import type { Trial } from '../../schema/index.js';
import { formatDate } from '../../lib/dates.js';
import { roleFor, summaryRole, ROLE_LABEL, trialShortName } from '../../lib/drugs.js';
import './TrialDrawer.css';

interface Props {
  trial: Trial;
  onClose: () => void;
  /** When set, the eyebrow shows this trial's role for one specific indication. */
  indication?: string;
  /** Show as a full page (a trial address opened directly) instead of a panel over the chart. */
  asPage?: boolean;
  /** On the full page: links back to the drug and approved use, shown above the title. */
  crumbs?: React.ReactNode;
  /** This use's approvals, oldest first; the first and the one the trial's document belongs to are marked on its timeline. */
  approvals?: TimelineApproval[];
}

const PHASE_TEXT: Record<Trial['phase'], string> = {
  EARLY_PHASE1: 'Early Phase 1',
  PHASE1: 'Phase 1',
  PHASE1_2: 'Phase 1/2',
  PHASE2: 'Phase 2',
  PHASE2_3: 'Phase 2/3',
  PHASE3: 'Phase 3',
  PHASE4: 'Phase 4',
  NA: 'N/A',
};

export function TrialDrawer({ trial, onClose, indication, asPage = false, crumbs, approvals = [] }: Props) {
  // Escape closes the drawer, matching the expectation for an overlay panel.
  useEffect(() => {
    if (asPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, asPage]);

  const registryUrl = trial.nctId
    ? `https://clinicaltrials.gov/study/${trial.nctId}`
    : null;
  const role = indication ? roleFor(trial, indication) ?? 'NOT_IN_FILING' : summaryRole(trial);
  const otherIndications = trial.roles.filter((r) => r.indication && r.indication !== indication);

  const Title = asPage ? 'h1' : 'h2';
  const design = [
    trial.design?.allocation && registryText(trial.design.allocation),
    trial.design?.masking && maskingText(trial.design.masking),
    trial.design?.model && registryText(trial.design.model),
  ].filter(Boolean);
  const age = trial.population?.minAge
    ? `${trial.population.minAge}${trial.population.maxAge ? ` – ${trial.population.maxAge}` : ' and older'}`
    : undefined;

  const roleEntry = indication ? trial.roles.find((r) => r.indication === indication) : undefined;
  // The first approval for this use, and the one the trial's document belongs to when it is a later one.
  const shown = approvals.filter(
    (a, i) => i === 0 || (roleEntry?.approval?.submission && a.submission === roleEntry.approval.submission),
  );
  const hasResults = Boolean(trial.postedResults?.length);
  const showResults = trial.primaryEndpoints.length > 0 || hasResults;
  const about = Boolean(trial.population?.summary || trial.population?.keyCriteria.length);

  const body = (
    <>
        <header className="drawer__head">
          <div>
            {crumbs}
            <div className="drawer__eyebrow">
              {[PHASE_TEXT[trial.phase], ROLE_LABEL[role], trial.status && registryText(trial.status)].filter(Boolean).join(' · ')}
              {/* On the full page the links above name the approved use. */}
              {indication && !asPage ? ` · ${indication}` : ''}
            </div>
            <Title className="drawer__title">
              {trialShortName(trial)}
              {trial.nctId && registryUrl && (
                <a className="drawer__title-nct" href={registryUrl} target="_blank" rel="noopener noreferrer">
                  {trial.nctId}
                </a>
              )}
            </Title>
          </div>
          {!asPage && (
            <button className="drawer__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </header>

        {/* Three numbers: how many, how it was run, who. */}
        <dl className="tr__numbers">
          {trial.enrollment && (
            <div>
              <dt>Enrolled</dt>
              <dd className="nums">
                {trial.enrollment.count.toLocaleString()}
                <span className="tr__unit">{trial.enrollment.type === 'ESTIMATED' ? 'patients (estimated)' : 'patients'}</span>
              </dd>
            </div>
          )}
          {design.length > 0 && (
            <div>
              <dt>Design</dt>
              <dd className="tr__text">{design.join(', ')}</dd>
            </div>
          )}
          {age && (
            <div>
              <dt>Age</dt>
              <dd className="tr__text">{age}</dd>
            </div>
          )}
        </dl>

        {showResults && (
          <section className="tr__card" aria-labelledby="tr-results">
            <div className="tr__card-head">
              <h3 id="tr-results">What the trial showed</h3>
              {trial.metPrimaryEndpoint !== null && (
                <span className={`drawer__met ${trial.metPrimaryEndpoint ? 'is-met' : 'is-not-met'}`}>
                  {trial.metPrimaryEndpoint ? 'Met primary endpoint' : 'Did not meet primary endpoint'}
                </span>
              )}
            </div>
            {hasResults ? (
              <PostedResults bars outcomes={trial.postedResults!} sourceUrl={trial.provenance.postedResults?.sourceUrl} />
            ) : (
              <>
                <ul className="drawer__list">
                  {trial.primaryEndpoints.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <p className="drawer__note">No results posted to ClinicalTrials.gov.</p>
              </>
            )}
            {trial.resultsSummary && <p className="drawer__prose">{trial.resultsSummary}</p>}
          </section>
        )}

        <section className="drawer__section" aria-labelledby="tr-when">
          <h3 id="tr-when">When it ran</h3>
          {trial.startDate ? (
            <TrialTimeline trial={trial} approvals={shown} />
          ) : (
            <p className="drawer__note">Start date not posted. Primary completion {formatDate(trial.primaryCompletionDate)}.</p>
          )}
        </section>

        {/* Narrative sections are written by a person and stay hidden until written. */}
        {trial.takeaways.length > 0 && (
          <section className="drawer__section">
            <h3>Takeaways</h3>
            <ul className="drawer__list">
              {trial.takeaways.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}

        {trial.limitations.length > 0 && (
          <section className="drawer__section">
            <h3>Limitations</h3>
            <ul className="drawer__list">
              {trial.limitations.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}

        {trial.publications.length > 0 && (
          <section className="drawer__section">
            <h3>Publications</h3>
            <ul className="drawer__list">
              {trial.publications.map((pub, i) => (
                <li key={i}>
                  {pub.url ? (
                    <a href={pub.url} target="_blank" rel="noopener noreferrer">
                      {pub.title}
                    </a>
                  ) : (
                    pub.title
                  )}
                  {pub.citation && <span className="drawer__cite"> — {pub.citation}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The registry's own title and entry rules, one switch away. */}
        <details className="tr__more">
          <summary>{about ? 'Full title and who could enrol' : 'Full title'}</summary>
          <p className="tr__full-title">{trial.title}</p>
          {trial.population?.summary && <p className="drawer__prose">{trial.population.summary}</p>}
          {trial.population?.keyCriteria.length ? (
            <ul className="drawer__list">
              {trial.population.keyCriteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </details>

        <SourceTrail trial={trial} indication={indication}>
          {trial.protocolNumber && (
            <div className="trail__row">
              <dt>Protocol</dt>
              <dd className="nums">{trial.protocolNumber}</dd>
            </div>
          )}
          {trial.sponsor && (
            <div className="trail__row">
              <dt>Sponsor</dt>
              <dd>{trial.sponsor}</dd>
            </div>
          )}
          {otherIndications.length > 0 && (
            <div className="trail__row">
              <dt>Also cited for</dt>
              <dd>{otherIndications.map((r) => r.indication).join(', ')}</dd>
            </div>
          )}
        </SourceTrail>
    </>
  );

  if (asPage) return <article className="drawer drawer--page">{body}</article>;
  return (
    <>
      <div className="drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-label={`Trial detail: ${trial.title}`}>
        {body}
      </aside>
    </>
  );
}
