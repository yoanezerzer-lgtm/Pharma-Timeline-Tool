import { Info } from '../components/Info/Info.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { severityGroups, type DiseaseSummary, type UseStep } from '../lib/diseases.js';
import { diseaseIndex, drugIndex } from '../lib/catalog.js';
import { siteAreas } from '../lib/siteAreas.js';
import { AREAS } from '../lib/areas.js';
import { ListTable } from '../components/ListTable/ListTable.js';
import { ListControls, Names } from '../components/ListTable/ListControls.js';
import './DrugIndex.css';
import { formatDate, toTime } from '../lib/dates.js';
import { usePageMeta } from '../lib/usePageMeta.js';
import { diseaseMeta, diseasesMeta } from '../lib/pageMeta.js';
import { diseaseHref, drugsHref, indicationHref, indicationTrialHref, replaceQuery } from '../lib/router.js';
import '../components/IndicationTimeline/IndicationTimeline.css';
import { APPROVAL_KIND, approvalKindLabel, DATE_UNCLEAR } from '../lib/copy.js';
import { NotFoundPage } from './NotFoundPage.js';
import { PrecedentTable } from '../components/PrecedentTable/PrecedentTable.js';
import { precedentRows } from '../lib/precedent.js';
import { ReviewTime } from '../components/ReviewTime/ReviewTime.js';
import { Cite } from '../components/Citations/Citations.js';
import { letterSource } from '../lib/citations.js';
import './IndicationPage.css';
import './DrugPage.css';
import './DiseasePage.css';

const DAY = 86_400_000;
/** Lane layout: approval marks along the top, one trial per line below. */
const LANE_TOP = 18;
const LANE_PITCH = 16;
/** A row with its trials hidden: room for the markers only. */
const COMPACT_LANE = 26;

const stepLabel = (s: UseStep) => approvalKindLabel(s.kind, s.submissions);

export function DiseasePage({ meshId }: { meshId: string }) {
  const disease = diseaseIndex.find((d) => d.meshId === meshId);
  if (!disease) return <NotFoundPage message={`No disease “${meshId}” on this site.`} />;
  return <DiseaseView disease={disease} />;
}

function DiseaseView({ disease }: { disease: DiseaseSummary }) {
  usePageMeta(diseaseMeta(disease));
  const drugs = new Set(disease.uses.map((u) => u.drugSlug)).size;
  const areas = siteAreas(disease);
  const companyOf = (slug: string) => drugIndex.find((d) => d.slug === slug)?.company ?? '';
  const rows = precedentRows(disease, companyOf);
  const groups = severityGroups(disease);
  const [pick, setPick] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get('severity');
    return Math.max(0, groups.findIndex((g) => g.severity === asked));
  });
  const group = groups[Math.min(pick, groups.length - 1)];
  const shown = group.disease;
  const shownRows = precedentRows(shown, companyOf);
  const choose = (k: number) => {
    setPick(k);
    replaceQuery(k === 0 ? {} : { severity: groups[k].severity });
  };

  return (
    <main className="drug dz">
      <div className="dz__intro">
        <header className="dz__head">
          <h1>{disease.name}</h1>
          {disease.summary && <Lede summary={disease.summary} />}
        </header>
        <KeyFacts disease={disease} drugs={drugs} approvals={rows.length} areas={areas} />
      </div>

      <DiseaseTimeline
        disease={shown}
        companyOf={companyOf}
        severity={
          groups.length > 1 && (
            <div className="disease__severity">
              <div className="precedent__filter" role="group" aria-label="Severity">
                {groups.map((g, k) => (
                  <button key={g.severity} type="button" aria-pressed={k === pick} onClick={() => choose(k)}>
                    {g.label} · {plural(new Set(g.disease.uses.map((u) => u.drugSlug)).size, 'drug')}
                  </button>
                ))}
              </div>
              <p className="disease__severity-note">Shown separately: their trials enrolled different patients.</p>
            </div>
          )
        }
      />

      <section className="precedents" aria-labelledby="precedents-head">
        <div className="disease__timeline-head">
          <h2 id="precedents-head">
            Every approval
            <Info label="About this table">
              One row per FDA approval letter. “What the FDA approved” is the letter’s own sentence, or the label’s
              wording. Pivotal trials are listed only where the records tie them to that approval; later letters say
              “Not yet matched” rather than guess. “Months after trials” runs from the last of those trials’ primary
              completion to the approval. Each date links to the FDA letter.
            </Info>
          </h2>
          <ExportButtons disease={shown} />
        </div>
        <p className="dz__sub">One row per FDA letter, in the FDA’s words. Every value links to its source.</p>
        <PrecedentTable key={group.severity} rows={shownRows} />
      </section>

      <ReviewTime meshId={disease.meshId} severity={group.severity} split={groups.length > 1} />

      <div id="about">
        {disease.summary ? <PlainSummary summary={disease.summary} /> : <Definition disease={disease} />}
      </div>

      {disease.summary && disease.definition && (
        <details className="disease__details">
          <summary>Medical definition</summary>
          <Definition disease={disease} />
        </details>
      )}
    </main>
  );
}

/** The opening of MedlinePlus's summary, word for word, cut to two lines, with a jump to the whole of it. */
function Lede({ summary }: { summary: NonNullable<DiseaseSummary['summary']> }) {
  const opening = summary.paragraphs.find((p) => !p.endsWith('?') && !p.startsWith('• '));
  if (!opening) return null;
  return (
    <p className="dz__lede">
      <span className="dz__lede-text">{opening}</span>{' '}
      <a href="#about" className="dz__lede-more">
        Read more ↓
      </a>
      <span className="dz__lede-source">{summary.sourceLabel.split(', ')[0]}</span>
    </p>
  );
}

/** Drugs, approvals, the latest approval with its FDA letter, and the disease's therapeutic areas. */
function KeyFacts({
  disease,
  drugs,
  approvals,
  areas,
}: {
  disease: DiseaseSummary;
  drugs: number;
  approvals: number;
  areas: { id: string; name: string }[];
}) {
  const steps = disease.uses
    .flatMap((u) =>
      u.steps.filter((s) => s.date && s.kind === 'new').map((s) => ({ brand: u.brandName, date: s.date!, src: letterSource(u, s) })),
    )
    .sort((a, b) => a.date.value.localeCompare(b.date.value));
  // Only the latest: the site doesn't hold every drug ever approved, so "first" could be wrong.
  const last = steps[steps.length - 1];
  return (
    <dl className="dz__facts">
      <div>
        <dt>Drugs</dt>
        <dd className="nums">{drugs}</dd>
      </div>
      <div>
        <dt>FDA approvals</dt>
        <dd className="nums">{approvals}</dd>
      </div>
      {last && (
        <div>
          <dt>Latest approval</dt>
          <dd>
            <span className="dz__facts-drug">{last.brand}</span>
            <span className="dz__facts-sub nums">
              {formatDate(last.date)}
              <Cite sources={[last.src]} />
            </span>
          </dd>
        </div>
      )}
      {areas.length > 0 && (
        <div>
          <dt>Therapeutic area</dt>
          <dd>
            {areas.map((a, k) => (
              <span key={a.id}>
                {k > 0 && ', '}
                <a href={drugsHref(a.id)}>{a.name}</a>
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The disease's approvals over time: one lane per approved use, its pivotal
 * trials as bars and each FDA letter as a dot. Also shown on the home page.
 */
export function DiseaseTimeline({
  disease,
  companyOf,
  headingLevel = 2,
  severity,
}: {
  disease: DiseaseSummary;
  companyOf: (drugSlug: string) => string;
  headingLevel?: 2 | 3;
  /** The severity switch, shown at the top of the section. */
  severity?: ReactNode;
}) {
  // Approvals first; the pivotal trials are one click away.
  const [withTrials, setWithTrials] = useState(false);
  const hasTrials = disease.uses.some((u) => u.trials.length > 0);
  const showTrials = withTrials && hasTrials;
  // The scale covers the trials either way, so switching them on doesn't move the approvals.
  const times = disease.uses.flatMap((u) => [
    ...u.steps.filter((s) => s.date).map((s) => toTime(s.date!)),
    ...u.trials.flatMap((t) => [toTime(t.start!), toTime(t.primaryCompletion!)]),
  ]);
  const min = Math.min(...times) - 180 * DAY;
  const max = Math.max(...times) + 180 * DAY;
  const pct = (t: number) => ((t - min) / (max - min)) * 100;
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; y <= new Date(max).getUTCFullYear(); y++) years.push(y);
  const step = Math.ceil(years.length / 8);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // The legend names only what is on screen, in the FDA's terms.
  const firsts = disease.uses.flatMap((u) => u.steps.filter((s) => s.date).slice(0, 1));
  const later = disease.uses.flatMap((u) => u.steps.filter((s) => s.date).slice(1));
  const firstKey = firsts.some((s) => stepLabel(s) !== APPROVAL_KIND.new) ? 'Original approval or new indication' : APPROVAL_KIND.new;
  const laterKey = later.every((s) => s.kind === 'expansion') ? APPROVAL_KIND.expansion : `${APPROVAL_KIND.expansion} or other change`;
  return (
    <section className={`ind-timeline disease__lanes${showTrials ? '' : ' dz__compact'}`} aria-label="Approvals over time">
      <div className="disease__timeline-head">
        <Heading>
          Approvals over time
          <Info label="How to read this">
            One row per drug. Hover a diamond for what the FDA approved and when; click it for the FDA letter. With
            trials shown, bars run from each pivotal trial’s start to its primary completion.
          </Info>
        </Heading>
        {hasTrials && (
          <label className="dz__switch">
            <input type="checkbox" checked={withTrials} onChange={(e) => setWithTrials(e.target.checked)} />
            <span className="dz__switch-track" aria-hidden="true" />
            Show pivotal trials
          </label>
        )}
      </div>
      {severity}
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
          const months = lag(u);
          const height = showTrials ? LANE_TOP + Math.max(1, u.trials.length) * LANE_PITCH : COMPACT_LANE;
          return (
            <li key={`${u.drugSlug}-${u.indicationSlug}`} className="ind-timeline__row disease__row">
              <a className="ind-timeline__name disease__row-name" href={indicationHref(u.drugSlug, u.indicationSlug)}>
                <strong>{u.brandName}</strong>
              </a>
              <span className="ind-timeline__track disease__lane" style={{ height: `${height}px` }}>
                {years.map((y, i) =>
                  i % step === 0 ? (
                    <span key={y} className="ind-timeline__gridline" style={{ left: `${pct(Date.UTC(y, 0, 1))}%` }} />
                  ) : null,
                )}
                {showTrials && u.steps.map((s, k) =>
                  s.date ? (
                    <span key={`g${k}`} className="disease__guide" style={{ left: `${pct(toTime(s.date))}%` }} aria-hidden="true" />
                  ) : null,
                )}
                {showTrials && u.trials.map((t, k) => {
                  const from = pct(toTime(t.start!));
                  const to = pct(toTime(t.primaryCompletion!));
                  const labelLeft = to < 72;
                  // Finished after the use's first approval: it can't be what that approval rested on.
                  const after = !!firstDate && t.primaryCompletion!.value > firstDate.value;
                  return (
                    <a
                      key={t.id}
                      className="disease__trial"
                      href={indicationTrialHref(u.drugSlug, u.indicationSlug, t.id)}
                      title={`${t.name}: ${formatDate(t.start!)} to ${formatDate(t.primaryCompletion!)}${after ? ', after the first approval' : ''}`}
                      style={{ top: `${LANE_TOP + k * LANE_PITCH}px` }}
                    >
                      <span
                        className={`disease__bar${t.phase === 'PHASE3' ? '' : ' disease__bar--early'}${after ? ' disease__bar--after' : ''}`}
                        style={{ left: `${from}%`, width: `${Math.max(0.4, to - from)}%` }}
                      />
                      <span
                        className="disease__bar-label"
                        style={labelLeft ? { left: `calc(${to}% + 6px)` } : { right: `calc(${100 - from}% + 6px)` }}
                      >
                        {t.name}
                      </span>
                    </a>
                  );
                })}
                {u.steps.map((s, k) =>
                  s.date ? (
                    <a
                      key={k}
                      className={`dz__marker${s.kind === 'new' ? '' : ' dz__marker--later'}${pct(toTime(s.date)) > 65 ? ' dz__marker--end' : ''}`}
                      style={{ left: `${pct(toTime(s.date))}%` }}
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${u.brandName}: ${stepLabel(s)} ${formatDate(s.date)}, FDA letter`}
                    >
                      <span className="dz__tip" aria-hidden="true">
                        <span className="dz__tip-name">{u.brandName}</span>
                        <span className="dz__tip-kind">{stepLabel(s)}</span>
                        <span className="dz__tip-meta nums">
                          {formatDate(s.date)}
                          {k === 0 && months !== undefined && ` · ${months} mo after trials`}
                        </span>
                        <span className="dz__tip-hint">Opens the FDA letter ↗</span>
                      </span>
                    </a>
                  ) : null,
                )}
              </span>
              <span className="ind-timeline__date">{firstDate ? formatDate(firstDate) : DATE_UNCLEAR}</span>
            </li>
          );
        })}
      </ol>
      <ul className="disease__legend" aria-label="Legend">
        <li>
          <span className="dz__key" /> {firstKey}
        </li>
        {later.length > 0 && (
          <li>
            <span className="dz__key dz__key--later" /> {laterKey}
          </li>
        )}
        {showTrials && (
          <>
            <li>
              <span className="disease__key-bar" /> Pivotal trial
            </li>
            <li>
              <span className="disease__key-bar disease__key-bar--early" /> Earlier phase
            </li>
            <li>
              <span className="disease__key-bar disease__key-bar--after" /> Finished after approval
            </li>
          </>
        )}
      </ul>
      <TimelineData disease={disease} companyOf={companyOf} />
    </section>
  );
}

/** Every value the timeline plots, as a table, for readers who can't use the chart or want the numbers. */
function TimelineData({ disease, companyOf }: { disease: DiseaseSummary; companyOf: (drugSlug: string) => string }) {
  const approvals = disease.uses
    .flatMap((u) => u.steps.map((s, k) => ({ u, s, k })))
    .sort((a, b) => (a.s.date?.value ?? '9999').localeCompare(b.s.date?.value ?? '9999'));
  const trials = disease.uses.flatMap((u) => u.trials.map((t) => ({ u, t })));
  return (
    <details className="disease__data">
      <summary>Data table</summary>
      <table className="precedent__table disease__data-table">
        <caption>Approvals plotted</caption>
        <thead>
          <tr>
            <th scope="col">Drug</th>
            <th scope="col">Company</th>
            <th scope="col">Event</th>
            <th scope="col">Submission</th>
            <th scope="col">Date</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {approvals.map(({ u, s, k }) => (
            <tr key={`${u.drugSlug}-${u.indicationSlug}-${k}`}>
              <td>{u.brandName}</td>
              <td>{companyOf(u.drugSlug)}</td>
              <td>
                {stepLabel(s)}
                {k === 0 && ' (◇ marker)'}
              </td>
              <td className="review-time__mono">{s.submissions.join(', ') || '—'}</td>
              <td className="review-time__mono">{s.date ? formatDate(s.date) : DATE_UNCLEAR}</td>
              <td>
                {s.sourceUrl ? (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                    FDA letter ↗
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {trials.length > 0 && (
        <table className="precedent__table disease__data-table">
          <caption>Pivotal trials plotted</caption>
          <thead>
            <tr>
              <th scope="col">Drug</th>
              <th scope="col">Trial</th>
              <th scope="col">Phase</th>
              <th scope="col">Start</th>
              <th scope="col">Primary completion</th>
            </tr>
          </thead>
          <tbody>
            {trials.map(({ u, t }) => (
              <tr key={`${u.drugSlug}-${u.indicationSlug}-${t.id}`}>
                <td>{u.brandName}</td>
                <td>
                  <a href={indicationTrialHref(u.drugSlug, u.indicationSlug, t.id)}>{t.name}</a>
                </td>
                <td className="review-time__mono">{t.phase ?? '—'}</td>
                <td className="review-time__mono">{formatDate(t.start!)}</td>
                <td className="review-time__mono">{formatDate(t.primaryCompletion!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

export function DiseasesPage() {
  usePageMeta(diseasesMeta());
  const [initial] = useState(() => new URLSearchParams(window.location.search));
  const [query, setQuery] = useState(initial.get('q') ?? '');
  const [area, setArea] = useState(initial.get('area') ?? '');
  useEffect(() => replaceQuery({ q: query, area }), [query, area]);

  const rows = useMemo(() => diseaseIndex.map(diseaseRow), []);
  const areasShown = AREAS.filter((a) => rows.some((r) => r.areas.some((x) => x.id === a.id)));
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!area || r.areas.some((a) => a.id === area)) &&
      (!q || [r.d.name, r.d.term, ...r.drugs, ...r.areas.map((a) => a.name)].join(' ').toLowerCase().includes(q)),
  );

  return (
    <main className="index">
      <header className="index__head">
        <h1>Diseases</h1>
        <p className="index__lede">
          {diseaseIndex.length} diseases with an FDA-approved drug on this site.
          <Info label="About this list">
            Disease names come from MeSH, the U.S. National Library of Medicine’s medical vocabulary, matched to each
            approved use. Therapeutic areas are the site’s own grouping.
          </Info>
        </p>
      </header>
      <ListControls
        query={query}
        onQuery={setQuery}
        area={area}
        onArea={setArea}
        areas={areasShown}
        placeholder="Search a disease or drug"
        count={shown.length}
        noun="disease"
      />
      {shown.length > 0 ? (
        <ListTable
          caption="Diseases with FDA approvals"
          rows={shown}
          rowKey={(r) => r.d.meshId}
          initialSort={{ key: 'disease', up: true }}
          columns={[
            {
              key: 'disease',
              label: 'Disease',
              sort: (r) => r.d.name,
              render: (r) => (
                <a className="index__name" href={diseaseHref(r.d.meshId)}>
                  {r.d.name}
                </a>
              ),
            },
            { key: 'area', label: 'Therapeutic area', sort: (r) => r.areas[0]?.name, render: (r) => <span className="list-table__sub">{r.areas.map((a) => a.name).join(', ') || '—'}</span> },
            {
              key: 'drugs',
              label: 'Approved drugs',
              sort: (r) => r.drugs.length,
              descFirst: true,
              phoneLabel: true,
              render: (r) => <Names names={r.drugs} max={4} />,
            },
            { key: 'first', label: 'First approval', sort: (r) => r.first?.value, descFirst: true, className: 'is-date', phoneLabel: true, render: (r) => (r.first ? formatDate(r.first) : '—') },
            { key: 'latest', label: 'Latest approval', sort: (r) => r.latest?.value, descFirst: true, className: 'is-date', phoneLabel: true, render: (r) => (r.latest ? formatDate(r.latest) : '—') },
          ]}
        />
      ) : (
        <p className="index__none">No diseases match your search.</p>
      )}
    </main>
  );
}

/** One row of the diseases list: its drugs in order of first approval, and its first and latest FDA approval. */
function diseaseRow(d: DiseaseSummary) {
  const firstOf = (u: DiseaseSummary['uses'][number]) => u.steps.find((s) => s.date)?.date;
  const uses = [...d.uses].sort((a, b) => (firstOf(a)?.value ?? '9999').localeCompare(firstOf(b)?.value ?? '9999'));
  const dates = d.uses.flatMap((u) => u.steps.flatMap((s) => (s.date ? [s.date] : [])));
  const by = (pick: (a: string, b: string) => boolean) => (dates.length ? dates.reduce((a, b) => (pick(b.value, a.value) ? b : a)) : undefined);
  return {
    d,
    areas: siteAreas(d),
    drugs: [...new Set(uses.map((u) => u.brandName))],
    first: by((x, y) => x < y),
    latest: by((x, y) => x > y),
  };
}

/** MedlinePlus's summary, word for word, opening on its first paragraph (after a lead question, if any). */
function PlainSummary({ summary }: { summary: NonNullable<DiseaseSummary['summary']> }) {
  const [open, setOpen] = useState(false);
  const opening = summary.paragraphs[0]?.endsWith('?') ? 2 : 1;
  const shown = open ? summary.paragraphs : summary.paragraphs.slice(0, opening);
  return (
    <section className="disease__plain" aria-labelledby="about-head">
      <h2 id="about-head">About the disease</h2>
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
      <button type="button" className="disease__export-main" onClick={() => run('xlsx')} disabled={busy !== null}>
        {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}
      </button>
      <button type="button" onClick={() => run('pptx')} disabled={busy !== null}>
        {busy === 'pptx' ? 'Preparing…' : 'Download PowerPoint'}
      </button>
      {failed && <span className="disease__export-error">Couldn’t make the file. Try again.</span>}
    </div>
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

/** Whole months from the last pivotal primary completion before the first approval, to that approval. */
function lag(u: DiseaseSummary['uses'][number]): number | undefined {
  const first = u.steps.find((s) => s.date)?.date;
  if (!first || first.precision === 'year') return undefined;
  const ends = u.trials.map((t) => t.primaryCompletion).filter((d): d is NonNullable<typeof d> => !!d && d.precision !== 'year' && d.value <= first.value);
  if (ends.length === 0) return undefined;
  const last = ends.reduce((a, b) => (b.value > a.value ? b : a));
  const [ay, am] = first.value.split('-').map(Number);
  const [ly, lm] = last.value.split('-').map(Number);
  return (ay - ly) * 12 + (am - lm);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
