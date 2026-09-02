import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_RAW_DIR, type IngestContext } from './context.js';

export { DEFAULT_RAW_DIR };

/** An HTTP failure that will not change if the request is repeated. */
export class NonRetryableHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableHttpError';
  }
}

export function drugRawDir(slug: string, rawDir: string = DEFAULT_RAW_DIR): string {
  return join(rawDir, slug);
}

/**
 * Where a given request's response is cached.
 *
 * Exported so test helpers can seed the cache using the real hashing rule
 * rather than a duplicate of it — a copy would drift and the seeding would
 * silently stop matching.
 */
export function cachePathFor(
  slug: string,
  kind: string,
  key: string,
  rawDir: string = DEFAULT_RAW_DIR
): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return join(drugRawDir(slug, rawDir), kind, `${hash}.json`);
}

export interface FetchOptions {
  ctx: IngestContext;
  /** Cache subdirectory, e.g. "ctgov". */
  kind: string;
}

/** Simple sequential throttle. Both APIs are public and rate-limited by IP. */
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 120;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * Fetches JSON, caching the response on disk under data/raw/<slug>/<kind>/.
 *
 * Caching is what makes the pipeline re-runnable offline and keeps repeat runs
 * from hammering public APIs — the resolver in codes.ts issues one request per
 * candidate token, so most runs are mostly cache hits.
 *
 * A 404 is cached as a null result: "this identifier does not resolve" is a
 * real answer the resolver depends on, not a failure worth retrying.
 */
export async function fetchJson<T>(
  url: string,
  opts: FetchOptions,
  retries = 3
): Promise<T | null> {
  const path = cachePathFor(opts.ctx.slug, opts.kind, url, opts.ctx.rawDir);

  if (!opts.ctx.refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { ok: boolean; body: T | null };
    return cached.ok ? cached.body : null;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'pharma-timeline-tool' },
      });

      if (res.status === 404) {
        writeCache(path, { ok: false, body: null });
        return null;
      }

      // Back off and retry on throttling or a transient server error.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Other 4xx responses are the server's final answer — retrying a 403 or a
      // malformed query just burns time and hides the real problem.
      if (!res.ok) {
        throw new NonRetryableHttpError(
          `HTTP ${res.status} ${res.statusText} for ${url}`
        );
      }

      const body = (await res.json()) as T;
      writeCache(path, { ok: true, body });
      return body;
    } catch (err) {
      if (err instanceof NonRetryableHttpError) throw err;
      lastError = err;
      if (attempt < retries) {
        const backoff = 2 ** attempt * 500;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempts: ${lastError}`);
}

function writeCache(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

/** Downloads a binary file (a PDF) to disk, skipping the request if cached. */
export async function downloadFile(
  url: string,
  destPath: string,
  refresh = false
): Promise<string> {
  if (!refresh && existsSync(destPath)) return destPath;
  await throttle();
  const res = await fetch(url, { headers: { 'user-agent': 'pharma-timeline-tool' } });
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buf);
  return destPath;
}
