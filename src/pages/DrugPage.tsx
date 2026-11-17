import { useEffect, useRef, useState } from 'react';
import { Info } from '../components/Info/Info.js';
import { diseaseIndex, drugIndex, useDrug, useNews } from '../lib/catalog.js';
import { formatDate } from '../lib/dates.js';
import { roleFor, trialsForIndication } from '../lib/drugs.js';
import { siteAreas } from '../lib/siteAreas.js';
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

/** A date as a year with a fraction ("2017-03-28" → 2017.24), for placing it on the strip. */
function yearPosition(value: string): number {
  const [y, m = 1, d = 1] = value.split('-').map(Number);
  return y + ((m - 1) * 30.4 + (d - 1)) / 365;
}

type Use = Drug['indications'][number];

/** What a use is for, as names: its matched diseases, or the FDA's short name when none is matched yet. */
function useNames(use: Use): { name: string; meshId?: string }[] {
  const diseases = use.diseases ?? [];
  if (diseases.length > 0) return diseases.map((d) => ({ name: diseaseName.get(d.meshId) ?? naturalTerm(d.term), meshId: d.meshId }));
  return [{ name: use.displayName ?? use.name }];
}

/** The pivotal trials the FDA documents name for one use. */
function pivotalCount(drug: Drug, use: Use): number {
  return trialsForIndication(drug, use.name).filter((t) => roleFor(t, use.name) === 'PIVOTAL').length;
}

type DatedUse = { use: Use; date: NonNullable<Use['approvalDate']> };

/**
 * Every approval as a marker on one line of years, so the label's growth
 * reads at a glance. Hovering (or focusing) a marker shows what it was for.
 * Markers too close to share a height stand taller.
 */
function ApprovalsTimeline({ drug, uses, undated }: { drug: Drug; uses: DatedUse[]; undated: number }) {
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
  // Each marker takes the lowest height whose last marker is at least one marker's width to the left.
  const MIN_GAP = (18 / Math.max(width, 1)) * 100;
  const levelEnds: number[] = [];
  const placed = uses.map((u) => {
    const x = at(u.date.value);
    let level = levelEnds.findIndex((end) => x - end >= MIN_GAP);
    if (level === -1) level = levelEnds.length;
    levelEnds[level] = x;
    return { ...u, x, level };
  });
  const step = span > 24 ? 5 : span > 12 ? 2 : 1;
  const years: number[] = [];
  for (let y = first; y <= last; y += step) years.push(y);

  return (
    <figure className="dp__timeline" aria-label="Approvals over time">
      <figcaption>
        Approvals over time
        {undated > 0 && <span className="dp__timeline-note"> · {undated} with an unclear date not shown</span>}
      </figcaption>
      <div ref={track} className="dp__track" style={{ ['--levels' as string]: levelEnds.length }}>
        <div className="dp__axis" />
        {years.map((y, k) => (
          <span key={y} className={`dp__year nums${k % 2 ? ' dp__year--minor' : ''}`} style={{ left: `${((y - first) / span) * 100}%` }}>
            {y}
          </span>
        ))}
        {placed.map(({ use, date, x, level }) => {
          const names = useNames(use);
          const areas = [...new Set(names.flatMap((n) => (n.meshId ? siteAreas({ meshId: n.meshId }).map((a) => a.name) : [])))];
          const pivotal = pivotalCount(drug, use);
          const label = names.map((n) => n.name).join(', ');
          return (
            <a
              key={use.slug}
              className={`dp__marker${x > 65 ? ' dp__marker--end' : ''}`}
              href={indicationHref(drug.slug, use.slug)}
              style={{ left: `${x}%`, ['--level' as string]: level }}
              aria-label={`${label}, approved ${formatDate(date)}`}
            >
              <span className="dp__stem" aria-hidden="true" />
              <span className="dp__diamond" aria-hidden="true" />
              <span className="dp__tip" aria-hidden="true">
                <span className="dp__tip-name">{label}</span>
                {areas.length > 0 && <span className="dp__tip-area">{areas.join(' · ')}</span>}
                <span className="dp__tip-meta nums">
                  {formatDate(date)} · {pivotal} pivotal {pivotal === 1 ? 'trial' : 'trials'}
                </span>
              </span>
            </a>
          );
        })}
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
  const dated: DatedUse[] = indications.flatMap((use) => (use.approvalDate ? [{ use, date: use.approvalDate }] : []));
  // The diseases it is approved for, oldest approval first, each once.
  const approvedFor = [...new Map(indications.flatMap(useNames).map((n) => [n.meshId ?? n.name, n])).values()];
  const app = drug.regulatory.us;

  return (
    <main className="drug dp">
      <header className="dp__head">
        <h1>
          {drug.brandName} <span className="drug__inn">({drug.inn})</span>
        </h1>
        <p className="dp__app nums">
          {app.applicationType} {app.applicationNumber}
        </p>
      </header>

      <div className="dp__intro">
        <section className="dp__for" aria-labelledby="for-head">
          <h2 id="for-head">Approved for</h2>
          <ul className="dp__chips">
            {approvedFor.map((n) => (
              <li key={n.meshId ?? n.name}>{n.meshId ? <a href={diseaseHref(n.meshId)}>{n.name}</a> : <span>{n.name}</span>}</li>
            ))}
          </ul>
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
            <dt>First approval</dt>
            <dd className="nums">{listed?.firstApproval ? formatDate(listed.firstApproval) : DATE_UNCLEAR}</dd>
          </div>
          <div>
            <dt>Approvals</dt>
            <dd className="nums">{indications.length}</dd>
          </div>
        </dl>
      </div>

      <section className="uses uses--wide dp__uses" aria-labelledby="uses-head">
        <h2 id="uses-head">Approvals</h2>
        <p className="dp__sub">
          In the FDA’s words, oldest first. Each opens the trials behind the approval and every later change to it.
        </p>
        <ApprovalsTimeline drug={drug} uses={dated} undated={indications.length - dated.length} />
        <ul className="uselist">
          <li className="uselist__row uselist__head" aria-hidden="true">
            <span>Indication</span>
            <span className="uselist__date">First approval</span>
            <span className="uselist__trials">Pivotal trials</span>
            <span />
          </li>
          {indications.map((i) => {
            const pivotal = pivotalCount(drug, i);
            return (
              <li key={i.slug} className="uselist__row">
                <a href={indicationHref(drug.slug, i.slug)} className="uselist__name">
                  {i.displayName ?? i.name}
                </a>
                <span className="uselist__date">{i.approvalDate ? formatDate(i.approvalDate) : DATE_UNCLEAR}</span>
                <span className="uselist__trials">
                  {pivotal > 0 ? (
                    <>
                      {pivotal}
                      <span className="uselist__label"> pivotal {pivotal === 1 ? 'trial' : 'trials'}</span>
                    </>
                  ) : (
                    <span className="uselist__none">None on record</span>
                  )}
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
            Word for word from the FDA-approved label; each part links to its page of the label.
          </Info>
        </h2>
        {about && about.sections.length > 0 ? (
          about.sections.map((s, i) => (
            <details key={s.number} className="pharm__section" open={i === 0}>
              <summary>{s.title}</summary>
              <p className="pharm__text">
                {withoutPageFooters(s.text)}
                {s.truncated && ' …'}
              </p>
              <p className="pharm__cite">
                {s.truncated && 'Continues on the label. '}
                <SourceLink provenance={s.provenance} label="FDA label" />
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
