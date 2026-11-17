import { useEffect, useRef, useState } from 'react';
import { Info } from '../components/Info/Info.js';
import { diseaseIndex, drugIndex, useDrug, useNews } from '../lib/catalog.js';
import { formatDate } from '../lib/dates.js';
import { trialsForIndication } from '../lib/drugs.js';
import { naturalTerm } from '../lib/plainText.js';
import { DATE_UNCLEAR } from '../lib/copy.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { drugMeta } from '../lib/pageMeta.js';
import { NotFoundPage } from './NotFoundPage.js';
import { diseaseHref, indicationHref } from '../lib/router.js';
import { withoutPageFooters } from '../lib/plainText.js';
import type { Drug, Provenance } from '../schema/index.js';
import './IndicationPage.css';
import './DrugPage.css';

/** Each disease's everyday name as its disease page shows it ("Breast Cancer"). */
const diseaseName = new Map(diseaseIndex.map((d) => [d.meshId, d.name]));

export function DrugPage({ slug }: { slug: string }) {
  const state = useDrug(slug);
  if (state.status === 'missing') return <NotFoundPage message={`No drug called “${slug}” on this site.`} />;
  if (state.status === 'ready') return <DrugView drug={state.drug} />;
  return (
    <main className="drug">
      <p className="drug__missing">
        {state.status === 'loading' && 'Loading…'}
        {state.status === 'error' && 'Couldn’t load this page. Check your connection and reload.'}
      </p>
    </main>
  );
}

/** Where a passage came from, as a link to the FDA document and page. */
function SourceLink({ provenance, label }: { provenance: Provenance; label: string }) {
  if (!provenance.sourceUrl) return null;
  const href = provenance.page ? `${provenance.sourceUrl}#page=${provenance.page}` : provenance.sourceUrl;
  return (
    <a className="pharm__source" href={href} target="_blank" rel="noopener noreferrer" title={provenance.quote}>
      {label}
      {provenance.page ? `, page ${provenance.page}` : ''} ↗
    </a>
  );
}

/** Links to the company's own announcements and free news coverage, newest first. Never their text. */
function NewsSection({ slug }: { slug: string }) {
  const links = useNews(slug);
  // No section at all rather than an empty one.
  if (!links || links.length === 0) return null;
  return (
    <section className="news" aria-labelledby="news-head">
      <h2 id="news-head">
        Company news
        <Info label="About this section">
          Links to press releases on the company’s own site and on newswires, and to Fierce Pharma and Fierce Biotech
          stories. Only free pages, newest first. Each link opens the original page; nothing is copied here.
        </Info>
      </h2>
      <ul className="news__list">
          {links.map((l) => (
            <li key={l.url} className="news__item">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="news__title">
                {l.title} ↗
              </a>
              <span className="news__meta">
                {formatDate({ value: l.date, precision: 'day' })} · {l.source}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Lines of the leaflet's answer shown before "Show all". */
const SUMMARY_LINES = 2;

/**
 * The patient leaflet's own description of the medicine, word for word, as
 * the page's opening lines, with a light link to the label it comes from.
 */
function PatientSummary({ summary }: { summary: NonNullable<NonNullable<Drug['pharmacology']>['patientSummary']> }) {
  const [open, setOpen] = useState(false);
  const all = summary.paragraphs;
  const shown = open ? all : all.slice(0, SUMMARY_LINES);
  const href = summary.provenance.page ? `${summary.provenance.sourceUrl}#page=${summary.provenance.page}` : summary.provenance.sourceUrl;
  return (
    <section className="drug__plain" aria-label="Description from the label">
      {shown.map((p, k) => (
        <p key={k} className={k > 0 && /^[a-z(]/.test(p) ? 'drug__plain-item' : undefined}>
          {p}
          {k === shown.length - 1 && href && (
            <>
              {' '}
              <a className="drug__plain-source" href={href} target="_blank" rel="noopener noreferrer" title="Patient information in the FDA-approved label">
                (source ↗)
              </a>
            </>
          )}
        </p>
      ))}
      {all.length > SUMMARY_LINES && (
        <button type="button" className="disease__more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show all ${all.length - 1} uses`}
        </button>
      )}
    </section>
  );
}

/** A date as a year with a fraction ("2017-03-28" → 2017.24), for placing it on the strip. */
function yearPosition(value: string): number {
  const [y, m = 1, d = 1] = value.split('-').map(Number);
  return y + ((m - 1) * 30.4 + (d - 1)) / 365;
}

type DatedUse = { n: number; slug: string; name: string; date: NonNullable<Drug['indications'][number]['approvalDate']> };

/**
 * Every approved use as a numbered dot on one line of years, so the label's
 * growth reads at a glance. Dots too close to share a line stack upward.
 */
function UsesTimeline({ slug, uses, undated }: { slug: string; uses: DatedUse[]; undated: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (uses.length < 2) return null;
  const first = Math.floor(yearPosition(uses[0].date.value));
  const last = Math.max(new Date().getFullYear(), Math.floor(yearPosition(uses[uses.length - 1].date.value))) + 1;
  const span = last - first;
  const at = (v: string) => ((yearPosition(v) - first) / span) * 100;
  // Stack dots that would overlap: each takes the lowest line whose last dot is far enough left.
  // The gap is one dot's width (about 26px) as a share of the strip, so it holds at any screen width.
  const MIN_GAP = (28 / Math.max(width, 1)) * 100;
  const lineEnds: number[] = [];
  const placed = uses.map((u) => {
    const x = at(u.date.value);
    let line = lineEnds.findIndex((end) => x - end >= MIN_GAP);
    if (line === -1) line = lineEnds.length;
    lineEnds[line] = x;
    return { ...u, x, line };
  });
  const step = span > 24 ? 5 : span > 12 ? 2 : 1;
  const years: number[] = [];
  for (let y = first; y <= last; y += step) years.push(y);

  return (
    <figure className="dp__timeline" aria-label="Approved uses over time">
      <figcaption>
        Approved uses over time
        {undated > 0 && (
          <span className="dp__timeline-note">
            {' '}
            · {undated} with an unclear date not shown
          </span>
        )}
      </figcaption>
      <div ref={track} className="dp__track" style={{ ['--lines' as string]: lineEnds.length }}>
        <div className="dp__axis" />
        {years.map((y, k) => (
          <span key={y} className={`dp__year nums${k % 2 ? ' dp__year--minor' : ''}`} style={{ left: `${((y - first) / span) * 100}%` }}>
            {y}
          </span>
        ))}
        {placed.map((u) => (
          <a
            key={u.slug}
            className="dp__dot nums"
            href={indicationHref(slug, u.slug)}
            style={{ left: `${u.x}%`, ['--line' as string]: u.line }}
            title={`${u.n}. ${u.name}, ${formatDate(u.date)}`}
            aria-label={`${u.n}. ${u.name}, approved ${formatDate(u.date)}`}
          >
            {u.n}
          </a>
        ))}
      </div>
    </figure>
  );
}

function DrugView({ drug }: { drug: Drug }) {
  usePageMeta(drugMeta(drug));
  const listed = drugIndex.find((d) => d.slug === drug.slug);
  const about = drug.pharmacology;
  const indications = [...drug.indications].sort((a, b) =>
    (a.approvalDate?.value ?? '9999').localeCompare(b.approvalDate?.value ?? '9999'),
  );
  const dated: DatedUse[] = indications.flatMap((i, k) =>
    i.approvalDate ? [{ n: k + 1, slug: i.slug, name: i.displayName ?? i.name, date: i.approvalDate }] : [],
  );
  const app = drug.regulatory.us;

  return (
    <main className="drug dp">
      <header className="dp__head">
        <p className="dp__eyebrow nums">
          <span className="dp__eyebrow-mark" aria-hidden="true" />
          Drug · {app.applicationType} {app.applicationNumber}
        </p>
        <h1>
          {drug.brandName}
          <span className="dp__dot-mark">.</span> <span className="drug__inn">{drug.inn}</span>
        </h1>
      </header>

      <div className="dp__intro">
        <section className="dp__for" aria-labelledby="for-head">
          <h2 id="for-head">What it’s for</h2>
          {about?.patientSummary ? (
            <PatientSummary summary={about.patientSummary} />
          ) : (
            <p className="pharm__gap">Not yet read from the label’s patient information.</p>
          )}
        </section>

        <dl className="dp__facts">
          <div>
            <dt>Company</dt>
            <dd>{listed?.company ?? drug.sponsor}</dd>
          </div>
          <div>
            <dt>Drug class</dt>
            <dd>
              {about?.drugClass ? (
                // The label prints some classes in lower case ("hepcidin mimetic"); shown with a capital, words unchanged.
                about.drugClass.name.charAt(0).toUpperCase() + about.drugClass.name.slice(1)
              ) : (
                <span className="pharm__gap">Not yet matched</span>
              )}
            </dd>
          </div>
          <div>
            <dt>First approved</dt>
            <dd className="nums">{listed?.firstApproval ? formatDate(listed.firstApproval) : DATE_UNCLEAR}</dd>
          </div>
          <div>
            <dt>Approved uses</dt>
            <dd className="nums">{indications.length}</dd>
          </div>
        </dl>
      </div>

      <section className="uses uses--wide dp__uses" aria-labelledby="uses-head">
        <h2 id="uses-head">Approved uses</h2>
        <p className="dp__sub">
          In the FDA’s words, oldest first. Each opens the trials behind the approval and every later change to it.
        </p>
        <UsesTimeline slug={drug.slug} uses={dated} undated={indications.length - dated.length} />
        <ul className="uselist">
          <li className="uselist__row uselist__head" aria-hidden="true">
            <span />
            <span>Indication</span>
            <span>Disease</span>
            <span className="uselist__date">First approved</span>
            <span className="uselist__trials">Trials</span>
            <span />
          </li>
          {indications.map((i, k) => {
            const trials = trialsForIndication(drug, i.name).length;
            const diseases = i.diseases ?? [];
            return (
              <li key={i.slug} className="uselist__row">
                <span className="uselist__n nums">{k + 1}</span>
                <a href={indicationHref(drug.slug, i.slug)} className="uselist__name">
                  {i.displayName ?? i.name}
                </a>
                <span className="uselist__disease">
                  <span className="uselist__label">Disease: </span>
                  {diseases.length > 0 ? (
                    <>
                      {diseases.map((d, j) => (
                        <span key={d.meshId}>
                          {j > 0 && ', '}
                          <a href={diseaseHref(d.meshId)}>{diseaseName.get(d.meshId) ?? naturalTerm(d.term)}</a>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="uselist__none">Not yet matched</span>
                  )}
                </span>
                <span className="uselist__date">{i.approvalDate ? formatDate(i.approvalDate) : DATE_UNCLEAR}</span>
                <span className="uselist__trials">
                  {trials} {trials === 1 ? 'trial' : 'trials'}
                </span>
                <span className="uselist__open" aria-hidden="true">
                  Open →
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pharm" aria-labelledby="pharm-head">
        <h2 id="pharm-head">
          How it works
          <Info label="About this section">
            Word for word from the FDA-approved label, sections 12.1 to 12.3; each part links to its page of the label.
            The drug class is the FDA’s, from the label or the FDA’s list of drug classes.
          </Info>
        </h2>
        <p className="dp__sub">Clinical pharmacology, word for word from the FDA label.</p>
        {about && about.sections.length > 0 ? (
          about.sections.map((s, i) => (
            <details key={s.number} className="pharm__section" open={i === 0}>
              <summary>
                {s.number} {s.title}
              </summary>
              <p className="pharm__text">
                {withoutPageFooters(s.text)}
                {s.truncated && ' …'}
              </p>
              <p className="pharm__cite">
                {s.truncated && 'Continues on the label. '}
                <SourceLink provenance={s.provenance} label={`Label section ${s.number}`} />
              </p>
            </details>
          ))
        ) : (
          <p className="pharm__gap">Not yet read from the label.</p>
        )}
      </section>

      <NewsSection slug={drug.slug} />

      <section className="drug__sources" aria-labelledby="sources-head">
        <h2 id="sources-head">Sources</h2>
        <dl className="drug__facts">
          <div>
            <dt>FDA application</dt>
            <dd>
              {app.applicationType} {app.applicationNumber}
            </dd>
          </div>
          {listed?.office && (
            <div>
              <dt>Reviewed by</dt>
              <dd>FDA Office of {listed.office}</dd>
            </div>
          )}
          {/* When the weekly refresh last re-read this drug's sources. */}
          {drug.lastIngestedAt && (
            <div>
              <dt>Sources last read</dt>
              <dd>{formatDate({ value: drug.lastIngestedAt.slice(0, 10), precision: 'day' })}</dd>
            </div>
          )}
        </dl>
      </section>
    </main>
  );
}
