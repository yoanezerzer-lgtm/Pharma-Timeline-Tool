import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Drug } from '../src/schema/index.js';

const DRUGS_DIR = join(process.cwd(), 'data', 'drugs');
const files = readdirSync(DRUGS_DIR).filter((f) => f.endsWith('.json'));

describe('committed drug records', () => {
  it('has at least one record', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s parses against the schema', (file) => {
    // This is the gate that stops malformed ingested data reaching the site.
    const raw = JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8'));
    const result = Drug.safeParse(raw);
    if (!result.success) {
      throw new Error(
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
    expect(result.success).toBe(true);
  });

  it.each(files)('%s has a filename matching its slug', (file) => {
    const raw = JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8'));
    expect(`${raw.slug}.json`).toBe(file);
  });

  it.each(files)('%s has unique trial ids', (file) => {
    const drug = Drug.parse(JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8')));
    const ids = drug.trials.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(files)('%s has trial dates in a sane order', (file) => {
    const drug = Drug.parse(JSON.parse(readFileSync(join(DRUGS_DIR, file), 'utf8')));
    for (const t of drug.trials) {
      if (t.startDate && t.completionDate) {
        expect(t.startDate.value <= t.completionDate.value).toBe(true);
      }
      if (t.primaryCompletionDate && t.completionDate) {
        expect(t.primaryCompletionDate.value <= t.completionDate.value).toBe(true);
      }
    }
  });
});
