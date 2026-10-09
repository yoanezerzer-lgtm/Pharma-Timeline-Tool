import { useEffect, useState, type FormEvent } from 'react';
import {
  dispatchIngestWorkflow,
  findLatestRun,
  GitHubApiError,
  NEW_TOKEN_URL,
  WORKFLOW_RUNS_URL,
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

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'dispatched' }
  | { kind: 'found-run'; url: string }
  | { kind: 'error'; message: string };

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
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (status.kind !== 'dispatched') return;
    const dispatchedAt = new Date();
    let cancelled = false;
    findLatestRun(token, dispatchedAt)
      .then((run) => {
        if (cancelled) return;
        setStatus(run ? { kind: 'found-run', url: run.htmlUrl } : { kind: 'dispatched' });
      })
      .catch(() => {
        // Couldn't locate the specific run — the generic link already shown is enough.
      });
    return () => {
      cancelled = true;
    };
  }, [status.kind, token]);

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

    setStatus({ kind: 'submitting' });
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
      setStatus({ kind: 'dispatched' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof GitHubApiError ? err.message : 'Could not reach GitHub. Check your connection and try again.',
      });
    }
  }

  const submitting = status.kind === 'submitting' || status.kind === 'dispatched' || status.kind === 'found-run';

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
          Kicks off the real ingest pipeline — openFDA Drugs@FDA, ClinicalTrials.gov, and the
          FDA's own approval documents. Nothing here is written or inferred by a language
          model; this just starts the same deterministic process from your browser instead of
          GitHub's Actions tab. It opens a pull request for you to review and merge — nothing
          is published automatically.
        </p>
      </header>

      {!token || editingToken ? (
        <section className="ingest__token-setup">
          <h2>Connect a GitHub token</h2>
          <p>
            Triggering this from the website means your browser calls GitHub's API directly —
            there's no server in between. You'll need a personal access token scoped to just
            this repository:
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
            <li>Under "Permissions" → "Repository permissions," set <strong>Actions</strong> to <strong>Read and write</strong>.</li>
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
              {submitting ? 'Starting…' : 'Run ingest'}
            </button>
          </form>

          {status.kind === 'error' && <p className="ingest__error">{status.message}</p>}

          {(status.kind === 'dispatched' || status.kind === 'found-run') && (
            <div className="ingest__success" role="status">
              <strong>Started.</strong> It takes a minute or two to fetch and parse the real
              documents. When it finishes, it opens a pull request with the result for you to
              review and merge.
              <div>
                {status.kind === 'found-run' ? (
                  <a href={status.url} target="_blank" rel="noopener noreferrer">
                    Watch this run on GitHub ↗
                  </a>
                ) : (
                  <a href={WORKFLOW_RUNS_URL} target="_blank" rel="noopener noreferrer">
                    View recent runs on GitHub ↗
                  </a>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
