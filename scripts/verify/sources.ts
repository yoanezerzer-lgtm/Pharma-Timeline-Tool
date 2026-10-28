import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Drug, Trial } from '../../src/schema/index.js';
import { extractIndicationList, extractLabelSection14, splitSection14ByIndication } from '../ingest/roles.js';

/**
 * The FDA documents a drug's record cites, as the text the pipeline itself
 * extracted from them (data/raw/<slug>/docs/<pdf name>.txt — pushed to a
 * diag/raw-text-* branch by the ingest workflow). Verification reads the same
 * text the pipeline read, so a quote either is in it or isn't.
 */
export type SourceKind = 'label' | 'letter' | 'review';

export interface SourceDoc {
  url: string;
  kind: SourceKind;
  text: string;
}

function kindOf(url: string): SourceKind {
  const name = basename(new URL(url).pathname).toLowerCase();
  if (/lbl\.pdf$/.test(name)) return 'label';
  if (/ltr\.pdf$/.test(name)) return 'letter';
  return 'review';
}

/** Every FDA document URL the record mentions, in sources or in any provenance. */
function citedUrls(drug: Drug): Set<string> {
  const urls = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if ((k === 'sourceUrl' || k === 'url') && typeof v === 'string' && /accessdata\.fda\.gov/.test(v)) urls.add(v);
        else walk(v);
      }
    }
  };
  walk(drug);
  return urls;
}

export function loadSources(drug: Drug, docsDir: string): SourceDoc[] {
  const out: SourceDoc[] = [];
  for (const url of citedUrls(drug)) {
    const path = join(docsDir, `${basename(new URL(url).pathname)}.txt`);
    if (existsSync(path)) out.push({ url, kind: kindOf(url), text: readFileSync(path, 'utf8') });
  }
  return out;
}

/**
 * PDF text drifts in ways that don't change meaning: line breaks, curly
 * quotes, ligature hyphens. A quote is compared after both sides get the same
 * treatment; nothing else is forgiven.
 */
export function normalize(s: string): string {
  return s
    .replace(/<<<PAGE \d+>>>/g, ' ')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/­/g, '')
    // Extractors often space out hyphens: "RA - IV", "DAS28 - CRP".
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The 1-indexed page a character offset falls on, from the extractor's page markers. */
function pageAt(text: string, offset: number): number | undefined {
  let page: number | undefined;
  for (const m of text.slice(0, offset).matchAll(/<<<PAGE (\d+)>>>/g)) page = Number(m[1]);
  return page;
}

/** What a trial can be called in FDA documents. */
function identifiersOf(t: Trial): string[] {
  return [t.nctId, t.acronym, t.labelName, t.protocolNumber].filter((x): x is string => !!x && x.length >= 3);
}

const sameName = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase();

/** This label's section 14 text for one indication, or undefined if the label has no such span. */
function labelSpanFor(doc: SourceDoc, indication: string): string | undefined {
  if (doc.kind !== 'label') return undefined;
  const section = extractLabelSection14(doc.text);
  if (!section) return undefined;
  const list = extractIndicationList(doc.text);
  const spans = splitSection14ByIndication(section, list);
  return spans.find((s) => sameName(s.indication, indication))?.text;
}

export interface Passage {
  sourceUrl: string;
  kind: SourceKind;
  page?: number;
  /** Whether it sits inside the label's section 14 span for the claim's indication. */
  inIndicationSpan: boolean;
  text: string;
}

const WINDOW = 400;

/**
 * Every place the trial is named in the drug's FDA documents, with the text
 * around it. Found by code, so the agent reads what is actually there instead
 * of searching on its own.
 */
export function findPassages(trial: Trial, indication: string, sources: SourceDoc[]): Passage[] {
  const ids = identifiersOf(trial);
  const found: Passage[] = [];
  for (const doc of sources) {
    const span = labelSpanFor(doc, indication);
    const spanNorm = span ? normalize(span) : undefined;
    for (const id of ids) {
      for (const m of doc.text.matchAll(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))) {
        const start = Math.max(0, m.index - WINDOW);
        const text = normalize(doc.text.slice(start, m.index + id.length + WINDOW));
        // Successive label versions repeat the same paragraph; keep one copy.
        if (found.some((p) => p.text === text)) continue;
        // The name and what follows it; text before can belong to the previous heading.
        const core = normalize(doc.text.slice(m.index, m.index + id.length + 60));
        found.push({
          sourceUrl: doc.url,
          kind: doc.kind,
          page: pageAt(doc.text, m.index),
          inIndicationSpan: !!spanNorm && spanNorm.includes(core),
          text,
        });
      }
    }
  }
  // A few of each kind, so the agent sees the label's own section and the
  // FDA's review or letters, not eight near-copies of one paragraph.
  const take = (f: (p: Passage) => boolean, n: number) => found.filter(f).slice(0, n);
  return [
    ...take((p) => p.inIndicationSpan, 3),
    ...take((p) => p.kind !== 'label', 3),
    ...take((p) => p.kind === 'label' && !p.inIndicationSpan, 2),
  ];
}

type QuoteCheck =
  | { ok: true; kind: SourceKind; inIndicationSpan: boolean }
  | { ok: false; reason: string };

const MIN_QUOTE_LENGTH = 40;

/**
 * The code half of every confirmation: the quote must be in the cited
 * document word for word, long enough to mean something, and name the trial.
 */
export function checkQuote(quote: string, sourceUrl: string, trial: Trial, indication: string, sources: SourceDoc[]): QuoteCheck {
  const doc = sources.find((d) => d.url === sourceUrl);
  if (!doc) return { ok: false, reason: `not one of the drug's loaded source documents: ${sourceUrl}` };
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_LENGTH) return { ok: false, reason: `quote shorter than ${MIN_QUOTE_LENGTH} characters` };
  const full = normalize(doc.text);
  if (!full.includes(q)) return { ok: false, reason: 'quote does not appear word for word in the document' };
  if (!identifiersOf(trial).some((id) => q.includes(normalize(id)))) return { ok: false, reason: 'quote does not name the trial' };
  const span = labelSpanFor(doc, indication);
  return { ok: true, kind: doc.kind, inIndicationSpan: !!span && normalize(span).includes(q) };
}
