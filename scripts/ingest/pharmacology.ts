import type { NamedFact, Pharmacology } from '../../src/schema/index.js';
import { pageForOffset } from './docs.js';

/**
 * "About this drug": the label's own clinical pharmacology sections (12.1
 * Mechanism of Action, 12.2 Pharmacodynamics, 12.3 Pharmacokinetics), word
 * for word, and the FDA's Established Pharmacologic Class.
 */

interface Doc {
  url: string;
  submission: string;
  text: string;
}

const SECTIONS = [
  { number: '12.1', title: 'Mechanism of Action' },
  { number: '12.2', title: 'Pharmacodynamics' },
  { number: '12.3', title: 'Pharmacokinetics' },
] as const;

/** Longest section kept; the rest is on the label, which the page links to. */
const MAX_SECTION = 20000;

/** "ORIG-1" before "SUPPL-3" before "SUPPL-40". */
function submissionOrder(submission: string): number {
  const m = submission.match(/SUPPL-(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** Page breaks and the FDA's "Reference ID" footers fall mid-sentence in the text layer; they are not the label's words. */
function clean(text: string): string {
  return text
    .replace(/<<<PAGE \d+>>>/g, ' ')
    .replace(/Reference ID:\s*\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One section's text, from its heading in the full prescribing information
 * to the next 12.x or 13 heading. The table of contents lists the same
 * headings back to back, so a candidate that runs straight into the next
 * heading is the contents entry, not the section.
 */
function section(text: string, number: string, title: string): { text: string; offset: number } | undefined {
  // PDF text layers sometimes split a word ("Pharmaco kinetics", Awiqli's label).
  const spaced = title
    .split(' ')
    .map((w) => [...w].join('\\s?'))
    .join('\\s+');
  const heading = new RegExp(`\\b${number.replace('.', '\\.')}\\s+${spaced}\\b`, 'gi');
  const next = /\b(?:12\.[1-6]\s+(?:Mechanism|Pharmacodynamics|Pharmacokinetics|Microbiology|Pharmacogenomics|Immunogenicity)|13\s+NONCLINICAL)\b/g;
  let best: { text: string; offset: number } | undefined;
  for (const m of text.matchAll(heading)) {
    const start = m.index + m[0].length;
    next.lastIndex = start;
    const end = next.exec(text);
    const body = clean(text.slice(start, end ? end.index : start + MAX_SECTION * 2));
    if (body.length < 40) continue;
    if (!best || body.length > best.text.length) best = { text: body, offset: m.index };
  }
  return best;
}

export function pharmacologySections(label: Doc): Pharmacology['sections'] {
  const out: Pharmacology['sections'] = [];
  for (const { number, title } of SECTIONS) {
    const found = section(label.text, number, title);
    if (!found) continue;
    const truncated = found.text.length > MAX_SECTION;
    out.push({
      number,
      title,
      text: truncated ? found.text.slice(0, MAX_SECTION).replace(/\s+\S*$/, '') : found.text,
      ...(truncated ? { truncated: true } : {}),
      provenance: {
        sourceUrl: label.url,
        sourceLabel: `Label (${label.submission}), section ${number}`,
        page: pageForOffset(label.text, found.offset),
        extractedBy: 'regex',
        verified: false,
      },
    });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The class as the label's Highlights state it, which FDA rules require to
 * be the Established Pharmacologic Class: "MYQORZO is a cardiac myosin
 * inhibitor indicated for…" gives "cardiac myosin inhibitor".
 */
export function labelDrugClass(label: Doc, brandName: string): NamedFact | undefined {
  const text = clean(label.text);
  const end = text.search(/FULL PRESCRIBING INFORMATION:\s*CONTENTS/i);
  const highlights = text.slice(0, end > 0 ? end : 15000);
  const brand = escape(brandName.split(/\s+/)[0]);
  const m = new RegExp(`\\b${brand}[®™]?(?:\\s*\\([^)]{1,80}\\))?\\s+is a(?:\\s?n)?\\s+([^.;]{3,150}?)\\s+indicated\\b`, 'i').exec(highlights);
  if (!m) return undefined;
  return {
    name: m[1].trim(),
    provenance: {
      sourceUrl: label.url,
      sourceLabel: `Label (${label.submission}), Highlights`,
      quote: m[0],
      extractedBy: 'regex',
      verified: false,
    },
  };
}

/**
 * The newest label's sections, and the class: openFDA's Established
 * Pharmacologic Class when it lists one (it adds them weeks after approval),
 * else the label's own statement of it.
 */
export function pharmacology(
  labels: Doc[],
  brandName: string,
  epc: string | undefined,
  epcSourceUrl: string
): Pharmacology | undefined {
  const [label] = [...labels].sort((a, b) => submissionOrder(b.submission) - submissionOrder(a.submission));
  if (!label) return undefined;
  const drugClass: NamedFact | undefined = epc
    ? {
        name: epc.replace(/\s*\[EPC\]$/, ''),
        provenance: { sourceUrl: epcSourceUrl, sourceLabel: 'openFDA: Established Pharmacologic Class', extractedBy: 'api', verified: false },
      }
    : labelDrugClass(label, brandName);
  const sections = pharmacologySections(label);
  const plain = patientSummary(label, brandName);
  if (!drugClass && sections.length === 0 && !plain) return undefined;
  return { ...(drugClass ? { drugClass } : {}), ...(plain ? { patientSummary: plain } : {}), sections };
}

/** Where the leaflet's answer to "What is …?" stops: the warnings and instructions that follow it. */
const ANSWER_END =
  /\b(?:What (?:is|are|should|does) |It is not known|Before (?:taking|using|receiving|you (?:take|use|receive|start|begin))|Do not (?:take|use|receive)|Who should not|What should I tell|How (?:should|will) I|What is the most important information|What are the possible side effects|Read this (?:Medication Guide|Patient Information)|This Medication Guide|This Patient Information)\b/i;

/** List markers as PDF text layers set them: bullets, and symbol-font characters in the private-use range. */
const BULLETS = '•●▪‣⁃\\uf000-\\uf8ff';

/** Longest answer kept; the leaflet's opening is the plain description. */
const MAX_ANSWER = 900;

/**
 * Whitespace the PDF text layer adds inside the label's own words ("non -
 * small cell", "( COVID-19)", "type 2 , ") is closed up. Letters and
 * punctuation are untouched.
 */
export function closeUp(text: string): string {
  return text
    .replace(/(\w) - (?=\w)/g, '$1-')
    .replace(/\( +/g, '(')
    .replace(/ +\)/g, ')')
    .replace(/ +([,.;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The patient leaflet's own answer to "What is BRAND?" (the Medication Guide
 * or Patient Information printed at the end of the label): the FDA-approved
 * plain-language description of what the medicine is for. Word for word; a
 * list in it is kept as separate lines.
 */
export function patientSummary(label: Doc, brandName: string): Pharmacology['patientSummary'] | undefined {
  const text = clean(label.text);
  // The brand may come out letter-split ("L exapro", "AMB EL VIST").
  const word = brandName.split(/\s+/)[0];
  const brand = [...word].map((c) => escape(c)).join('\\s?');
  const question = new RegExp(`What is\\s+${brand}(?:\\s+[A-Z][A-Za-z]+)?[®™]?(?:\\s*\\([^)]{1,60}\\))?\\s*\\?`, 'gi');
  for (const m of text.matchAll(question)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start, start + MAX_ANSWER * 3);
    // The answer opens on the brand ("BAXFENDY is a prescription medicine…"), perhaps after a bullet.
    if (!new RegExp(`^[\\s${BULLETS}o-]*${brand}`, 'i').test(rest)) continue;
    const end = rest.search(ANSWER_END);
    let body = rest.slice(0, end > 0 ? end : MAX_ANSWER);
    if (body.length > MAX_ANSWER) body = body.slice(0, MAX_ANSWER).replace(/[^.]*$/, '');
    const paragraphs = body
      .split(new RegExp(`\\s*[${BULLETS}]\\s*|\\s+o\\s+(?=[a-z(])`))
      .map(closeUp)
      .filter((p) => p.length > 1);
    if (paragraphs.length === 0 || paragraphs.join(' ').length < 40) continue;
    return {
      paragraphs,
      provenance: {
        sourceUrl: label.url,
        sourceLabel: `Label (${label.submission}), patient information: "What is ${word}?"`,
        page: pageForOffset(label.text, Math.max(0, label.text.search(new RegExp(question.source, 'i')))),
        extractedBy: 'regex',
        verified: false,
      },
    };
  }
  return undefined;
}
