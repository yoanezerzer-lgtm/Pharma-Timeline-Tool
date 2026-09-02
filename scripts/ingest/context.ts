import { join } from 'node:path';

/** Default location for cached API responses and downloaded documents. */
export const DEFAULT_RAW_DIR = join(process.cwd(), 'data', 'raw');

/**
 * Everything a stage needs to know about *where* it is working.
 *
 * `rawDir` is injectable so tests can point the pipeline at a scratch
 * directory and run it end to end against a pre-seeded cache, with no network.
 */
export interface IngestContext {
  slug: string;
  rawDir: string;
  refresh: boolean;
}

export function makeContext(
  slug: string,
  opts: { rawDir?: string; refresh?: boolean } = {}
): IngestContext {
  return {
    slug,
    rawDir: opts.rawDir ?? DEFAULT_RAW_DIR,
    refresh: opts.refresh ?? false,
  };
}
