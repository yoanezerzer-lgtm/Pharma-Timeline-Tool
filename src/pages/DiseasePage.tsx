import { useState } from 'react';
import { BackLink } from '../components/BackLink/BackLink.js';
import type { DiseaseSummary, UseStep } from '../lib/diseases.js';
import { diseaseIndex } from '../lib/catalog.js';
import { formatDate, toTime } from '../lib/dates.js';
import { diseaseHref, diseasesHref, drugHref, indicationHref } from '../lib/router.js';
import '../components/IndicationTimeline/IndicationTimeline.css';
import './IndicationPage.css';
import './DrugPage.css';
import './DiseasePage.css';

const DAY = 86_400_000;

const STEP_LABEL: Record<UseStep['kind'], string> = {
  new: 'Approved',
  expansion: 'Widened',
  revision: 'Wording changed',
  conversion: 'Converted to full approval',
};

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
      <BackLink href={diseasesHref()} label="All diseases" />
      <header className="disease__head">
        <h1>{disease.name}</h1>
        <p className="drug__mechanism">
          {uses} FDA-approved {uses === 1 ? 'use' : 'uses'} across {drugs} {drugs === 1 ? 'drug' : 'drugs'}
          {disease.areas.length > 0 && <> · {disease.areas.join(', ')}</>}
        </p>
        {disease.summary && <PlainSummary summary={disease.summary} />}
        {disease.definition && (
          <blockquote className="disease__definition">
            <p>{disease.definition.text}</p>
            <footer>
              Medical definition of “{disease.term}” from{' '}
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
        <p className="about__note">One row per approved use. A filled dot is a new approval; an open dot is a change to an earlier one.</p>
        {times.length > 0 && (
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
          {disease.uses.map((u) => {
            const firstDate = u.steps.find((s) => s.date)?.date;
            return (
              <li key={`${u.drugSlug}-${u.indicationSlug}`}>
                <a href={`#use-${u.drugSlug}-${u.indicationSlug}`} className="ind-timeline__row" title={`${u.brandName}: ${u.indication}`}>
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
                      ) : null
                    )}
                  </span>
                  <span className="ind-timeline__date">
                    {firstDate ? formatDate(firstDate) : 'Date not determined'}
                    {u.steps.length > 1 && <span className="disease__inn"> · {u.steps.length - 1} more</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="uses" aria-labelledby="wording-head">
        <h2 id="wording-head">What each approval covers</h2>
        <p className="about__note">
          In the FDA’s words, from the approval letter (its opening formalities left out) or the label. Each date links to the
          letter.
        </p>
        <ul className="uses__list">
          {disease.uses.map((u) => (
            <li key={`${u.drugSlug}-${u.indicationSlug}`} id={`use-${u.drugSlug}-${u.indicationSlug}`} className="disease__approval">
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
                        <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" title={s.submissions.join(', ')}>
                          {s.date ? formatDate(s.date) : 'date not determined'}
                        </a>
                      ) : s.date ? (
                        formatDate(s.date)
                      ) : (
                        'date not determined'
                      )}
                    </span>
                    {/* The label's wording is already the heading above; don't say it twice. */}
                    <span className="disease__wording">{s.text === u.indication ? '' : s.text}</span>
                  </li>
                ))}
              </ol>
              <a className="uses__meta" href={indicationHref(u.drugSlug, u.indicationSlug)}>
                Trials behind this use →
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
          {diseaseIndex.length} diseases with FDA approvals on this site, grouped by therapeutic area. The names and areas come
          from the National Library of Medicine’s medical vocabulary (MeSH), and a disease can sit in more than one area.
        </p>
      </header>
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
