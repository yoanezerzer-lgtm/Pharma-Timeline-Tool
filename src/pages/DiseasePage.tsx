import { useState } from 'react';
import { BackLink } from '../components/BackLink/BackLink.js';
import type { DiseaseSummary } from '../lib/diseases.js';
import { diseaseIndex } from '../lib/catalog.js';
import { formatDate, toTime } from '../lib/dates.js';
import { shortIndication } from '../lib/drugs.js';
import { diseaseHref, diseasesHref, drugHref, indicationHref } from '../lib/router.js';
import '../components/IndicationTimeline/IndicationTimeline.css';
import './IndicationPage.css';
import './DrugPage.css';
import './DiseasePage.css';

const DAY = 86_400_000;

export function DiseasePage({ meshId }: { meshId: string }) {
  const disease = diseaseIndex.find((d) => d.meshId === meshId);
  if (!disease) {
    return (
      <main className="drug">
        <BackLink href={diseasesHref()} label="All diseases" />
        <p className="drug__missing">No approvals on record for this disease.</p>
      </main>
    );
  }
  const dated = disease.approvals.filter((a) => a.date);
  const times = dated.map((a) => toTime(a.date!));
  const min = Math.min(...times) - 180 * DAY;
  const max = Math.max(...times) + 180 * DAY;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; y <= new Date(max).getUTCFullYear(); y++) years.push(y);
  const step = Math.ceil(years.length / 8);
  const drugs = new Set(disease.approvals.map((a) => a.drugSlug)).size;

  return (
    <main className="drug">
      <BackLink href={diseasesHref()} label="All diseases" />
      <header className="disease__head">
        <h1>{disease.term}</h1>
        <p className="drug__mechanism">
          {disease.approvals.length} FDA {disease.approvals.length === 1 ? 'approval' : 'approvals'} across {drugs}{' '}
          {drugs === 1 ? 'drug' : 'drugs'}
          {disease.areas.length > 0 && <> · {disease.areas.join(', ')}</>}
        </p>
        {disease.summary && <PlainSummary summary={disease.summary} />}
        {disease.definition && (
          <blockquote className="disease__definition">
            <p>{disease.definition.text}</p>
            <footer>
              Medical definition from{' '}
              <a href={disease.definition.sourceUrl} target="_blank" rel="noopener noreferrer">
                MeSH, U.S. National Library of Medicine ↗
              </a>
            </footer>
          </blockquote>
        )}
      </header>

      <section className="ind-timeline" aria-label="Approvals over time">
        <div className="disease__timeline-head">
          <h2>Approvals over time</h2>
          <ExportButtons disease={disease} />
        </div>
        {dated.length > 0 && (
          <div className="ind-timeline__axis" aria-hidden="true">
            <div />
            <div className="ind-timeline__years">
              {years.map((y, i) =>
                i % step === 0 ? (
                  <span key={y} style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }}>
                    {y}
                  </span>
                ) : null
              )}
            </div>
            <div />
          </div>
        )}
        <ol className="ind-timeline__rows">
          {disease.approvals.map((a, k) => (
            <li key={`${a.drugSlug}-${a.indicationSlug}-${a.submission ?? k}`}>
              <a href={indicationHref(a.drugSlug, a.indicationSlug)} className="ind-timeline__row" title={a.statement ?? a.indication}>
                <span className="ind-timeline__name">
                  <strong>{a.brandName}</strong> <span className="disease__use">{shortIndication({ name: a.indication }, 40)}</span>
                </span>
                <span className="ind-timeline__track" aria-hidden="true">
                  {years.map((y) => (
                    <span key={y} className="ind-timeline__gridline" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }} />
                  ))}
                  {a.date && <span className="ind-timeline__dot" style={{ left: `${pct(toTime(a.date))}%` }} />}
                </span>
                <span className="ind-timeline__date">{a.date ? formatDate(a.date) : 'Date not determined'}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="uses" aria-labelledby="wording-head">
        <h2 id="wording-head">What each approval covers</h2>
        <p className="about__note">In the FDA's words: the label's indication, or the approval letter's sentence when a use was approved in steps.</p>
        <ul className="uses__list">
          {disease.approvals.map((a, k) => (
            <li key={`${a.drugSlug}-${a.indicationSlug}-${a.submission ?? k}`} className="disease__approval">
              <p className="uses__name">
                <a href={drugHref(a.drugSlug)}>
                  <strong>{a.brandName}</strong>
                </a>{' '}
                <span className="disease__inn">({a.inn})</span> · {a.date ? formatDate(a.date) : 'Date not determined'}
                {a.submission && <span className="disease__inn"> · {a.submission}</span>}
              </p>
              <p className="disease__wording">{a.statement ?? a.indication}</p>
              <a className="uses__meta" href={indicationHref(a.drugSlug, a.indicationSlug)}>
                Trials behind this approval →
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function DiseasesPage() {
  const byArea = new Map<string, typeof diseaseIndex>();
  for (const d of diseaseIndex) {
    for (const a of d.areas.length > 0 ? d.areas : ['Other']) byArea.set(a, [...(byArea.get(a) ?? []), d]);
  }
  const areas = [...byArea.keys()].sort((a, b) => Number(a === 'Other') - Number(b === 'Other') || a.localeCompare(b));
  return (
    <main className="drug">
      <BackLink href="#/" label="All drugs" />
      <header className="disease__head">
        <h1>Diseases</h1>
        <p className="drug__mechanism">
          {diseaseIndex.length} diseases with FDA approvals on this site, grouped by therapeutic area. The names and areas are
          the National Library of Medicine's (MeSH), and a disease can sit in more than one area.
        </p>
      </header>
      {areas.map((area) => (
        <section key={area} className="uses">
          <h2>
            {area} · {byArea.get(area)!.length}
          </h2>
          <ul className="uses__list">
            {byArea.get(area)!.map((d) => {
              const drugs = [...new Set(d.approvals.map((a) => a.brandName))];
              return (
                <li key={d.meshId}>
                  <a href={diseaseHref(d.meshId)} className="uses__item">
                    <span className="uses__name">{d.term}</span>
                    <span className="uses__meta">
                      {d.approvals.length} {d.approvals.length === 1 ? 'approval' : 'approvals'} · {drugs.join(', ')}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

/** MedlinePlus's summary, opening on its first two paragraphs. */
function PlainSummary({ summary }: { summary: NonNullable<DiseaseSummary['summary']> }) {
  const [open, setOpen] = useState(false);
  const opening = summary.paragraphs[0]?.endsWith('?') ? 3 : 2;
  const shown = open ? summary.paragraphs : summary.paragraphs.slice(0, opening);
  return (
    <section className="disease__plain" aria-label="In plain words">
      <h2>In plain words</h2>
      {shown.map((p, k) =>
        p.startsWith('• ') ? (
          <p key={k} className="disease__bullet">
            {p.slice(2)}
          </p>
        ) : p.endsWith('?') && p.length < 120 ? (
          <h3 key={k} className="disease__plain-q">
            {p}
          </h3>
        ) : (
          <p key={k}>{p}</p>
        )
      )}
      <p className="disease__plain-foot">
        {summary.paragraphs.length > opening && (
          <button type="button" className="disease__more" onClick={() => setOpen(!open)}>
            {open ? 'Show less' : 'Read the whole summary'}
          </button>
        )}
        From{' '}
        <a href={summary.sourceUrl} target="_blank" rel="noopener noreferrer">
          MedlinePlus: {summary.title} ↗
        </a>
        , U.S. National Library of Medicine
      </p>
    </section>
  );
}

/** Downloads of this page's approvals; the file is made in the browser. */
function ExportButtons({ disease }: { disease: DiseaseSummary }) {
  const [busy, setBusy] = useState<'xlsx' | 'pptx' | null>(null);
  const [failed, setFailed] = useState(false);
  const run = async (kind: 'xlsx' | 'pptx') => {
    setBusy(kind);
    setFailed(false);
    try {
      const m = await import('../lib/export.js');
      await (kind === 'xlsx' ? m.exportExcel(disease) : m.exportPowerPoint(disease));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="disease__export">
      <button type="button" onClick={() => run('xlsx')} disabled={busy !== null}>
        {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}
      </button>
      <button type="button" onClick={() => run('pptx')} disabled={busy !== null}>
        {busy === 'pptx' ? 'Preparing…' : 'Download PowerPoint'}
      </button>
      {failed && <span className="disease__export-error">Couldn’t make the file. Try again.</span>}
    </div>
  );
}
