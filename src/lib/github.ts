/**
 * A thin client for running the "Ingest drug data" GitHub Actions workflow
 * and following it through to a mergeable pull request — entirely from the
 * browser, since this is a static site with no backend. GitHub's REST API
 * supports CORS for token-authenticated requests, so a scoped personal
 * access token the user creates and pastes in (stored only in their own
 * browser) is enough to drive the whole thing from here: dispatch the run,
 * watch it, find the pull request it opens, and merge it.
 */

const OWNER = 'yoanezerzer-lgtm';
const REPO = 'Pharma-Timeline-Tool';
const WORKFLOW_ID = 'ingest.yml';
const BRANCH = 'main';

export const WORKFLOW_RUNS_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}`;
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface IngestInputs {
  drug: string;
  brandName?: string;
  inn?: string;
  sponsor?: string;
  modality?: string;
  mechanism?: string;
  application?: string;
  refresh?: boolean;
}

export interface WorkflowRun {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

export interface RunStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PullRequestSummary {
  number: number;
  htmlUrl: string;
  title: string;
  changedFiles: number;
  mergeable: boolean | null;
}

async function githubRequest(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new GitHubApiError(await describeError(res), res.status);
  return res;
}

async function describeError(res: Response): Promise<string> {
  if (res.status === 401) return 'GitHub rejected the token — it may be invalid, expired, or revoked.';
  if (res.status === 403) {
    return 'GitHub accepted the token but it doesn’t have the permissions this step needs — check Actions, Contents, and Pull requests are all set to "Read and write" on the token.';
  }
  if (res.status === 404) {
    return 'Not found — check the token is scoped to yoanezerzer-lgtm/Pharma-Timeline-Tool.';
  }
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `GitHub returned HTTP ${res.status}.`;
  } catch {
    return `GitHub returned HTTP ${res.status}.`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kicks off the ingest workflow. Resolves once GitHub has accepted the run — it does not wait for it to finish. */
export async function dispatchIngestWorkflow(token: string, inputs: IngestInputs): Promise<void> {
  await githubRequest(token, `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: BRANCH,
      inputs: {
        drug: inputs.drug,
        brand_name: inputs.brandName ?? '',
        inn: inputs.inn ?? '',
        sponsor: inputs.sponsor ?? '',
        modality: inputs.modality ?? '',
        mechanism: inputs.mechanism ?? '',
        application: inputs.application ?? '',
        refresh: inputs.refresh ?? false,
      },
    }),
  });
}

function toRun(r: Record<string, unknown>): WorkflowRun {
  return {
    id: r.id as number,
    htmlUrl: r.html_url as string,
    status: r.status as string,
    conclusion: (r.conclusion as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/**
 * Dispatching a workflow doesn't hand back the run it created — the only way
 * to find it is to look at the most recent runs afterward. Polled a few
 * times because the new run can take a couple of seconds to appear.
 */
export async function findLatestRun(token: string, dispatchedAfter: Date): Promise<WorkflowRun | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? 1500 : 2000);
    const res = await githubRequest(
      token,
      `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=5`
    );
    const body = (await res.json()) as { workflow_runs: Array<Record<string, unknown>> };
    const run = body.workflow_runs.find((r) => new Date(r.created_at as string) >= dispatchedAfter);
    if (run) return toRun(run);
  }
  return null;
}

export async function getRun(token: string, runId: number): Promise<WorkflowRun> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/actions/runs/${runId}`);
  return toRun((await res.json()) as Record<string, unknown>);
}

/** The step-by-step detail shown while a run is in progress. */
export async function getRunSteps(token: string, runId: number): Promise<RunStep[]> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`);
  const body = (await res.json()) as { jobs: Array<{ steps?: Array<Record<string, unknown>> }> };
  const steps = body.jobs[0]?.steps ?? [];
  return steps.map((s) => ({
    name: s.name as string,
    status: s.status as string,
    conclusion: (s.conclusion as string | null) ?? null,
  }));
}

function toPr(p: Record<string, unknown>): PullRequestSummary {
  return {
    number: p.number as number,
    htmlUrl: p.html_url as string,
    title: p.title as string,
    changedFiles: (p.changed_files as number | undefined) ?? 0,
    mergeable: (p.mergeable as boolean | null | undefined) ?? null,
  };
}

/**
 * The workflow names its branch `ingest/<slug>-<timestamp>`. Finding it (and
 * the pull request on it) this way means this page never has to guess an
 * exact branch name — only the predictable prefix.
 */
async function findIngestBranch(token: string, slug: string): Promise<string | null> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/branches?per_page=100`);
  const branches = (await res.json()) as Array<{ name: string }>;
  const prefix = `ingest/${slug}-`;
  const matches = branches.filter((b) => b.name.startsWith(prefix)).sort((a, b) => (a.name < b.name ? 1 : -1));
  return matches[0]?.name ?? null;
}

async function findOpenPrForBranch(token: string, branch: string): Promise<PullRequestSummary | null> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/pulls?head=${OWNER}:${branch}&state=open`);
  const prs = (await res.json()) as Array<Record<string, unknown>>;
  if (prs.length === 0) return null;
  // The list endpoint doesn't include changed_files/mergeable — fetch the single PR for those.
  return getPullRequest(token, prs[0].number as number);
}

export async function getPullRequest(token: string, pullNumber: number): Promise<PullRequestSummary> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/pulls/${pullNumber}`);
  return toPr((await res.json()) as Record<string, unknown>);
}

/**
 * Opens the pull request directly, for the case where the Actions workflow's
 * own bot token pushed the branch but couldn't open the PR itself — that
 * needs the repository setting "Allow GitHub Actions to create and approve
 * pull requests", which is off by default. A personal token isn't subject
 * to that restriction, so this page can finish the job itself.
 */
async function createPrForBranch(token: string, branch: string, drug: string): Promise<PullRequestSummary> {
  const res = await githubRequest(token, `/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Ingest: ${drug}`,
      head: branch,
      base: BRANCH,
      body:
        `Automated ingestion run for \`${drug}\`.\n\n` +
        'Data comes from openFDA Drugs@FDA, the FDA approval package PDFs, and ' +
        'ClinicalTrials.gov. Nothing here was produced by a language model.\n\n' +
        'Review the diff before merging. Every field is marked `verified: false` ' +
        'until a person checks it, and trial roles are assigned by rule, not inference.',
    }),
  });
  return toPr((await res.json()) as Record<string, unknown>);
}

export type IngestOutcome =
  | { kind: 'no-changes' }
  | { kind: 'pr-ready'; pr: PullRequestSummary };

/**
 * Called once a run has completed successfully: finds the branch it pushed
 * (if any — no branch means the sources already agreed with what's
 * committed) and the pull request on it, opening one itself if the
 * workflow's own token couldn't.
 */
export async function resolveIngestOutcome(token: string, slug: string): Promise<IngestOutcome> {
  const branch = await findIngestBranch(token, slug);
  if (!branch) return { kind: 'no-changes' };

  const existingPr = await findOpenPrForBranch(token, branch);
  if (existingPr) return { kind: 'pr-ready', pr: existingPr };

  const pr = await createPrForBranch(token, branch, slug);
  return { kind: 'pr-ready', pr };
}

export async function mergePullRequest(token: string, pullNumber: number): Promise<void> {
  await githubRequest(token, `/repos/${OWNER}/${REPO}/pulls/${pullNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'merge' }),
  });
}
