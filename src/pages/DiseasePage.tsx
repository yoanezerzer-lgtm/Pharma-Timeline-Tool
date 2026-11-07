import { Info } from '../components/Info/Info.js';
import { useState } from 'react';
import type { DiseaseSummary, UseStep } from '../lib/diseases.js';
import { diseaseIndex } from '../lib/catalog.js';
import { formatDate, toTime } from '../lib/dates.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { diseaseMeta, diseasesMeta } from '../lib/pageMeta.js';
import { diseaseHref, drugHref, indicationHref } from '../lib/router.js';
import '../components/IndicationTimeline/IndicationTimeline.css';
import { APPROVAL_KIND, DATE_UNCLEAR } from '../lib/copy.js';
import { NotFoundPage } from './NotFoundPage.js';
import './IndicationPage.css';
import './DrugPage.css';
import './DiseasePage.css';

const DAY = 86_400_000;

const STEP_LABEL: Record<UseStep['kind'], string> = APPROVAL_KIND;

export function DiseasePage({ meshId }: { meshId: string }) {
  const disease = diseaseIndex.find((d) => d.meshId === meshId);
  if (!disease) return <NotFoundPage message={`No disease “${meshId}” on this site.`} />;
  return <DiseaseView disease={disease} />;
}

function DiseaseView({ disease }: { disease: DiseaseSummary }) {
  usePageMeta(diseaseMeta(disease));
  const times = disease.uses.flatMap((u) => u.steps.filter((s) => s.date).map((s) => toTime(s.date!)));
  const min = Math.min(...times) - 180 * DAY;
  const max = Math.max(...times) + 180 * DAY;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; y <= new Date(max).getUTCFullYear(); y++) years.push(y);
  const step = Math.ceil(years.length / 8);
  const drugs = new Set(disease.uses.map((u) => u.drugSlug)).size;
  const uses = disease.uses.length;

  return (
    <main className="drug">
      <header className="disease__head">
        <h1>{disease.name}</h1>
        <p className="drug__mechanism">
          {uses} FDA-approved {uses === 1 ? 'use' : 'uses'} across {drugs} {drugs === 1 ? 'drug' : 'drugs'}
          {disease.areas.length > 0 && <> · {disease.areas.join(', ')}</>}
        </p>
        <AtAGlance disease={disease} />
      </header>

      <section className="ind-timeline" aria-label="Approvals over time">
        <div className="disease__timeline-head">
          <h2>
            Approvals over time
            <Info label="How to read this">
              One row per approved use. A filled dot is a new approval; an open dot is a change to an earlier one.
            </Info>
          </h2>
          <ExportButtons disease={disease} />
        </div>
        {times.length > 0 && (
          <div className="ind-timeline__axis" aria-hidden="true">
            <div />
            <div className="ind-timeline__years">
              {years.map((y, i) =>
                i % step === 0 ? (
                  <span key={y} style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }}>
                    {y}
                  </span>
                ) : null,
              )}
            </div>
            <div />
          </div>
        )}
        <ol className="ind-timeline__rows">
          {disease.uses.map((u) => {
            const firstDate = u.steps.find((s) => s.date)?.date;
            return (
              <li key={`${u.drugSlug}-${u.indicationSlug}`}>
                <a
                  href={`#use-${u.drugSlug}-${u.indicationSlug}`}
                  className="ind-timeline__row"
                  title={`${u.brandName}: ${u.indication}`}
                >
                  <span className="ind-timeline__name disease__row-name">
                    <strong>{u.brandName}</strong> <span className="disease__use">{u.indication}</span>
                  </span>
                  <span className="ind-timeline__track" aria-hidden="true">
                    {years.map((y) => (
                      <span key={y} className="ind-timeline__gridline" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }} />
                    ))}
                    {u.steps.map((s, k) =>
                      s.date ? (
                        <span
                          key={k}
                          className={`ind-timeline__dot${s.kind === 'new' ? '' : ' disease__dot--later'}`}
                          style={{ left: `${pct(toTime(s.date))}%` }}
                        />
                      ) : null,
                    )}
                  </span>
                  <span className="ind-timeline__date">
                    {firstDate ? formatDate(firstDate) : DATE_UNCLEAR}
                    {u.steps.length > 1 && <span className="disease__inn"> · {u.steps.length - 1} more</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Professionals come for the approvals; the plain-words summary follows them. */}
      {disease.summary ? <PlainSummary summary={disease.summary} /> : <Definition disease={disease} />}

      <section className="uses" aria-labelledby="wording-head">
        <h2 id="wording-head">
          What each approval covers
          <Info label="About this section">
            In the FDA’s own words, from the approval letter or the label. Each date links to the letter.
          </Info>
        </h2>
        <ul className="uses__list">
          {disease.uses.map((u) => (
            <li
              key={`${u.drugSlug}-${u.indicationSlug}`}
              id={`use-${u.drugSlug}-${u.indicationSlug}`}
              className="disease__approval"
            >
              <p className="uses__name">
                <a href={drugHref(u.drugSlug)}>
                  <strong>{u.brandName}</strong>
                </a>{' '}
                <span className="disease__inn">({u.inn})</span> · {u.indication}
              </p>
              <ol className="disease__steps">
                {u.steps.map((s, k) => (
                  <li key={k}>
                    <span className="disease__step-when">
                      {STEP_LABEL[s.kind]}{' '}
                      {s.sourceUrl ? (
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.submissions.join(', ')}
                        >
                          {s.date ? formatDate(s.date) : DATE_UNCLEAR.toLowerCase()}
                        </a>
                      ) : s.date ? (
                        formatDate(s.date)
                      ) : (
                        DATE_UNCLEAR.toLowerCase()
                      )}
                    </span>
                    {/* The label's wording is already the heading above; don't say it twice. */}
                    <span className="disease__wording">{s.text === u.indication ? '' : s.text}</span>
                  </li>
                ))}
              </ol>
              <a className="uses__meta" href={indicationHref(u.drugSlug, u.indicationSlug)}>
                Trials supporting this approval →
              </a>
            </li>
          ))}
        </ul>
      </section>

      {disease.summary && disease.definition && (
        <details className="disease__details">
          <summary>Medical definition</summary>
          <Definition disease={disease} />
        </details>
      )}
    </main>
  );
}

export function DiseasesPage() {
  usePageMeta(diseasesMeta());
  const byArea = new Map<string, typeof diseaseIndex>();
  for (const d of diseaseIndex) {
    for (const a of d.areas.length > 0 ? d.areas : ['Other']) byArea.set(a, [...(byArea.get(a) ?? []), d]);
  }
  const areas = [...byArea.keys()].sort((a, b) => Number(a === 'Other') - Number(b === 'Other') || a.localeCompare(b));
  return (
    <main className="drug">
      <header className="disease__head">
        <h1>Diseases</h1>
        <p className="drug__mechanism">
          {diseaseIndex.length} diseases with FDA approvals on this site, by therapeutic area.
          <Info label="About this list">
            Names and areas come from MeSH, the U.S. National Library of Medicine’s medical vocabulary. A disease can
            sit in more than one area.
          </Info>
        </p>
      </header>
      <div className="disease__areas">
        {areas.map((area) => (
          <section key={area} className="uses">
            <h2>
              {area} · {byArea.get(area)!.length}
            </h2>
            <ul className="uses__list">
              {byArea.get(area)!.map((d) => {
                const drugs = [...new Set(d.uses.map((u) => u.brandName))];
                return (
                  <li key={d.meshId}>
                    <a href={diseaseHref(d.meshId)} className="uses__item">
                      <span className="uses__name">{d.name}</span>
                      <span className="uses__meta">
                        {d.uses.length} approved {d.uses.length === 1 ? 'use' : 'uses'} · {drugs.join(', ')}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

/** MedlinePlus's summary, word for word, opening on its first paragraph (after a lead question, if any). */
function PlainSummary({ summary }: { summary: NonNullable<DiseaseSummary['summary']> }) {
  const [open, setOpen] = useState(false);
  const opening = summary.paragraphs[0]?.endsWith('?') ? 2 : 1;
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
        ),
      )}
      <p className="disease__plain-foot">
        {summary.paragraphs.length > opening && (
          <button type="button" className="disease__more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
        From{' '}
        <a href={summary.sourceUrl} target="_blank" rel="noopener noreferrer">
          {summary.sourceLabel.split(', ')[0]}: {summary.title} ↗
        </a>
        , {summary.sourceLabel.split(', ').slice(1).join(', ')}
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

/** The first and the latest approval, so a reader sees the history at a glance. */
function AtAGlance({ disease }: { disease: DiseaseSummary }) {
  const steps = disease.uses
    .flatMap((u) =>
      u.steps.filter((s) => s.date && s.kind === 'new').map((s) => ({ brand: u.brandName, date: s.date! })),
    )
    .sort((a, b) => a.date.value.localeCompare(b.date.value));
  if (steps.length === 0) return null;
  const first = steps[0];
  const last = steps[steps.length - 1];
  return (
    <p className="disease__glance">
      First FDA approval on this site: <strong>{formatDate(first.date)}</strong> ({first.brand})
      {steps.length > 1 && last !== first && (
        <>
          {' '}
          · most recent: <strong>{formatDate(last.date)}</strong> ({last.brand})
        </>
      )}
    </p>
  );
}

/** MeSH's definition, in medical language. */
function Definition({ disease }: { disease: DiseaseSummary }) {
  if (!disease.definition) return null;
  return (
    <blockquote className="disease__definition">
      <p>{disease.definition.text}</p>
      <footer>
        Medical definition of “{disease.term}” from{' '}
        <a href={disease.definition.sourceUrl} target="_blank" rel="noopener noreferrer">
          MeSH, U.S. National Library of Medicine ↗
        </a>
      </footer>
    </blockquote>
  );
}
