/**
 * A thin client for triggering the "Ingest drug data" GitHub Actions
 * workflow directly from the browser — no backend, since this is a static
 * site. GitHub's REST API supports CORS for token-authenticated requests,
 * so a scoped personal access token the user creates and pastes in (stored
 * only in their own browser) is enough to call it straight from here.
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
  htmlUrl: string;
  status: string;
  createdAt: string;
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
    return 'GitHub accepted the token but it doesn’t have permission to run this workflow — it needs "Actions: Read and write" access on this repository.';
  }
  if (res.status === 404) {
    return 'Workflow or repository not found — check the token is scoped to yoanezerzer-lgtm/Pharma-Timeline-Tool.';
  }
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `GitHub returned HTTP ${res.status}.`;
  } catch {
    return `GitHub returned HTTP ${res.status}.`;
  }
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

/**
 * Dispatching a workflow doesn't hand back the run it created — the only way
 * to find it is to look at the most recent runs afterward. Polled a few
 * times because the new run can take a couple of seconds to appear.
 */
export async function findLatestRun(token: string, dispatchedAfter: Date): Promise<WorkflowRun | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 2000));
    const res = await githubRequest(
      token,
      `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=5`
    );
    const body = (await res.json()) as { workflow_runs: Array<Record<string, unknown>> };
    const run = body.workflow_runs.find((r) => new Date(r.created_at as string) >= dispatchedAfter);
    if (run) {
      return {
        htmlUrl: run.html_url as string,
        status: run.status as string,
        createdAt: run.created_at as string,
      };
    }
  }
  return null;
}
