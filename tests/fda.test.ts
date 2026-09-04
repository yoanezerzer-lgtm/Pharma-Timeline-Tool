import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePathFor } from '../scripts/ingest/http.js';
import { drugsFdaUrl, drugsFdaUrlByBrand, runFdaStage } from '../scripts/ingest/fda.js';
import { makeContext } from '../scripts/ingest/context.js';

function seedOpenFda(rawDir: string, slug: string, url: string, body: unknown): void {
  const path = cachePathFor(slug, 'openfda', url, rawDir);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ ok: true, body }));
}

/**
 * Regression coverage for adding a second drug (Mimrylo/rusfertide): its
 * exact NDA number wasn't known up front — too recently approved to have
 * looked it up by hand — so the registry entry omits applicationNumber and
 * applicationType, and the pipeline has to resolve them from openFDA's own
 * brand-name search instead of requiring them to be supplied.
 */
describe('runFdaStage — brand-name lookup', () => {
  it('resolves the real application number and type from a brand-name search', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-brand-'));
    const ctx = makeContext('rusfertide', { rawDir });

    const lookupUrl = drugsFdaUrlByBrand('Mimrylo');
    seedOpenFda(rawDir, 'rusfertide', lookupUrl, {
      results: [
        {
          application_number: 'NDA218330',
          sponsor_name: 'TAKEDA PHARMACEUTICALS USA INC',
          submissions: [
            {
              submission_type: 'ORIG',
              submission_number: '1',
              submission_status: 'AP',
              submission_status_date: '20260828',
              submission_class_code_description: 'Type 1 - New Molecular Entity',
              application_docs: [],
            },
          ],
        },
      ],
    });

    const result = await runFdaStage(ctx, undefined, undefined, 'Mimrylo');

    expect(result.applicationNumber).toBe('218330');
    expect(result.applicationType).toBe('NDA');
    // Everything downstream (milestone provenance, the committed record's
    // regulatory.us fields) has to use the *resolved* application, not the
    // brand-search URL, or a later re-run keyed by number would miss the cache.
    expect(result.queryUrl).toBe(drugsFdaUrl('NDA', '218330'));
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].type).toBe('FDA_APPROVAL');
  });

  it('reports a clear error when the brand name matches nothing', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-brand-missing-'));
    const ctx = makeContext('nonexistent-drug', { rawDir });
    seedOpenFda(rawDir, 'nonexistent-drug', drugsFdaUrlByBrand('Totally Fictional Drug'), {
      results: [],
    });

    await expect(runFdaStage(ctx, undefined, undefined, 'Totally Fictional Drug')).rejects.toThrow(
      /no application for brand name/
    );
  });

  it('still supports the exact application number, unchanged', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'fda-exact-'));
    const ctx = makeContext('upadacitinib', { rawDir });
    seedOpenFda(rawDir, 'upadacitinib', drugsFdaUrl('NDA', '211675'), {
      results: [
        {
          application_number: 'NDA211675',
          sponsor_name: 'ABBVIE INC',
          submissions: [
            {
              submission_type: 'ORIG',
              submission_number: '1',
              submission_status: 'AP',
              submission_status_date: '20190816',
              submission_class_code_description: 'Type 1 - New Molecular Entity',
              application_docs: [],
            },
          ],
        },
      ],
    });

    const result = await runFdaStage(ctx, '211675', 'NDA', 'Rinvoq');
    expect(result.applicationNumber).toBe('211675');
    expect(result.applicationType).toBe('NDA');
  });
});
