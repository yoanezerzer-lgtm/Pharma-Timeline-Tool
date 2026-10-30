import type { DiseaseApproval, DiseaseSummary } from './diseases.js';
import { formatDate } from './dates.js';
import { shortIndication } from './drugs.js';

/**
 * A disease's approvals as an Excel workbook or a PowerPoint deck, made in
 * the reader's browser. Both libraries load only when someone exports, so
 * they add nothing to an ordinary page load.
 */

const SITE = 'https://yoanezerzer-lgtm.github.io/Pharma-Timeline-Tool/';
const pageUrl = (a: DiseaseApproval) => `${SITE}#/drug/${a.drugSlug}/indication/${a.indicationSlug}`;
const fileName = (d: DiseaseSummary, ext: string) => `${d.term.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-FDA-approvals.${ext}`;
const today = () => new Date().toISOString().slice(0, 10);

const SOURCES = [
  'Approvals and their wording: FDA approval letters and labels (Drugs@FDA, via openFDA).',
  'Disease names, definitions and therapeutic areas: MeSH, U.S. National Library of Medicine.',
  'Plain-language summaries: MedlinePlus, U.S. National Library of Medicine.',
];

export async function exportExcel(d: DiseaseSummary): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const approvals = [
    ['Approved', 'Drug', 'Generic name', 'Submission', 'What the FDA approved (FDA wording)', 'Page on this site'].map(bold),
    ...d.approvals.map((a) => [
      a.date ? { value: new Date(`${a.date.value}T00:00:00Z`), type: Date, format: 'yyyy-mm-dd' } : { value: 'Date not determined' },
      { value: a.brandName },
      { value: a.inn },
      { value: a.submission ?? '' },
      { value: a.statement ?? a.indication, wrap: true },
      { value: pageUrl(a) },
    ]),
  ];
  const about = [
    [bold(d.term)],
    [{ value: d.definition?.text ?? '', wrap: true }],
    [{ value: d.areas.length > 0 ? `Therapeutic areas (MeSH): ${d.areas.join(', ')}` : '' }],
    [{ value: '' }],
    [bold('Sources')],
    ...SOURCES.map((s) => [{ value: s }]),
    [{ value: `Exported ${today()} from ${SITE}` }],
  ];
  await writeExcelFile([
    { data: approvals, sheet: 'Approvals', columns: [{ width: 13 }, { width: 18 }, { width: 22 }, { width: 12 }, { width: 80 }, { width: 50 }] },
    { data: about, sheet: 'About', columns: [{ width: 120 }] },
  ]).toFile(fileName(d, 'xlsx'));
}

const DAY = 86_400_000;
const ROWS_PER_SLIDE = 12;
const TABLE_ROWS = 6;

export async function exportPowerPoint(d: DiseaseSummary): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  const ink = '1F2933';
  const muted = '6B7280';
  const accent = '2B4C7E';
  const font = 'Arial';

  const title = pptx.addSlide();
  title.addText(d.term, { x: 0.6, y: 1.8, w: 12, h: 1, fontSize: 36, bold: true, color: ink, fontFace: font });
  title.addText(`${d.approvals.length} FDA approvals across ${new Set(d.approvals.map((a) => a.drugSlug)).size} drugs`, {
    x: 0.6, y: 2.8, w: 12, h: 0.5, fontSize: 18, color: muted, fontFace: font,
  });
  if (d.definition) {
    title.addText([{ text: d.definition.text }, { text: '\nDefinition: MeSH, U.S. National Library of Medicine', options: { fontSize: 11, color: muted } }], {
      x: 0.6, y: 3.6, w: 12, h: 2.6, fontSize: 14, color: ink, fontFace: font, valign: 'top', paraSpaceAfter: 6,
    });
  }

  // The timeline: one row per approval, a dot on a shared time axis, as on the site.
  const dated = d.approvals.filter((a) => a.date);
  const times = dated.map((a) => Date.parse(a.date!.value));
  const min = Math.min(...times) - 180 * DAY;
  const max = Math.max(...times) + 180 * DAY;
  const [x0, x1] = [4.4, 12.6];
  const xOf = (t: number) => x0 + ((t - min) / (max - min)) * (x1 - x0);
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; y <= new Date(max).getUTCFullYear(); y++) years.push(y);
  const step = Math.ceil(years.length / 10);
  for (let start = 0; start < d.approvals.length; start += ROWS_PER_SLIDE) {
    const rows = d.approvals.slice(start, start + ROWS_PER_SLIDE);
    const s = pptx.addSlide();
    s.addText('Approvals over time', { x: 0.6, y: 0.3, w: 12, h: 0.6, fontSize: 24, bold: true, color: ink, fontFace: font });
    const top = 1.4;
    const rowH = 0.46;
    years.forEach((y, k) => {
      const x = xOf(Date.UTC(y, 0, 1));
      s.addShape(pptx.ShapeType.line, { x, y: top - 0.1, w: 0, h: rows.length * rowH + 0.1, line: { color: 'E5E7EB', width: 0.75 } });
      if (k % step === 0) s.addText(String(y), { x: x - 0.4, y: top - 0.45, w: 0.8, h: 0.3, fontSize: 10, align: 'center', color: muted, fontFace: font });
    });
    rows.forEach((a, k) => {
      const y = top + k * rowH;
      s.addText(
        [{ text: `${a.brandName}  `, options: { bold: true, color: ink } }, { text: shortIndication({ name: a.indication }, 34), options: { color: muted } }],
        { x: 0.4, y, w: 3.9, h: rowH, fontSize: 11, fontFace: font, valign: 'middle' }
      );
      s.addShape(pptx.ShapeType.line, { x: x0, y: y + rowH / 2, w: x1 - x0, h: 0, line: { color: 'D1D5DB', width: 0.75 } });
      if (a.date) {
        s.addShape(pptx.ShapeType.ellipse, { x: xOf(Date.parse(a.date.value)) - 0.07, y: y + rowH / 2 - 0.07, w: 0.14, h: 0.14, fill: { color: accent }, line: { color: accent } });
      }
    });
    s.addText(`FDA approval dates. ${SOURCES[0]}`, { x: 0.6, y: 6.9, w: 12, h: 0.3, fontSize: 9, color: muted, fontFace: font });
  }

  // Every approval in the FDA's words, a few to a slide so no row is split.
  const head = ['Approved', 'Drug', 'What the FDA approved (FDA wording)'].map((text) => ({ text, options: { bold: true, fill: { color: 'F3F4F6' } } }));
  for (let start = 0; start < d.approvals.length; start += TABLE_ROWS) {
    const table = pptx.addSlide();
    table.addText('What each approval covers', { x: 0.6, y: 0.3, w: 12, h: 0.6, fontSize: 24, bold: true, color: ink, fontFace: font });
    const rows = d.approvals
      .slice(start, start + TABLE_ROWS)
      .map((a) => [{ text: a.date ? formatDate(a.date) : 'Not determined' }, { text: `${a.brandName} (${a.inn})` }, { text: a.statement ?? a.indication }]);
    table.addTable([head, ...rows], {
      x: 0.6, y: 1.1, w: 12.1, colW: [1.6, 2.6, 7.9], fontSize: 10, fontFace: font, color: ink, valign: 'top',
      border: { type: 'solid', color: 'E5E7EB', pt: 0.75 },
    });
  }

  const end = pptx.addSlide();
  end.addText('Sources', { x: 0.6, y: 0.3, w: 12, h: 0.6, fontSize: 24, bold: true, color: ink, fontFace: font });
  end.addText([...SOURCES, `Exported ${today()} from ${SITE}`].map((text) => ({ text, options: { bullet: true } })), {
    x: 0.6, y: 1.1, w: 12, h: 3, fontSize: 14, color: ink, fontFace: font, valign: 'top',
  });
  await pptx.writeFile({ fileName: fileName(d, 'pptx') });
}
