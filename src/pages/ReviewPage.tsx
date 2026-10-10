import { useEffect, useState } from 'react';
import { summaryRole, ROLE_LABEL } from '../lib/drugs.js';
import { drugIndex, useDrug } from '../lib/catalog.js';
import { BackLink } from '../components/BackLink/BackLink.js';
import { Drug } from '../schema/index.js';
import type { Drug as DrugType, Indication, Trial, TrialRole } from '../schema/index.js';
import {
  drugStats,
  trialStats,
  reviewableFields,
  fieldValue,
  setFieldVerified,
  correctField,
  setRoleVerified,
  correctRole,
  replaceTrial,
  serializeDrug,
  pendingChange,
  drugPendingChangeCount,
  acknowledgeChange,
  crossConfirmed,
  setIndicationDisplayName,
  setWriteUp,
} from '../lib/review.js';
import { formatDate } from '../lib/dates.js';
import { reviewHref, reviewDrugHref } from '../lib/router.js';
import './ReviewPage.css';

const FIELD_LABEL: Record<string, string> = {
  nctId: 'Registry ID',
  protocolNumber: 'Protocol number',
  acronym: 'Acronym',
  title: 'Title',
  briefTitle: 'Brief title',
  phase: 'Phase',
  status: 'Status',
  sponsor: 'Sponsor',
  startDate: 'Start date',
  primaryCompletionDate: 'Primary completion',
  completionDate: 'Completion',
  enrollment: 'Enrollment',
  design: 'Design',
  population: 'Population',
  arms: 'Arms',
  primaryEndpoints: 'Primary endpoints',
  secondaryEndpoints: 'Secondary endpoints',
  citedIn: 'Cited in FDA review',
  postedResults: 'Posted results (primary outcomes)',
};

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

interface Props {
  slug?: string;
}

export function ReviewPage({ slug }: Props) {
  if (!slug) return <ReviewIndex />;
  return <DrugReview slug={slug} />;
}

function ReviewIndex() {
  return (
    <main className="review">
      <BackLink href="#/" label="All drugs" />
      <header className="review__head">
        <p className="review__eyebrow">Verification</p>
        <h1>Review extracted data</h1>
        <p className="review__lede">
          Every field the pipeline writes is marked <code>verified: false</code> until a
          person checks it against the source documents. Pick a drug to start reviewing it,
          field by field.
        </p>
      </header>
      <ul className="review__drug-list">
        {drugIndex.map((d) => {
          const stats = d.verification;
          const pct = stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0;
          const pendingChanges = d.pendingChanges;
          return (
            <li key={d.slug}>
              <a href={reviewDrugHref(d.slug)} className="review__drug-row">
                <div>
                  <div className="review__drug-name">{d.brandName}</div>
                  <div className="review__drug-inn">{d.inn}</div>
                </div>
                <div className="review__drug-progress">
                  {pendingChanges > 0 && (
                    <span className="review__changed-badge">
                      {pendingChanges} changed
                    </span>
                  )}
                  <div className="review__bar">
                    <div className="review__bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="review__progress-text">
                    {stats.total === 0 ? 'nothing tracked' : `${stats.verified}/${stats.total} verified`}
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function draftKey(slug: string): string {
  return `review-draft:${slug}`;
}

/** Restores an in-progress review from this browser, validated against the current schema. */
function loadDraft(slug: string, fallback: DrugType): DrugType {
  try {
    const raw = localStorage.getItem(draftKey(slug));
    if (!raw) return fallback;
    const parsed = Drug.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.slug === slug ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function saveDraft(slug: string, drug: DrugType): void {
  try {
    localStorage.setItem(draftKey(slug), JSON.stringify(drug));
  } catch {
    // Private browsing, full quota, or a disabled storage API — the draft
    // just won't survive a reload. Download/copy still work either way.
  }
}

function DrugReview({ slug }: { slug: string }) {
  const state = useDrug(slug);
  if (state.status === 'ready') return <DrugReviewLoaded key={slug} slug={slug} committed={state.drug} />;
  return (
    <main className="review">
      <BackLink href={reviewHref()} label="All drugs under review" />
      <p className="review__missing">
        {state.status === 'loading' && 'Loading…'}
        {state.status === 'missing' && `No drug record found for “${slug}”.`}
        {state.status === 'error' && 'Couldn’t load this drug’s data — check your connection and reload.'}
      </p>
    </main>
  );
}

function DrugReviewLoaded({ slug, committed }: { slug: string; committed: DrugType }) {
  const [drug, setDrug] = useState<DrugType>(() => loadDraft(slug, committed));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showNotCited, setShowNotCited] = useState(false);

  useEffect(() => {
    saveDraft(slug, drug);
  }, [drug, slug]);

  const stats = drugStats(drug);
  const hasDraft = serializeDrug(drug) !== serializeDrug(committed);
  const pendingChanges = drugPendingChangeCount(drug);
  const citedTrials = drug.trials.filter((t) => summaryRole(t) !== 'NOT_IN_FILING');
  const notCitedTrials = drug.trials.filter((t) => summaryRole(t) === 'NOT_IN_FILING');

  function updateTrial(updated: Trial) {
    setDrug((d) => replaceTrial(d, updated.id, updated));
  }

  function handleDiscard() {
    try {
      localStorage.removeItem(draftKey(slug));
    } catch {
      // Nothing to clean up if storage was never reachable.
    }
    setDrug(committed);
    setExportError(null);
  }

  function handleDownload() {
    const parsed = Drug.safeParse(drug);
    if (!parsed.success) {
      setExportError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      );
      return;
    }
    setExportError(null);
    const blob = new Blob([serializeDrug(parsed.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(serializeDrug(drug));
    } catch {
      // No clipboard permission in this context — download is the fallback.
    }
  }

  return (
    <main className="review">
      <BackLink href={reviewHref()} label="All drugs under review" />

      <header className="review__drug-head">
        <div>
          <h1>
            {drug.brandName} <span className="review__inn">({drug.inn})</span>
          </h1>
          <p className="review__progress-line">
            {stats.total === 0
              ? 'Nothing from the pipeline is tracked for this drug.'
              : `${stats.verified} of ${stats.total} tracked fields verified`}
            {pendingChanges > 0 && (
              <span className="review__changed-badge">
                {pendingChanges} changed since last review
              </span>
            )}
            {hasDraft && <span className="review__draft-flag">unsaved draft</span>}
          </p>
        </div>
        <div className="review__actions">
          {hasDraft && (
            <button type="button" className="review__btn-ghost" onClick={handleDiscard}>
              Discard draft
            </button>
          )}
          <button type="button" className="review__btn-ghost" onClick={handleCopy}>
            Copy JSON
          </button>
          <button type="button" className="review__btn-primary" onClick={handleDownload}>
            Download {slug}.json
          </button>
        </div>
      </header>

      {exportError && (
        <div className="review__error" role="alert">
          Can&rsquo;t export — the edited record doesn&rsquo;t match the schema: {exportError}
        </div>
      )}

      <p className="review__instructions">
        Check each field against{' '}
        {drug.sources.length > 0
          ? drug.sources.map((s, i) => (
              <span key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
                {i < drug.sources.length - 1 ? ', ' : ''}
              </span>
            ))
          : 'the source documents'}
        , correct it if it&rsquo;s wrong, then mark it verified. When you&rsquo;re done,
        download the file and commit it over <code>data/drugs/{slug}.json</code>.
      </p>

      {drug.indications.length > 0 && (
        <section className="review__indications">
          <h2 className="review__section-title">Indications</h2>
          <ul>
            {drug.indications.map((i) => (
              <IndicationRow
                key={i.slug}
                indication={i}
                onRename={(name) => setDrug((d) => setIndicationDisplayName(d, i.slug, name))}
              />
            ))}
          </ul>
        </section>
      )}

      <h2 className="review__section-title">Trials</h2>
      <ul className="review__trials">
        {citedTrials.map((t) => (
          <TrialRow
            key={t.id}
            trial={t}
            isOpen={expandedId === t.id}
            onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
            onChange={updateTrial}
          />
        ))}
      </ul>

      {notCitedTrials.length > 0 && (
        <div className="review__not-cited">
          <button
            type="button"
            className="review__btn-ghost review__not-cited-toggle"
            onClick={() => setShowNotCited((v) => !v)}
          >
            {showNotCited ? 'Hide' : 'Show'} {notCitedTrials.length} trial
            {notCitedTrials.length === 1 ? '' : 's'} not cited in the filing
          </button>
          <p className="review__not-cited-note">
            Registered against this drug but not named in the approval package — later
            indications, other regions, or post-marketing work. Nothing to verify against
            this approval, but kept here (not deleted) in case a future indication or
            region cites one of them.
          </p>
          {showNotCited && (
            <ul className="review__trials">
              {notCitedTrials.map((t) => (
                <TrialRow
                  key={t.id}
                  trial={t}
                  isOpen={expandedId === t.id}
                  onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  onChange={updateTrial}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

function TrialRow({
  trial: t,
  isOpen,
  onToggle,
  onChange,
}: {
  trial: Trial;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (t: Trial) => void;
}) {
  const tStats = trialStats(t);
  const complete = tStats.total > 0 && tStats.verified === tStats.total;
  const role = summaryRole(t);
  return (
    <li className="review__trial">
      <div className="review__trial-head">
        <button
          type="button"
          className="review__trial-toggle"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <span className="review__trial-name">{t.acronym ?? t.protocolNumber ?? t.id}</span>
          <span className="review__trial-title">{t.briefTitle ?? t.title}</span>
        </button>
        {t.nctId && (
          <a
            className="review__trial-nct"
            href={`https://clinicaltrials.gov/study/${t.nctId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            ({t.nctId})
          </a>
        )}
        <span className={`review__role-badge role-${role.toLowerCase()}`}>
          {ROLE_LABEL[role]}
        </span>
        {crossConfirmed(t) && (
          <span className="review__confirmed-badge" title="Named in both the label's section 14 and the FDA review — two independent documents">
            ✓ 2 sources
          </span>
        )}
        {t.changeLog.length > 0 && (
          <span className="review__changed-badge">{t.changeLog.length} changed</span>
        )}
        <span className={`review__trial-stat ${complete ? 'is-complete' : ''}`}>
          {tStats.total === 0 ? 'nothing tracked' : `${tStats.verified}/${tStats.total}`}
        </span>
      </div>
      {isOpen && <TrialReview trial={t} onChange={onChange} />}
    </li>
  );
}

function TrialReview({ trial, onChange }: { trial: Trial; onChange: (t: Trial) => void }) {
  const fields = reviewableFields(trial);
  return (
    <div className="review__trial-body">
      {fields.length === 0 && trial.roles.length === 0 && (
        <p className="review__trial-empty">
          Nothing from the pipeline is tracked for this trial.
        </p>
      )}
      {fields.map((field) => (
        <FieldRow
          key={field}
          trial={trial}
          field={field}
          onVerify={(v) => onChange(setFieldVerified(trial, field, v))}
          onCorrect={(value) => onChange(correctField(trial, field, value))}
          onAcknowledge={() => onChange(acknowledgeChange(trial, field))}
        />
      ))}
      {trial.roles.map((role, i) => (
        <RoleRow
          key={i}
          role={role}
          onVerify={(v) => onChange(setRoleVerified(trial, i, v))}
          onCorrect={(patch) => onChange(correctRole(trial, i, patch))}
        />
      ))}
      <WriteUpEditor trial={trial} onChange={(patch) => onChange(setWriteUp(trial, patch))} />
    </div>
  );
}

const lines = (text: string) => text.split('\n');

function WriteUpEditor({ trial, onChange }: { trial: Trial; onChange: (patch: Parameters<typeof setWriteUp>[1]) => void }) {
  // Local drafts committed on blur, so typing isn't fought by trimming.
  const [summary, setSummary] = useState(trial.resultsSummary ?? '');
  const [takeaways, setTakeaways] = useState(trial.takeaways.join('\n'));
  const [limitations, setLimitations] = useState(trial.limitations.join('\n'));
  const met = trial.metPrimaryEndpoint === null ? '' : String(trial.metPrimaryEndpoint);
  return (
    <fieldset className="review__writeup">
      <legend>Your write-up</legend>
      <p className="review__writeup-note">
        Written by you, not extracted — shown on the trial's detail panel once filled in.
      </p>
      <label>
        Met primary endpoint?
        <select
          value={met}
          onChange={(e) => onChange({ metPrimaryEndpoint: e.target.value === '' ? null : e.target.value === 'true' })}
        >
          <option value="">Not determined</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label>
        Results summary
        <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => onChange({ resultsSummary: summary })} />
      </label>
      <label>
        <span className="review__writeup-label">
          Takeaways <span>(one per line)</span>
        </span>
        <textarea rows={3} value={takeaways} onChange={(e) => setTakeaways(e.target.value)} onBlur={() => onChange({ takeaways: lines(takeaways) })} />
      </label>
      <label>
        <span className="review__writeup-label">
          Limitations <span>(one per line)</span>
        </span>
        <textarea rows={3} value={limitations} onChange={(e) => setLimitations(e.target.value)} onBlur={() => onChange({ limitations: lines(limitations) })} />
      </label>
    </fieldset>
  );
}

function FieldValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="review__empty-value">—</span>;
  }
  if (typeof value === 'string') return <span>{value}</span>;
  if (typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>;
  return <pre className="review__value-json">{JSON.stringify(value, null, 2)}</pre>;
}

function FieldRow({
  trial,
  field,
  onVerify,
  onCorrect,
  onAcknowledge,
}: {
  trial: Trial;
  field: string;
  onVerify: (v: boolean) => void;
  onCorrect: (value: unknown) => void;
  onAcknowledge: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const prov = trial.provenance[field];
  const value = fieldValue(trial, field);
  const change = pendingChange(trial, field);

  function startEdit() {
    setDraft(JSON.stringify(value, null, 2));
    setParseError(null);
    setEditing(true);
  }

  function save() {
    try {
      onCorrect(JSON.parse(draft));
      setEditing(false);
      setParseError(null);
    } catch {
      setParseError('Not valid JSON — a text value needs quotes, e.g. "Phase 3".');
    }
  }

  return (
    <div className={`review__field ${prov?.verified ? 'is-verified' : ''}`}>
      <div className="review__field-head">
        <label className="review__verify">
          <input
            type="checkbox"
            checked={prov?.verified ?? false}
            onChange={(e) => onVerify(e.target.checked)}
          />
          {fieldLabel(field)}
        </label>
        <span className="review__prov-meta">
          {prov?.extractedBy}
          {prov?.sourceUrl && (
            <>
              {' · '}
              <a href={prov.sourceUrl} target="_blank" rel="noopener noreferrer">
                source
              </a>
            </>
          )}
          {typeof prov?.page === 'number' && ` · p. ${prov.page}`}
        </span>
      </div>

      {change && (
        <div className="review__change-notice">
          <div className="review__change-diff">
            <span className="review__change-was">
              <FieldValueDisplay value={change.previousValue} />
            </span>
            <span className="review__change-arrow" aria-hidden="true">
              →
            </span>
            <span className="review__change-now">
              <FieldValueDisplay value={change.newValue} />
            </span>
          </div>
          <button type="button" className="review__btn-ghost review__btn-small" onClick={onAcknowledge}>
            Acknowledge
          </button>
        </div>
      )}

      {prov?.quote && <p className="review__quote">&ldquo;{prov.quote}&rdquo;</p>}

      {editing ? (
        <div className="review__edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, draft.split('\n').length + 1)}
            spellCheck={false}
          />
          {parseError && <p className="review__parse-error">{parseError}</p>}
          <div className="review__edit-actions">
            <button type="button" className="review__btn-primary review__btn-small" onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="review__btn-ghost review__btn-small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="review__value" onClick={startEdit}>
          <FieldValueDisplay value={value} />
          <span className="review__edit-hint">edit</span>
        </button>
      )}
    </div>
  );
}

const TRIAL_ROLES: TrialRole[] = [
  'PIVOTAL',
  'SUPPORTIVE',
  'DOSE_FINDING',
  'PK',
  'SAFETY',
  'POST_MARKETING',
  'NOT_IN_FILING',
  'UNKNOWN',
];

function RoleRow({
  role,
  onVerify,
  onCorrect,
}: {
  role: Trial['roles'][number];
  onVerify: (v: boolean) => void;
  onCorrect: (patch: { indication?: string; role: TrialRole }) => void;
}) {
  return (
    <div className={`review__field ${role.provenance.verified ? 'is-verified' : ''}`}>
      <div className="review__field-head">
        <label className="review__verify">
          <input
            type="checkbox"
            checked={role.provenance.verified}
            onChange={(e) => onVerify(e.target.checked)}
          />
          Role{role.indication ? ` — ${role.indication}` : ''}
        </label>
        <span className="review__prov-meta">{role.provenance.extractedBy}</span>
      </div>
      {role.provenance.quote && (
        <p className="review__quote">&ldquo;{role.provenance.quote}&rdquo;</p>
      )}
      <select
        className="review__role-select"
        value={role.role}
        onChange={(e) =>
          onCorrect({ indication: role.indication, role: e.target.value as TrialRole })
        }
      >
        {TRIAL_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}

function IndicationRow({ indication, onRename }: { indication: Indication; onRename: (name: string) => void }) {
  // Committed on blur, not per keystroke: the setter trims, which would eat
  // the space while someone is still typing "Chronic weight…".
  const [draft, setDraft] = useState(indication.displayName ?? '');
  const source = indication.approvalProvenance;
  return (
    <li className="review__indication">
      <div className="review__indication-wording">{indication.name}</div>
      <div className="review__indication-meta">
        {indication.approvalDate ? `Approved ${formatDate(indication.approvalDate)}` : 'Approval date not determined'}
        {source?.sourceUrl && (
          <>
            {' · '}
            <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" title={source.quote}>
              {source.sourceLabel ?? 'source'} ↗
            </a>
          </>
        )}
      </div>
      <label className="review__indication-name">
        Short display name
        <input
          value={draft}
          placeholder="Optional — shown instead of the label wording"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
    </li>
  );
}
