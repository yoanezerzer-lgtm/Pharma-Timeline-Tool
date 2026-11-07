import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { downloadFile, drugRawDir } from './http.js';
import type { IngestContext } from './context.js';

export interface FetchedDoc {
  url: string;
  type: string;
  submission: string;
  pdfPath: string;
  textPath: string;
  text: string;
}

/** The parts of a pdfjs text item the join needs. */
export interface TextPiece {
  str: string;
  /** [a, b, c, d, x, y]: x and y are where the piece starts on the page. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/**
 * A gap narrower than this share of the font size is kerning inside a word,
 * not a space between words. Word spaces in label PDFs are about a quarter
 * of the font size.
 */
const WORD_GAP = 0.12;

/**
 * Joins a page's text pieces the way they sit on the page. PDFs often print
 * one word as several pieces (a font or kerning change mid-word), so joining
 * every piece with a space split words: "JA Ks", "fun ction" on Rinvoq's
 * label. A space goes in only where the page shows one: a visible gap, a new
 * line, or a space character in the text itself.
 */
export function joinTextItems(items: TextPiece[]): string {
  let out = '';
  let prev: TextPiece | undefined;
  for (const item of items) {
    if (prev && !/\s$/.test(out) && !/^\s/.test(item.str)) {
      const size = Math.abs(item.transform[3]) || item.height || 1;
      const sameLine = Math.abs(item.transform[5] - prev.transform[5]) < size * 0.5;
      const gap = item.transform[4] - (prev.transform[4] + prev.width);
      // Only upright text: on rotated print (carton artwork) x and y don't run along the line.
      const upright = (t: number[]) => t[1] === 0 && t[2] === 0 && t[0] > 0;
      const touching =
        !prev.hasEOL &&
        upright(item.transform) &&
        upright(prev.transform) &&
        sameLine &&
        gap < size * WORD_GAP &&
        gap > -size * 0.25;
      if (!touching) out += ' ';
    }
    out += item.str;
    if (item.str !== '' || item.hasEOL) prev = item;
  }
  return out.replace(/\s+/g, ' ');
}

/**
 * Extracts a PDF's text layer.
 *
 * pdfjs is bundled as a dev dependency and runs locally, so this costs nothing
 * and needs no network. Scanned approval packages (roughly pre-2002) have no
 * text layer and will come back empty — the caller reports that rather than
 * silently producing zero trials.
 */
async function extractPdfText(pdfPath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = joinTextItems(content.items.flatMap((item) => ('str' in item ? [item] : [])));
    // Page markers let later stages report a page number alongside a match.
    pages.push(`\n<<<PAGE ${i}>>>\n${text}`);
  }
  await doc.destroy();
  return pages.join('\n');
}

/** Which approval-package documents are worth parsing for trial identifiers. */
function isRelevantDoc(type: string): boolean {
  return /review|label|letter/i.test(type);
}

export async function runDocsStage(
  ctx: IngestContext,
  documentUrls: { url: string; type: string; submission: string }[]
): Promise<FetchedDoc[]> {
  const { refresh } = ctx;
  const docsDir = join(drugRawDir(ctx.slug, ctx.rawDir), 'docs');
  mkdirSync(docsDir, { recursive: true });

  const relevant = documentUrls.filter((d) => isRelevantDoc(d.type));
  const out: FetchedDoc[] = [];

  for (const doc of relevant) {
    const name = basename(new URL(doc.url).pathname);
    const pdfPath = join(docsDir, name);
    const textPath = `${pdfPath}.txt`;

    try {
      await downloadFile(doc.url, pdfPath, refresh);
    } catch (err) {
      console.warn(`  ! could not download ${name}: ${(err as Error).message}`);
      continue;
    }

    let text: string;
    if (!refresh && existsSync(textPath)) {
      text = readFileSync(textPath, 'utf8');
    } else {
      try {
        text = await extractPdfText(pdfPath);
        writeFileSync(textPath, text);
      } catch (err) {
        console.warn(`  ! could not parse ${name}: ${(err as Error).message}`);
        continue;
      }
    }

    if (text.replace(/<<<PAGE \d+>>>/g, '').trim().length < 200) {
      console.warn(
        `  ! ${name} has almost no text layer — likely a scanned document. ` +
          `Trial identifiers cannot be read from it without OCR.`
      );
    }

    out.push({ ...doc, pdfPath, textPath, text });
  }

  return out;
}

/** Finds the 1-indexed PDF page a match sits on, using the page markers. */
export function pageForOffset(text: string, offset: number): number | undefined {
  const before = text.slice(0, offset);
  const matches = before.match(/<<<PAGE (\d+)>>>/g);
  if (!matches || matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const n = /<<<PAGE (\d+)>>>/.exec(last);
  return n ? Number(n[1]) : undefined;
}

/** Strips page markers for display or quoting. */
export function stripPageMarkers(text: string): string {
  return text.replace(/\n?<<<PAGE \d+>>>\n?/g, ' ');
}
