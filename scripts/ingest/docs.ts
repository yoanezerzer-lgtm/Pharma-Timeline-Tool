import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { downloadFile, drugRawDir } from './http.js';

export interface FetchedDoc {
  url: string;
  type: string;
  submission: string;
  pdfPath: string;
  textPath: string;
  text: string;
}

/**
 * Extracts a PDF's text layer.
 *
 * pdfjs is bundled as a dev dependency and runs locally, so this costs nothing
 * and needs no network. Scanned approval packages (roughly pre-2002) have no
 * text layer and will come back empty — the caller reports that rather than
 * silently producing zero trials.
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    // Page markers let later stages report a page number alongside a match.
    pages.push(`\n<<<PAGE ${i}>>>\n${text}`);
  }
  await doc.destroy();
  return pages.join('\n');
}

/** Which approval-package documents are worth parsing for trial identifiers. */
export function isRelevantDoc(type: string): boolean {
  return /review|label|letter/i.test(type);
}

export async function runDocsStage(
  slug: string,
  documentUrls: { url: string; type: string; submission: string }[],
  refresh = false
): Promise<FetchedDoc[]> {
  const docsDir = join(drugRawDir(slug), 'docs');
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
