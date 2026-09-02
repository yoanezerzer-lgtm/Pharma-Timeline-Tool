import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { cachePathFor, drugRawDir } from '../../scripts/ingest/http.js';
import { drugsFdaUrl } from '../../scripts/ingest/fda.js';
import { lookupByIdUrl, searchByInterventionUrl, type CtgovStudy } from '../../scripts/ingest/ctgov.js';
import { extractCandidates } from '../../scripts/ingest/codes.js';
import { STUDIES_BY_IDENTIFIER, ALL_REGISTERED } from '../fixtures/studies.js';

/**
 * Pre-populates the pipeline's on-disk cache so it can run end to end with no
 * network access.
 *
 * Every URL is built with the same helpers the production code uses, so the
 * cache keys cannot drift out of sync with what the pipeline actually requests.
 */

function writeCacheEntry(
  slug: string,
  rawDir: string,
  kind: string,
  url: string,
  body: unknown
): void {
  const path = cachePathFor(slug, kind, url, rawDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ok: true, body }, null, 2));
}

export interface SeedOptions {
  slug: string;
  rawDir: string;
  applicationType: 'NDA' | 'BLA' | 'ANDA';
  applicationNumber: string;
  intervention: string;
  /** Documents to place on disk, as { url, text }. */
  documents: { url: string; text: string }[];
  openFdaResponse: unknown;
  /** Registry records returned by the intervention search. */
  registered?: CtgovStudy[];
}

export function seedCache(opts: SeedOptions): void {
  const { slug, rawDir } = opts;

  // 1. openFDA application response.
  writeCacheEntry(
    slug,
    rawDir,
    'openfda',
    drugsFdaUrl(opts.applicationType, opts.applicationNumber),
    opts.openFdaResponse
  );

  // 2. Documents. runDocsStage skips both the download and the PDF parse when
  //    the .pdf and its .txt sidecar already exist, so a placeholder PDF plus
  //    real fixture text is enough to exercise the whole stage offline.
  const docsDir = join(drugRawDir(slug, rawDir), 'docs');
  mkdirSync(docsDir, { recursive: true });
  const allText: string[] = [];
  for (const doc of opts.documents) {
    const name = basename(new URL(doc.url).pathname);
    writeFileSync(join(docsDir, name), '%PDF-1.4 placeholder\n');
    writeFileSync(join(docsDir, `${name}.txt`), doc.text);
    allText.push(doc.text);
  }

  // 3. An identifier lookup for EVERY candidate the extractor will produce —
  //    real studies for the ones that exist, an empty result for the rest.
  //    Without this, an unrecognised token would fall through to the network
  //    and the test would stop being hermetic.
  for (const cand of extractCandidates(allText.join('\n'))) {
    const study = STUDIES_BY_IDENTIFIER[cand.token];
    writeCacheEntry(slug, rawDir, 'ctgov-id', lookupByIdUrl(cand.token), {
      studies: study ? [study] : [],
      totalCount: study ? 1 : 0,
    });
  }

  // 4. The intervention search.
  writeCacheEntry(slug, rawDir, 'ctgov-search', searchByInterventionUrl(opts.intervention), {
    studies: opts.registered ?? ALL_REGISTERED,
    totalCount: (opts.registered ?? ALL_REGISTERED).length,
  });
}

export function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8');
}

/** A Drugs@FDA response shaped like the real one for NDA 211675. */
export const OPENFDA_211675 = {
  results: [
    {
      application_number: 'NDA211675',
      sponsor_name: 'ABBVIE INC',
      openfda: { brand_name: ['RINVOQ'], generic_name: ['UPADACITINIB'] },
      submissions: [
        {
          submission_type: 'ORIG',
          submission_number: '1',
          submission_status: 'AP',
          submission_status_date: '20190816',
          submission_class_code_description: 'Type 1 - New Molecular Entity',
          application_docs: [
            {
              id: '1',
              type: 'Review',
              url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211675Orig1s000MedR.pdf',
            },
            {
              id: '2',
              type: 'Label',
              url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211675Orig1s000lbl.pdf',
            },
          ],
        },
        {
          submission_type: 'SUPPL',
          submission_number: '4',
          submission_status: 'AP',
          submission_status_date: '20211214',
          submission_class_code_description: 'Efficacy-New Indication',
        },
        {
          // Tentative approval — must NOT become a milestone.
          submission_type: 'SUPPL',
          submission_number: '9',
          submission_status: 'TA',
          submission_status_date: '20230101',
          submission_class_code_description: 'Efficacy-Pending',
        },
      ],
    },
  ],
};
