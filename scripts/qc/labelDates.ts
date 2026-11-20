import type { Drug } from '../../src/schema/index.js';
import { keyWords } from '../ingest/indicationDates.js';
import { stripPageMarkers } from '../ingest/docs.js';
import { legacyIndicationsText, sectionOneWindows } from '../ingest/roles.js';
import type { Finding } from './checks.js';

/**
 * A use dated to an approval whose own label doesn't list it: Rybrevant
 * Faspro's head and neck use was dated to the December 2025 original
 * approval, whose label lists only lung cancer uses.
 *
 * Needs the label text the ingest saved (`diag/raw-text-<slug>`, unpacked to
 * data/raw/<slug>/docs). `read` returns a document's text by its URL, or
 * undefined when it isn't there; then the check says nothing.
 */
export function checkLabelDates(drug: Drug, read: (url: string) => string | undefined): Finding[] {
  const out: Finding[] = [];
  for (const ind of drug.indications) {
    if (!ind.approvalDate || !ind.submissionNumber) continue;
    const labels = drug.sources.filter((s) => s.type === 'fda_label' && s.label === `Label (${ind.submissionNumber})`);
    const verdicts = labels.flatMap((s) => {
      const text = read(s.url);
      return text === undefined ? [] : [{ url: s.url, lists: labelHasUse(ind.name, text, (ind.diseases ?? []).map((d) => d.term)) }];
    });
    // Silent unless every readable label of that approval says no.
    if (verdicts.length === 0 || verdicts.some((v) => v.lists !== false)) continue;
    out.push({
      severity: 'error',
      code: 'dated-to-label-without-use',
      path: `indications[${ind.slug}].approvalDate`,
      message: `"${ind.name}" is dated ${ind.approvalDate.value} (${ind.submissionNumber}), but that approval's label doesn't list it in section 1: ${verdicts[0].url}`,
    });
  }
  return out;
}

/**
 * Whether a label lists this use in section 1, matching on the use's key
 * words so a renamed heading still counts ("1.5 Urothelial Carcinoma" for
 * "Urothelial Cancer"). Undefined only when the label has no readable
 * section 1 at all.
 */
// Where a heading's name ends and the label's prose begins: the brand in
// capitals followed by "is", "in combination", "as" ("KEYTRUDA is
// indicated…"), as the pipeline cuts it. A capitals word inside a name is an
// abbreviation ("Previously Treated NSCLC with…") and stays.
const PROSE = /\s+[A-Z]{4,}(?:\s+[A-Z]{4,})*®?,?\s+(?:is|are|was|in combination|as|for|,).*$|\s+\d+\.\s?\d.*$/;

const NOTE = /^(?:important\s+)?limitations?\s+of\s+use|^usage\b/i;

const AGE_WORDS = new Set(['month', 'months', 'week', 'weeks', 'day', 'days', 'old']);

export function labelHasUse(name: string, text: string, diseases: string[] = []): boolean | undefined {
  // Ages move as a use widens ("2 years" became "3 months" for Eucrisa).
  const target = new Set([...keyWords(name)].filter((w) => !AGE_WORDS.has(w)));
  if (target.size === 0) return undefined;
  const stripped = stripPageMarkers(text);
  const covers = (h: string) => {
    const words = keyWords(h);
    return [...target].every((w) => words.has(w));
  };
  // A heading names the use, then the label's prose runs on ("Head and Neck
  // Cancer KEYTRUDA is indicated…"). The use may since have been renamed more
  // precisely ("Head and Neck Squamous Cell Cancer"): a shorter heading
  // counts when its words belong to the use's name and section 1's own text
  // carries the rest ("…head and neck squamous cell carcinoma…"). A heading
  // "Melanoma" doesn't cover "Adjuvant Melanoma" unless the label says adjuvant.
  const headingCovers = (h: string, windows: string[]) => {
    if (covers(h)) return true;
    const own = keyWords(h.replace(PROSE, ''));
    return own.size > 0 && [...own].every((w) => target.has(w)) && windows.some(covers);
  };
  // A use written as one sentence is reworded over the years (Elidel's 2001
  // label versus today's); its disease is what must be there.
  const sentenceCovers = (w: string) =>
    covers(w) || (diseases.length > 0 && diseases.some((d) => [...keyWords(d)].every((x) => keyWords(w).has(x))));
  // A label with several uses gives each a "1.N" heading: the use must have
  // one of its own. Read here rather than with the pipeline's list reader,
  // which cuts some older Keytruda labels short.
  // Section 1 as the contents and the section itself print it; table rows
  // elsewhere ("1.3 Cough 5") look like headings too.
  const windows = sectionOneWindows(stripped);
  const found = windows.flatMap((w) => [...w.matchAll(/\b1\.\s?(\d{1,2})\s+([A-Z][^.]{0,100})/g)]).filter((m) => !NOTE.test(m[2]));
  if (found.some((m) => headingCovers(m[2], windows))) return true;
  if (new Set(found.map((m) => m[1])).size >= 2) return false;
  // One use: no heading of its own, just the sentence in section 1.
  if (windows.length > 0) return windows.some(sentenceCovers);
  // Written before 2006: an unnumbered "INDICATIONS AND USAGE" section.
  const legacy = legacyIndicationsText(text);
  return legacy ? sentenceCovers(legacy) : undefined;
}

/** Where the ingest saved a document's text: data/raw/<slug>/docs/<file name>.txt. */
export function rawTextPath(rawDir: string, slug: string, url: string): string {
  return `${rawDir}/${slug}/docs/${url.split('/').pop()}.txt`;
}
