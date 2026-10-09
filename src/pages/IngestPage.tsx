import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  dispatchIngestWorkflow,
  findLatestRun,
  getRun,
  getRunSteps,
  mergePullRequest,
  resolveIngestOutcome,
  GitHubApiError,
  NEW_TOKEN_URL,
  type PullRequestSummary,
  type RunStep,
  type WorkflowRun,
} from '../lib/github.js';
import './IngestPage.css';

const TOKEN_STORAGE_KEY = 'ingest-github-token';

function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private browsing / blocked storage — the token just won't persist across visits.
  }
}

const APPLICATION_PATTERN = /^(NDA|BLA|ANDA)\s+\S+$/i;
const POLL_MS = 3000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'locating-run' }
  | { kind: 'running'; run: WorkflowRun; steps: RunStep[] }
  | { kind: 'run-failed'; run: WorkflowRun }
  | { kind: 'resolving-outcome' }
  | { kind: 'no-changes' }
  | { kind: 'pr-ready'; pr: PullRequestSummary }
  | { kind: 'merging'; pr: PullRequestSummary }
  | { kind: 'merged'; pr: PullRequestSummary }
  | { kind: 'merge-failed'; pr: PullRequestSummary; message: string }
  | { kind: 'error'; message: string };

function stepIcon(step: RunStep): string {
  if (step.status !== 'completed') return '⏳';
  if (step.conclusion === 'success') return '✅';
  if (step.conclusion === 'skipped') return '⊘';
  return '❌';
}

export function IngestPage() {
  const [token, setToken] = useState(loadToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [editingToken, setEditingToken] = useState(token === '');

  const [drug, setDrug] = useState('');
  const [brandName, setBrandName] = useState('');
  const [inn, setInn] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [modality, setModality] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [application, setApplication] = useState('');
  const [refresh, setRefresh] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // The slug a run was started for — resolveIngestOutcome needs it, and the
  // form's own `drug` state shouldn't drive an in-flight run if edited.
  const slugRef = useRef('');

  useEffect(() => {
    if (phase.kind !== 'running') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [fresh, steps] = await Promise.all([
          getRun(token, phase.run.id),
          getRunSteps(token, phase.run.id).catch(() => phase.steps),
        ]);
        if (cancelled) return;
        if (fresh.status === 'completed') {
          setPhase(fresh.conclusion === 'success' ? { kind: 'resolving-outcome' } : { kind: 'run-failed', run: fresh });
        } else {
          setPhase({ kind: 'running', run: fresh, steps });
        }
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: 'error',
          message: err instanceof GitHubApiError ? err.message : 'Lost contact with GitHub while watching the run.',
        });
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, token]);

  useEffect(() => {
    if (phase.kind !== 'resolving-outcome') return;
    let cancelled = false;
    resolveIngestOutcome(token, slugRef.current)
      .then((outcome) => {
        if (cancelled) return;
        setPhase(outcome.kind === 'no-changes' ? { kind: 'no-changes' } : { kind: 'pr-ready', pr: outcome.pr });
      })
      .catch((err) => {
        if (cancelled) return;
        setPhase({
          kind: 'error',
          message:
            err instanceof GitHubApiError
              ? err.message
              : 'The run finished, but looking up the resulting branch or pull request failed.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [phase.kind, token]);

  function handleSaveToken(e: FormEvent) {
    e.preventDefault();
    const trimmed = tokenDraft.trim();
    if (!trimmed) return;
    saveToken(trimmed);
    setToken(trimmed);
    setTokenDraft('');
    setEditingToken(false);
  }

  function handleForgetToken() {
    saveToken('');
    setToken('');
    setEditingToken(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const slug = drug.trim().toLowerCase();
    if (!slug) {
      setFormError('Enter a drug slug (the lowercase INN is the convention, e.g. "sotatercept").');
      return;
    }

    const newDrugFields = { brandName, inn, sponsor, modality };
    const filled = Object.values(newDrugFields).filter((v) => v.trim() !== '');
    if (filled.length > 0 && filled.length < 4) {
      setFormError(
        'To ingest a new drug, fill in brand name, INN, sponsor, and modality together — ' +
          'or leave all four blank to just re-run an existing, already-registered drug.'
      );
      return;
    }

    if (application.trim() && !APPLICATION_PATTERN.test(application.trim())) {
      setFormError('Application must look like "NDA 211675", "BLA 761342", or "ANDA 212345" — or leave it blank.');
      return;
    }

    slugRef.current = slug;
    setPhase({ kind: 'submitting' });
    try {
      await dispatchIngestWorkflow(token, {
        drug: slug,
        brandName: brandName.trim() || undefined,
        inn: inn.trim() || undefined,
        sponsor: sponsor.trim() || undefined,
        modality: modality.trim() || undefined,
        mechanism: mechanism.trim() || undefined,
        application: application.trim() || undefined,
        refresh,
      });
      setPhase({ kind: 'locating-run' });
      const run = await findLatestRun(token, new Date());
      if (run) {
        setPhase({ kind: 'running', run, steps: [] });
      } else {
        setPhase({
          kind: 'error',
          message: 'Started, but couldn’t find the run to track it. It may still be running — check the Actions tab.',
        });
      }
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof GitHubApiError ? err.message : 'Could not reach GitHub. Check your connection and try again.',
      });
    }
  }

  async function handleMerge(pr: PullRequestSummary) {
    setPhase({ kind: 'merging', pr });
    try {
      await mergePullRequest(token, pr.number);
      setPhase({ kind: 'merged', pr });
    } catch (err) {
      setPhase({
        kind: 'merge-failed',
        pr,
        message: err instanceof GitHubApiError ? err.message : 'Could not reach GitHub to merge the pull request.',
      });
    }
  }

  function startOver() {
    setPhase({ kind: 'idle' });
  }

  const submitting = phase.kind !== 'idle' && phase.kind !== 'error';

  return (
    <main className="ingest">
      <nav className="ingest__breadcrumb">
        <a href="#/">Search</a>
        <span aria-hidden="true"> / </span>
        <span>Add a drug</span>
      </nav>

      <header className="ingest__head">
        <h1>Add a drug</h1>
        <p className="ingest__lede">
          Runs the real ingest pipeline — openFDA Drugs@FDA, ClinicalTrials.gov, and the FDA's
          own approval documents. Nothing here is written or inferred by a language model.
          Everything below, including reviewing and merging the result, happens on this page —
          GitHub is only where the work actually runs.
        </p>
      </header>

      {!token || editingToken ? (
        <section className="ingest__token-setup">
          <h2>Connect a GitHub token</h2>
          <p>
            This page calls GitHub's API directly from your browser — there's no server in
            between. You'll need a personal access token scoped to just this repository:
          </p>
          <ol>
            <li>
              Open{' '}
              <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">
                GitHub → Settings → Fine-grained tokens → Generate new token
              </a>
              .
            </li>
            <li>Under "Repository access," choose "Only select repositories" and pick Pharma-Timeline-Tool.</li>
            <li>
              Under "Permissions" → "Repository permissions," set <strong>Actions</strong>,{' '}
              <strong>Contents</strong>, and <strong>Pull requests</strong> each to{' '}
              <strong>Read and write</strong>. (Actions runs the pipeline; Contents and Pull
              requests let this page open and merge the result without sending you back to
              GitHub.)
            </li>
            <li>Generate it, copy the token, and paste it below.</li>
          </ol>
          <p className="ingest__token-note">
            It's stored only in this browser's local storage — never sent anywhere but directly
            to GitHub's API. Revoke it anytime from GitHub's token settings.
          </p>
          <form className="ingest__token-form" onSubmit={handleSaveToken}>
            <label htmlFor="gh-token">Personal access token</label>
            <input
              id="gh-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_…"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
            />
            <button type="submit" disabled={!tokenDraft.trim()}>
              Save token
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className="ingest__token-status">
            Connected with a saved token. <button type="button" onClick={handleForgetToken}>Forget it</button>
          </div>

          <form className="ingest__form" onSubmit={handleSubmit}>
            <div className="ingest__field">
              <label htmlFor="drug">Drug slug</label>
              <input
                id="drug"
                value={drug}
                onChange={(e) => setDrug(e.target.value)}
                placeholder="e.g. sotatercept (lowercase INN)"
                disabled={submitting}
              />
              <p className="ingest__field-hint">
                An existing slug re-runs ingestion for that drug. A new one, with the fields
                below filled in, onboards a brand-new drug.
              </p>
            </div>

            <fieldset className="ingest__fieldset" disabled={submitting}>
              <legend>New drug only</legend>
              <div className="ingest__grid">
                <div className="ingest__field">
                  <label htmlFor="brand-name">Brand name</label>
                  <input id="brand-name" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. Winrevair" />
                </div>
                <div className="ingest__field">
                  <label htmlFor="inn">INN</label>
                  <input id="inn" value={inn} onChange={(e) => setInn(e.target.value)} placeholder="e.g. sotatercept" />
                </div>
                <div className="ingest__field">
                  <label htmlFor="sponsor">Sponsor</label>
                  <input id="sponsor" value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. Merck Sharp & Dohme LLC" />
                </div>
                <div className="ingest__field">
                  <label htmlFor="modality">Modality</label>
                  <input id="modality" value={modality} onChange={(e) => setModality(e.target.value)} placeholder="e.g. Fusion protein" />
                </div>
                <div className="ingest__field ingest__field--wide">
                  <label htmlFor="mechanism">Mechanism (optional)</label>
                  <input id="mechanism" value={mechanism} onChange={(e) => setMechanism(e.target.value)} placeholder="e.g. Activin signaling inhibitor" />
                </div>
                <div className="ingest__field ingest__field--wide">
                  <label htmlFor="application">Application (optional)</label>
                  <input
                    id="application"
                    value={application}
                    onChange={(e) => setApplication(e.target.value)}
                    placeholder='e.g. "NDA 211675" — leave blank to resolve by brand name'
                  />
                </div>
              </div>
            </fieldset>

            <label className="ingest__checkbox">
              <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} disabled={submitting} />
              Ignore the on-disk cache and re-fetch everything
            </label>

            {formError && <p className="ingest__error">{formError}</p>}

            <button type="submit" className="ingest__submit" disabled={submitting}>
              {phase.kind === 'idle' || phase.kind === 'error' ? 'Run ingest' : 'Running…'}
            </button>
          </form>

          {phase.kind === 'error' && (
            <p className="ingest__error">
              {phase.message} <button type="button" className="ingest__retry" onClick={startOver}>Start over</button>
            </p>
          )}

          {(phase.kind === 'submitting' || phase.kind === 'locating-run') && (
            <div className="ingest__progress" role="status">
              <span className="ingest__spinner" aria-hidden="true" />
              {phase.kind === 'submitting' ? 'Starting the run…' : 'Finding the run…'}
            </div>
          )}

          {phase.kind === 'running' && (
            <div className="ingest__progress" role="status">
              <div className="ingest__progress-head">
                <span className="ingest__spinner" aria-hidden="true" />
                Pipeline running ({phase.run.status === 'queued' ? 'queued' : 'in progress'})…
              </div>
              {phase.steps.length > 0 && (
                <ul className="ingest__steps">
                  {phase.steps.map((s) => (
                    <li key={s.name}>
                      <span aria-hidden="true">{stepIcon(s)}</span> {s.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {phase.kind === 'run-failed' && (
            <div className="ingest__error">
              The pipeline run failed.{' '}
              <a href={phase.run.htmlUrl} target="_blank" rel="noopener noreferrer">
                View the log on GitHub ↗
              </a>{' '}
              for what went wrong.
              <div>
                <button type="button" className="ingest__retry" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}

          {phase.kind === 'resolving-outcome' && (
            <div className="ingest__progress" role="status">
              <span className="ingest__spinner" aria-hidden="true" />
              Run finished — checking for the result…
            </div>
          )}

          {phase.kind === 'no-changes' && (
            <div className="ingest__success" role="status">
              <strong>Done — no changes.</strong> The sources already agree with what's
              committed, so there's nothing to review.
              <div>
                <button type="button" className="ingest__retry" onClick={startOver}>Run another</button>
              </div>
            </div>
          )}

          {(phase.kind === 'pr-ready' || phase.kind === 'merging' || phase.kind === 'merged' || phase.kind === 'merge-failed') && (
            <div className="ingest__success" role="status">
              <strong>Pull request ready.</strong> "{phase.pr.title}" — {phase.pr.changedFiles}{' '}
              file{phase.pr.changedFiles === 1 ? '' : 's'} changed.
              <div>
                <a href={phase.pr.htmlUrl} target="_blank" rel="noopener noreferrer">
                  Review the diff on GitHub ↗
                </a>
              </div>
              {phase.kind === 'merged' ? (
                <p className="ingest__merged">Merged. The site will pick it up on its next deploy.</p>
              ) : (
                <div className="ingest__merge-row">
                  <button
                    type="button"
                    className="ingest__submit"
                    onClick={() => handleMerge(phase.pr)}
                    disabled={phase.kind === 'merging'}
                  >
                    {phase.kind === 'merging' ? 'Merging…' : 'Merge this pull request'}
                  </button>
                  {phase.kind === 'merge-failed' && <p className="ingest__error">{phase.message}</p>}
                </div>
              )}
              {(phase.kind === 'merged' || phase.kind === 'merge-failed') && (
                <button type="button" className="ingest__retry" onClick={startOver}>Run another</button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
