import { useEffect } from 'react';
import type { Trial, Provenance } from '../../schema/index.js';
import { formatDate } from '../../lib/dates.js';
import { roleFor, summaryRole } from '../../lib/drugs.js';
import { ROLE_LABEL } from '../Gantt/Gantt.js';
import './TrialDrawer.css';

interface Props {
  trial: Trial;
  onClose: () => void;
  /** When set, the eyebrow shows this trial's role for one specific indication. */
  indication?: string;
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

/**
 * Shows whether a value was checked by a person or inferred by the pipeline.
 * Unverified is the default state for freshly ingested data, so it needs to be
 * visible rather than implied.
 */
function ProvenanceBadge({ p }: { p: Provenance | undefined }) {
  if (!p) return null;
  const label = p.verified ? 'verified' : `unverified · ${p.extractedBy}`;
  return (
    <span
      className={`prov ${p.verified ? 'is-verified' : 'is-unverified'}`}
      title={
        [p.sourceLabel, p.page ? `p. ${p.page}` : null, p.quote ? `"${p.quote}"` : null]
          .filter(Boolean)
          .join(' — ') || undefined
      }
    >
      {label}
    </span>
  );
}

function Fact({
  label,
  value,
  provenance,
}: {
  label: string;
  value: React.ReactNode;
  provenance?: Provenance;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {value} <ProvenanceBadge p={provenance} />
      </dd>
    </>
  );
}

export function TrialDrawer({ trial, onClose, indication }: Props) {
  // Escape closes the drawer, matching the expectation for an overlay panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const p = trial.provenance;
  const registryUrl = trial.nctId
    ? `https://clinicaltrials.gov/study/${trial.nctId}`
    : null;
  const role = indication ? roleFor(trial, indication) ?? 'NOT_IN_FILING' : summaryRole(trial);
  const otherIndications = trial.roles.filter((r) => r.indication && r.indication !== indication);

  return (
    <>
      <div className="drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-label={`Trial detail: ${trial.title}`}>
        <header className="drawer__head">
          <div>
            <div className="drawer__eyebrow">
              {PHASE_TEXT[trial.phase]} · {ROLE_LABEL[role]}
              {indication ? ` for ${indication}` : ''}
            </div>
            <h2 className="drawer__title">
              {trial.acronym ?? trial.protocolNumber ?? trial.nctId ?? trial.id}
            </h2>
          </div>
          <button className="drawer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="drawer__full-title">{trial.title}</p>

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
            {trial.protocolNumber && (
              <Fact label="Protocol" value={trial.protocolNumber} />
            )}
            {trial.sponsor && <Fact label="Sponsor" value={trial.sponsor} />}
            {trial.status && <Fact label="Status" value={trial.status} />}
          </dl>
          {otherIndications.length > 0 && (
            <p className="drawer__note">
              Also cited for {otherIndications.map((r) => r.indication).join(', ')}.
            </p>
          )}
        </section>

        <section className="drawer__section">
          <h3>Timeline</h3>
          <dl className="drawer__facts">
            <Fact
              label="Start"
              value={formatDate(trial.startDate)}
              provenance={p.startDate}
            />
            <Fact
              label="Primary completion"
              value={formatDate(trial.primaryCompletionDate)}
              provenance={p.primaryCompletionDate}
            />
            <Fact label="Completion" value={formatDate(trial.completionDate)} />
          </dl>
        </section>

        <section className="drawer__section">
          <h3>Cohort &amp; design</h3>
          <dl className="drawer__facts">
            {trial.enrollment && (
              <Fact
                label="Enrollment"
                value={`${trial.enrollment.count.toLocaleString()} participants${
                  trial.enrollment.type === 'ESTIMATED' ? ' (estimated)' : ''
                }`}
                provenance={p.enrollment}
              />
            )}
            {trial.population?.summary && (
              <Fact label="Population" value={trial.population.summary} />
            )}
            {trial.population?.minAge && (
              <Fact
                label="Age"
                value={`${trial.population.minAge}${
                  trial.population.maxAge ? ` – ${trial.population.maxAge}` : ' and older'
                }`}
              />
            )}
            {trial.design?.allocation && (
              <Fact label="Allocation" value={trial.design.allocation} />
            )}
            {trial.design?.masking && <Fact label="Masking" value={trial.design.masking} />}
            {trial.design?.model && <Fact label="Model" value={trial.design.model} />}
          </dl>
          {trial.population?.keyCriteria.length ? (
            <ul className="drawer__list">
              {trial.population.keyCriteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {(trial.primaryEndpoints.length > 0 || trial.resultsSummary) && (
          <section className="drawer__section">
            <h3>Endpoints &amp; results</h3>
            {trial.primaryEndpoints.length > 0 && (
              <>
                <h4>Primary</h4>
                <ul className="drawer__list">
                  {trial.primaryEndpoints.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </>
            )}
            {trial.secondaryEndpoints.length > 0 && (
              <>
                <h4>Key secondary</h4>
                <ul className="drawer__list">
                  {trial.secondaryEndpoints.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </>
            )}
            {trial.resultsSummary && <p className="drawer__prose">{trial.resultsSummary}</p>}
          </section>
        )}

        {/* Narrative sections are human-authored and stay hidden until written,
            rather than showing an empty shell. */}
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

        {trial.takeaways.length === 0 && trial.limitations.length === 0 && (
          <p className="drawer__empty">
            Takeaways and limitations for this trial have not been written yet. They are
            authored by hand — the pipeline does not infer them.
          </p>
        )}
      </aside>
    </>
  );
}
