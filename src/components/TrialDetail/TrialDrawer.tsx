import { useEffect } from 'react';
import { PostedResults } from './PostedResults.js';
import { SourceTrail } from './SourceTrail.js';
import { registryText, maskingText } from '../../lib/registryText.js';
import type { Trial, Provenance } from '../../schema/index.js';
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
  /** Which approval the trial stands behind, in a sentence ("Primary completion Nov 2015, before …"). */
  supports?: string;
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

// A fact's provenance is kept with the data for the builders' checks; readers
// see only the value (how facts are checked is on the About the data page).
function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
  provenance?: Provenance;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value}
      </dd>
    </>
  );
}

export function TrialDrawer({ trial, onClose, indication, asPage = false, crumbs, supports }: Props) {
  // Escape closes the drawer, matching the expectation for an overlay panel.
  useEffect(() => {
    if (asPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, asPage]);

  const p = trial.provenance;
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

  const body = (
    <>
        <header className="drawer__head">
          <div>
            {crumbs}
            <div className="drawer__eyebrow">
              {PHASE_TEXT[trial.phase]} · {ROLE_LABEL[role]}
              {/* On the full page the links above name the approved use. */}
              {indication && !asPage ? ` for ${indication}` : ''}
            </div>
            <Title className="drawer__title">
              {trialShortName(trial)}
              {trial.nctId && registryUrl && (
                <a className="drawer__title-nct" href={registryUrl} target="_blank" rel="noopener noreferrer">
                  ({trial.nctId})
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

        <p className="drawer__full-title">{trial.title}</p>
        {supports && <p className="drawer__supports">{supports}</p>}

        {/* The trial at a glance: what an analyst reads first. */}
        <ul className="drawer__glance">
          {trial.enrollment && (
            <li>
              <span>Enrolled</span>
              {trial.enrollment.count.toLocaleString()}
              {trial.enrollment.type === 'ESTIMATED' ? ' (estimated)' : ''}
            </li>
          )}
          {design.length > 0 && (
            <li>
              <span>Design</span>
              {design.join(', ')}
            </li>
          )}
          {age && (
            <li>
              <span>Age</span>
              {age}
            </li>
          )}
          <li>
            <span>Primary completion</span>
            {formatDate(trial.primaryCompletionDate)}
          </li>
        </ul>

        {(trial.primaryEndpoints.length > 0 || trial.postedResults?.length || trial.metPrimaryEndpoint !== null) && (
          <section className="drawer__section">
            <h3>
              Primary endpoint{trial.primaryEndpoints.length > 1 ? 's' : ''} and results
              {trial.metPrimaryEndpoint !== null && (
                <span className={`drawer__met ${trial.metPrimaryEndpoint ? 'is-met' : 'is-not-met'}`}>
                  {trial.metPrimaryEndpoint ? 'Met primary endpoint' : 'Did not meet primary endpoint'}
                </span>
              )}
            </h3>
            {trial.postedResults?.length ? (
              <PostedResults outcomes={trial.postedResults} sourceUrl={trial.provenance.postedResults?.sourceUrl} />
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

        <div className="drawer__cols">
          <section className="drawer__section">
            <h3>Dates</h3>
            <dl className="drawer__facts">
              <Fact label="Start" value={formatDate(trial.startDate)} provenance={p.startDate} />
              <Fact label="Primary completion" value={formatDate(trial.primaryCompletionDate)} provenance={p.primaryCompletionDate} />
              {trial.readoutDate && <Fact label="Results announced" value={formatDate(trial.readoutDate)} provenance={p.readoutDate} />}
              <Fact label="Study completion" value={formatDate(trial.completionDate)} />
              {trial.status && <Fact label="Status" value={registryText(trial.status)} />}
            </dl>
          </section>

          <section className="drawer__section">
            <h3>Design</h3>
            <dl className="drawer__facts">
              {trial.enrollment && (
                <Fact
                  label="Enrollment"
                  value={`${trial.enrollment.count.toLocaleString()} participants${trial.enrollment.type === 'ESTIMATED' ? ' (estimated)' : ''}`}
                  provenance={p.enrollment}
                />
              )}
              {trial.population?.summary && <Fact label="Population" value={trial.population.summary} />}
              {age && <Fact label="Age" value={age} />}
              {trial.design?.allocation && <Fact label="Allocation" value={registryText(trial.design.allocation)} />}
              {trial.design?.masking && <Fact label="Masking" value={maskingText(trial.design.masking)} />}
              {trial.design?.model && <Fact label="Model" value={registryText(trial.design.model)} />}
            </dl>
            {trial.population?.keyCriteria.length ? (
              <ul className="drawer__list">
                {trial.population.keyCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

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

        <div className="drawer__cols">
          <SourceTrail trial={trial} indication={indication} />
          <section className="drawer__section">
            <h3>Identifiers</h3>
            <dl className="drawer__facts">
              {trial.nctId && (
                <Fact
                  label="Registry"
                  value={
                    <a href={registryUrl!} target="_blank" rel="noopener noreferrer">
                      {trial.nctId}
                    </a>
                  }
                />
              )}
              {trial.protocolNumber && <Fact label="Protocol" value={trial.protocolNumber} />}
              {trial.sponsor && <Fact label="Sponsor" value={trial.sponsor} />}
            </dl>
            {otherIndications.length > 0 && (
              <p className="drawer__note">Also cited for {otherIndications.map((r) => r.indication).join(', ')}.</p>
            )}
          </section>
        </div>
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
