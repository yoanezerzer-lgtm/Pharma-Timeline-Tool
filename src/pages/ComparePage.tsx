import { Info } from '../components/Info/Info.js';
import { useEffect, useId, useMemo, useState } from 'react';
import type { Approval, Trial } from '../schema/index.js';
import { drugIndex, useDrug, type DrugState } from '../lib/catalog.js';
import {
  buildAlignedAxis,
  buildAxis,
  endpointsDiffer,
  evidenceCsv,
  evidenceRows,
  monthsBetween,
  parseProgramRef,
  programRefString,
  programView,
  readoutCards,
  WHOLE_USE,
  type Axis,
  type EvidenceRow,
  type ProgramRef,
  type ProgramView,
} from '../lib/compare.js';
import { formatDate } from '../lib/dates.js';
import { indicationLabel, ROLE_LABEL, shortIndication } from '../lib/drugs.js';
import { areasOfDrug } from '../lib/areas.js';
import { SEVERITY_LABEL, severityOfText, type Severity } from '../lib/diseases.js';
import { indicationHref, replaceQuery } from '../lib/router.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { timelineApprovals } from '../components/TrialDetail/TrialTimeline.js';
import { approvalKindLabel } from '../lib/copy.js';
import './ComparePage.css';

interface ProgramOption {
  ref: string;
  drug: string;
  inn: string;
  /** The FDA's words, cut at a word for the picker; the full wording is the tooltip. */
  indication: string;
  full: string;
  /** The therapeutic area the owner files this use under; unset when not clear for this use. */
  area?: string;
  severity: Severity;
  year?: string;
  trials: number;
}

const OPTIONS: ProgramOption[] = drugIndex
  .flatMap((d) =>
    d.indications.map((i) => ({
      ref: programRefString({ slug: d.slug, indicationSlug: i.slug }),
      drug: d.brandName,
      inn: d.inn,
      indication: shortIndication(i, 56),
      full: indicationLabel(i),
      area: useArea(d, i),
      severity: severityOfText([i.name]),
      year: i.approvalDate?.value.slice(0, 4),
      trials: i.trialCount,
    }))
  )
  .sort((a, b) => a.drug.localeCompare(b.drug) || a.indication.localeCompare(b.indication));

// Two moderate-to-severe atopic dermatitis approvals: the featured area, and a fair pair to set side by side.
/**
 * The area for one approved use: the area the owner files its disease under,
 * else the drug's area when it has only one. Blank rather than a guess when a
 * drug spans several areas (Dupixent's asthma isn't Immunology).
 */
function useArea(d: (typeof drugIndex)[number], i: (typeof drugIndex)[number]['indications'][number]): string | undefined {
  const own = areasOfDrug({ slug: '', indications: [i] });
  if (own.length > 0) return own.map((a) => a.name).join(', ');
  const all = areasOfDrug(d);
  return all.length === 1 ? all[0].name : undefined;
}


/** Severity the FDA's wording names for this approval: its letters, newest first, then the label. */
function programSeverity(p: ProgramView): Severity {
  const letters = (p.chosen ? [p.chosen] : [...p.approvals].reverse()).map((a) => a.statement);
  return severityOfText([...letters, p.indication.name]);
}

/** Two severities that are both named and differ: never compared side by side (owner, 9 Nov). */
const clash = (a?: Severity, b?: Severity) => !!a && !!b && a !== 'not-stated' && b !== 'not-stated' && a !== b;

const DEFAULTS = ['lebrikizumab:moderate-to-severe-atopic-dermatitis-in-adults-and', 'tralokinumab:moderate-to-severe-atopic-dermatitis-in-adults-and'];

function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function initialRefs(): [ProgramRef, ProgramRef] {
  const p = readParams();
  const pick = (key: string, fallback: string) =>
    parseProgramRef(p.get(key)) ?? parseProgramRef(OPTIONS.some((o) => o.ref === fallback) ? fallback : OPTIONS[0]?.ref ?? '')!;
  return [pick('a', DEFAULTS[0]), pick('b', DEFAULTS[1])];
}

export function ComparePage() {
  const [refs, setRefs] = useState<[ProgramRef, ProgramRef]>(initialRefs);
  const [focusedReadout, setFocusedReadout] = useState<string | null>(null);
  const [openTrial, setOpenTrial] = useState<{ program: string; trialId: string } | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [withOthers, setWithOthers] = useState(false);

  useEffect(() => {
    replaceQuery({ a: programRefString(refs[0]), b: programRefString(refs[1]) });
  }, [refs]);

  const states: [DrugState, DrugState] = [useDrug(refs[0].slug), useDrug(refs[1].slug)];

  const programs = useMemo(
    () =>
      states.map((s, i) => {
        if (s.status !== 'ready') return undefined;
        const indication = s.drug.indications.find((x) => x.slug === refs[i].indicationSlug);
        return indication ? programView(s.drug, indication, refs[i].submission) : undefined;
      }),
    [states[0], states[1], refs]
  );
  const ready = programs.filter((p): p is ProgramView => !!p);
  // Only the pivotal trials show until the switch asks for the rest.
  const shown = useMemo(
    () => ready.map((p) => (withOthers ? p : { ...p, lanes: p.lanes.filter((l) => l.role === 'PIVOTAL') })),
    [ready, withOthers]
  );
  const others = ready.reduce((n, p) => n + p.lanes.filter((l) => l.role !== 'PIVOTAL').length, 0);
  const dep = shown.map((p) => p.key + p.lanes.length).join();
  const calendarAxis = useMemo(() => buildAxis(shown), [dep]);
  const alignedAxis = useMemo(() => buildAlignedAxis(shown), [dep]);
  const aligned = !calendar && alignedAxis !== undefined;
  const rows = useMemo(() => evidenceRows(ready), [ready]);
  const shownRows = useMemo(() => evidenceRows(shown), [shown]);
  const cards = useMemo(() => readoutCards(ready), [ready]);
  const severities = programs.map((p) => (p ? programSeverity(p) : undefined));
  const mismatch = clash(severities[0], severities[1]);

  const setRef = (i: 0 | 1, ref: string) => {
    const r = parseProgramRef(ref);
    if (!r) return;
    setRefs((prev) => (i === 0 ? [r, prev[1]] : [prev[0], r]));
  };
  const setApproval = (i: 0 | 1, submission: string) => setRef(i, programRefString({ ...refs[i], submission }));

  const showTrial = (program: string, trialId: string) => setOpenTrial({ program, trialId });
  const openProgram = ready.find((p) => p.key === openTrial?.program);
  const selectedTrial: Trial | undefined = openProgram?.drug.trials.find((t) => t.id === openTrial?.trialId);

  const showReadout = (key: string) => {
    setFocusedReadout(key);
    document.getElementById(readoutAnchor(key))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const exportCsv = () => {
    const blob = new Blob([evidenceCsv(rows, ready)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compare-${ready.map((p) => p.key.replace(':', '-')).join('-vs-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const names = programs.map((p, i) => p?.drug.brandName ?? `Approval ${i + 1}`);

  return (
    <main className={`compare${selectedTrial ? ' has-drawer' : ''}`}>
      <div className="compare__head">
        <h1>
          {names[0]} <span className="compare__vs">vs</span> {names[1]}
        </h1>
        <div className="compare__actions">
          <button type="button" className="compare__button" onClick={exportCsv} disabled={rows.length === 0}>
            Download CSV
          </button>
        </div>
      </div>

      {mismatch && (
        <p className="compare__severity" role="alert">
          {SEVERITY_LABEL[severities[0]!]} and {SEVERITY_LABEL[severities[1]!].toLowerCase()} approvals can’t be
          compared side by side. Pick an approval of the same severity.
        </p>
      )}

      <div className="compare__panes">
        {([0, 1] as const).map((i) => (
          <ProgramCard
            key={i}
            index={i}
            current={programRefString({ slug: refs[i].slug, indicationSlug: refs[i].indicationSlug })}
            state={states[i]}
            program={programs[i]}
            otherSeverity={severities[i === 0 ? 1 : 0]}
            onPick={(ref) => setRef(i, ref)}
            onPickApproval={(submission) => setApproval(i, submission)}
            onTrial={showTrial}
          />
        ))}
      </div>

      {shown.length > 0 && !mismatch && (
        <section className="compare__section" aria-labelledby="road">
          <div className="compare__section-head">
            <h2 id="road">Road to approval</h2>
            <div className="compare__switches">
              {alignedAxis && (
                <div className="seg" role="group" aria-label="Line up the timelines">
                  <button type="button" aria-pressed={!calendar} onClick={() => setCalendar(false)}>
                    Lined up on approval
                  </button>
                  <button type="button" aria-pressed={calendar} onClick={() => setCalendar(true)}>
                    Calendar years
                  </button>
                </div>
              )}
              {others > 0 && (
                <label className="compare__toggle">
                  <input type="checkbox" checked={withOthers} onChange={(e) => setWithOthers(e.target.checked)} />
                  Show {others} supportive and other {others === 1 ? 'trial' : 'trials'}
                </label>
              )}
            </div>
          </div>
          <RoadChart
            programs={shown}
            axis={aligned ? alignedAxis! : calendarAxis}
            aligned={aligned}
            onTrial={showTrial}
            onReadout={showReadout}
            hasReadouts={cards.length > 0}
          />
        </section>
      )}

      {shownRows.length > 0 && !mismatch && (
        <EvidenceCards programs={shown} rows={shownRows} differ={endpointsDiffer(shownRows)} onTrial={showTrial} />
      )}

      {rows.length > 0 && !mismatch && cards.length > 0 && (
        <section className="compare__section" aria-labelledby="readouts">
          <h2 id="readouts">When results were first announced</h2>
          <div className="readouts">
            {cards.map((c) => (
              <article key={c.key} id={readoutAnchor(c.key)} className={`readout${focusedReadout === c.key ? ' is-focused' : ''}`}>
                <div className="readout__meta">
                  <span><strong>{c.trials.join(' and ')}</strong> · {c.drug}, {c.indication}</span>
                  <span className="mono">{formatDate(c.date)}</span>
                </div>
                {c.provenance.sourceLabel && c.provenance.sourceUrl && (
                  <a className="readout__headline" href={c.provenance.sourceUrl} target="_blank" rel="noreferrer">
                    {c.provenance.sourceLabel.replace(/^[^:]+:\s*/, '')} ↗
                  </a>
                )}
                {/* Company releases are linked, never quoted (owner, 7 Nov). */}
                <div className="readout__stats">
                  <Stat label="Primary completion → announced" months={c.completionToAnnouncement} />
                  <Stat label="Announced → approval" months={c.announcementToApproval} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {selectedTrial && openProgram && (
        <TrialDrawer
          trial={selectedTrial}
          indication={openProgram.indication.name}
          approvals={timelineApprovals(openProgram.indication)}
          onClose={() => setOpenTrial(null)}
        />
      )}
    </main>
  );
}

function readoutAnchor(key: string): string {
  return `readout-${key.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}`;
}

function Stat({ label, months }: { label: string; months?: number }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className="stat__value">{months === undefined ? '—' : <>{months} <span>mo</span></>}</p>
    </div>
  );
}

function ProgramPicker({
  index,
  current,
  otherSeverity,
  onPick,
  autoFocus = false,
}: {
  index: number;
  current: string;
  otherSeverity?: Severity;
  onPick: (ref: string) => void;
  autoFocus?: boolean;
}) {
  const currentOption = OPTIONS.find((o) => o.ref === current);
  const blocked = (o: ProgramOption) => clash(o.severity, otherSeverity);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const needle = (query ?? '').trim().toLowerCase();
  const matches = OPTIONS.filter((o) => !needle || `${o.drug} ${o.inn} ${o.full}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(blocked(a)) - Number(blocked(b)))
    .slice(0, 12);

  const choose = (o: ProgramOption) => {
    if (blocked(o)) return;
    onPick(o.ref);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && (setOpen(false), setQuery(null))}>
      <input
        role="combobox"
        autoFocus={autoFocus}
        aria-label={`Approval ${index + 1}: search a drug or approved use`}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={query ?? ''}
        placeholder={currentOption ? 'Switch drug or approved use…' : 'Drug or approved use'}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery(null);
          }
        }}
      />
      {open && (
        <div className="picker__list" id={listId} role="listbox" aria-label="Approvals">
          {matches.length === 0 && <p className="picker__empty">No match. Try a drug name or an approved use.</p>}
          {matches.map((o, k) => (
            <button
              type="button"
              tabIndex={-1}
              key={o.ref}
              id={`${listId}-${k}`}
              role="option"
              aria-selected={o.ref === current}
              aria-disabled={blocked(o) || undefined}
              title={o.full}
              className={`${k === active ? 'is-active' : ''}${blocked(o) ? ' is-blocked' : ''}`.trim() || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <span className="picker__name">
                <strong>{o.drug}</strong>
                {o.area && <> · {o.area}</>}
                <span className="picker__use">{o.indication}</span>
              </span>
              <span className="picker__meta">
                {blocked(o)
                  ? `${SEVERITY_LABEL[o.severity]}: not comparable with ${SEVERITY_LABEL[otherSeverity!].toLowerCase()}`
                  : `${o.year ?? 'undated'} · ${o.trials} trials`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Months from the last pivotal trial's primary completion to this approval; unset when the records can't say. */
function monthsToApproval(program: ProgramView): number | undefined {
  const pivotal = program.lanes.filter((l) => l.role === 'PIVOTAL' && !l.afterApproval);
  const last = Math.max(...pivotal.map((l) => l.primaryCompletion ?? -Infinity));
  return !program.whole && Number.isFinite(last) && last <= (program.approval ?? -Infinity)
    ? monthsBetween(last, program.approval)
    : undefined;
}

function ProgramCard({
  index,
  current,
  state,
  program,
  otherSeverity,
  onPick,
  onPickApproval,
  onTrial,
}: {
  index: 0 | 1;
  current: string;
  state: DrugState;
  program?: ProgramView;
  otherSeverity?: Severity;
  onPick: (ref: string) => void;
  onPickApproval: (submission: string) => void;
  onTrial: (program: string, trialId: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const pivotal = program?.lanes.filter((l) => l.role === 'PIVOTAL').length ?? 0;
  const months = program ? monthsToApproval(program) : undefined;
  const approvedOn = program
    ? program.whole
      ? program.approvals[0].date
      : program.chosen?.date ?? program.indication.approvalDate
    : undefined;

  return (
    <section className="pane" aria-label={program ? `${program.drug.brandName}, ${indicationLabel(program.indication)}` : `Approval ${index + 1}`}>
      <div className="pane__top">
        {program ? (
          <p className="pane__title">
            <a href={indicationHref(program.drug.slug, program.indication.slug)}>{program.drug.brandName}</a>
            <span className="pane__inn">{program.drug.inn}</span>
          </p>
        ) : (
          <p className="pane__title">Approval {index + 1}</p>
        )}
        <button type="button" className="pane__change" aria-expanded={changing} onClick={() => setChanging(!changing)}>
          {changing ? 'Cancel' : 'Change'}
        </button>
      </div>
      {(changing || !program) && (
        <div className="pane__controls">
          <ProgramPicker
            index={index}
            current={current}
            otherSeverity={otherSeverity}
            autoFocus={changing}
            onPick={(ref) => {
              setChanging(false);
              onPick(ref);
            }}
          />
        </div>
      )}

      {state.status === 'loading' && <p className="pane__status">Loading…</p>}
      {(state.status === 'missing' || state.status === 'error' || (state.status === 'ready' && !program)) && (
        <p className="pane__status">Couldn’t load this approval. Pick another with Change.</p>
      )}

      {program && (
        <>
          {program.approvals.length > 1 && (
            <label className="pane__approval-pick">
              <span>Approval</span>
              <select value={program.whole ? WHOLE_USE : program.chosen?.submission} onChange={(e) => onPickApproval(e.target.value)}>
                <option value={WHOLE_USE}>All {program.approvals.length} approvals of this use</option>
                {program.approvals.map((a) => (
                  <option key={a.submission} value={a.submission}>
                    {formatDate(a.date)} · {kindLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {program.chosen && (
            <Wording text={program.chosen.statement} href={program.chosen.provenance.sourceUrl} title={program.chosen.provenance.sourceLabel} />
          )}
          {(program.whole || (!program.chosen && program.approvals.length === 0)) && (
            <Wording
              text={program.indication.wording?.text ?? program.indication.name}
              href={program.indication.wording?.provenance.sourceUrl}
              title="FDA label"
            />
          )}

          <dl className="pane__numbers">
            <div>
              <dt>{program.whole ? 'First approval' : program.chosen ? kindLabel(program.chosen) : 'Approval'}</dt>
              <dd className="nums">{approvedOn ? formatDate(approvedOn) : 'Unclear'}</dd>
            </div>
            <div>
              <dt>Pivotal trials</dt>
              <dd className="nums">{pivotal}</dd>
            </div>
            <div>
              <dt>
                To approval
                {program.whole ? (
                  <Info label="Why there is no month count" align="right">
                    This use was approved in steps and the records don’t say which letter each trial backs. Pick one
                    approval to see its own count.
                  </Info>
                ) : (
                  <Info label="What the month count measures" align="right">
                    From the last pivotal trial’s primary completion (ClinicalTrials.gov) to this FDA approval.
                  </Info>
                )}
              </dt>
              <dd className="nums">
                {months !== undefined ? (
                  <>
                    {months}
                    <span className="pane__unit">months</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {program.lanes.length === 0 && <p className="pane__status">Not yet matched to a trial.</p>}
          {program.unmatched.length > 0 && (
            <p className="pane__unmatched">
              Not yet matched to one approval:{' '}
              {program.unmatched.map((u, k) => (
                <span key={u.trialId}>
                  {k > 0 && ', '}
                  <button type="button" className="pane__unmatched-trial" onClick={() => onTrial(program.key, u.trialId)}>
                    {u.name}
                  </button>
                </span>
              ))}
              <Info label="Why some trials aren't matched">
                A trial is matched to an approval when the FDA’s approval letter names it, or when the use has had
                only one approval. The rest are matched once a check finds the trial in both the letter and the
                label.
              </Info>
            </p>
          )}
        </>
      )}
    </section>
  );
}

const MONTH_MS = 30.4375 * 86400000;

/** "2 yr 3 mo before approval", for a hover card. */
function offsetText(ms: number): string {
  const months = Math.round(Math.abs(ms) / MONTH_MS);
  if (months === 0) return 'at approval';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 && `${y} yr`, m > 0 && `${m} mo`].filter(Boolean).join(' ');
  return `${parts} ${ms < 0 ? 'before' : 'after'} approval`;
}

/**
 * Both programs' trials on one chart. Lined up on approval, every program's
 * approval sits at the same place, so the stretch before it can be compared
 * directly; in calendar years, each sits on its own date.
 */
function RoadChart({
  programs,
  axis,
  aligned,
  onTrial,
  onReadout,
  hasReadouts,
}: {
  programs: ProgramView[];
  axis: Axis;
  aligned: boolean;
  onTrial: (program: string, trialId: string) => void;
  onReadout: (key: string) => void;
  hasReadouts: boolean;
}) {
  const anyOther = programs.some((p) => p.lanes.some((l) => l.role !== 'PIVOTAL'));
  const anyLater = programs.some((p) => p.lanes.some((l) => l.afterApproval));
  const anyLaterApproval = programs.some((p) => p.laterApprovals.length > 0);
  const anyReadout = hasReadouts && programs.some((p) => p.lanes.some((l) => l.readout !== undefined && l.readoutKey));
  return (
    <div className="chart">
      <div className="chart__axis" aria-hidden="true">
        {axis.ticks.map((t, k) => {
          // On a phone only every other year is labelled, in a short form ("−2 yr").
          const n = /^(\d+) yr (before|after)$/.exec(t.label);
          const short = n ? `${n[2] === 'before' ? '−' : '+'}${n[1]} yr` : t.label;
          const odd = n ? Number(n[1]) % 2 === 1 : /^\d{4}$/.test(t.label) && Number(t.label) % 2 === 1;
          return (
            <span key={k} className={`chart__tick${t.major ? ' is-major' : ''}${t.label === 'Approval' ? ' is-zero' : ''}${odd ? ' is-odd' : ''}`} style={{ left: `${t.at}%` }}>
              <span className="chart__tick-label">
                <span className="chart__tick-long">{t.label}</span>
                <span className="chart__tick-short">{short}</span>
              </span>
            </span>
          );
        })}
      </div>
      {programs.map((program) => {
        const place = (t: number | undefined) =>
          t === undefined ? undefined : aligned ? axis.position(t - program.approval!) : axis.position(t);
        const ap = place(program.approval);
        const approvalDate = program.chosen?.date ?? program.approvals[0]?.date ?? program.indication.approvalDate;
        const approvalName = program.chosen ? kindLabel(program.chosen) : program.approvals[0] ? kindLabel(program.approvals[0]) : 'FDA approval';
        return (
          <div key={program.key} className="chart__group">
            <div className="lane lane--head">
              <span className="lane__name lane__name--drug">{program.drug.brandName}</span>
              <div className="lane__track">
                {ap !== undefined && (
                  <span className={`chart__marker${ap > 65 ? ' chart__marker--end' : ''}`} style={{ left: `${ap}%` }} tabIndex={0} aria-label={`${program.drug.brandName}: ${approvalName}${approvalDate ? `, ${formatDate(approvalDate)}` : ''}`}>
                    <span className="chart__diamond" aria-hidden="true" />
                    <span className="chart__tip" aria-hidden="true">
                      <span className="chart__tip-name">{program.drug.brandName}</span>
                      <span className="chart__tip-meta">
                        {approvalName}
                        {approvalDate ? ` · ${formatDate(approvalDate)}` : ''}
                      </span>
                    </span>
                  </span>
                )}
                {program.laterApprovals.map((t) => (
                  <span key={t} className="chart__marker chart__marker--later" style={{ left: `${place(t)}%` }} aria-hidden="true">
                    <span className="chart__diamond" />
                  </span>
                ))}
                {ap !== undefined && <span className="lane__approval lane__approval--head" style={{ left: `${ap}%` }} aria-hidden="true" />}
              </div>
            </div>
            {program.lanes.map((l) => {
              const s = place(l.start);
              const pc = place(l.primaryCompletion);
              const ro = place(l.readout);
              const when =
                l.start !== undefined && l.primaryCompletion !== undefined
                  ? aligned
                    ? `${offsetText(l.start - program.approval!)} to ${offsetText(l.primaryCompletion - program.approval!)}`
                    : `${formatDate({ value: new Date(l.start).toISOString().slice(0, 10), precision: 'month' })} to ${formatDate({ value: new Date(l.primaryCompletion).toISOString().slice(0, 10), precision: 'month' })}`
                  : '';
              return (
                <div key={l.trialId} className="lane">
                  <button
                    type="button"
                    className="lane__name"
                    title={`${l.name}: ${ROLE_LABEL[l.role]}. Open trial details`}
                    onClick={() => onTrial(program.key, l.trialId)}
                  >
                    {l.name}
                  </button>
                  <div className="lane__track">
                    {s !== undefined && pc !== undefined && (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        className={`lane__bar${l.role !== 'PIVOTAL' ? ' lane__bar--support' : ''}${l.afterApproval ? ' lane__bar--later' : ''}`}
                        style={{ left: `${s}%`, width: `${Math.max(pc - s, 0.5)}%` }}
                        title={`${l.name}: start to primary completion, ${when}`}
                        onClick={() => onTrial(program.key, l.trialId)}
                      />
                    )}
                    {ro !== undefined && l.readoutKey && hasReadouts && (
                      <button
                        type="button"
                        className="lane__readout"
                        style={{ left: `${ro}%` }}
                        aria-label={`${l.name}: results announced. Read the release summary`}
                        title="Results announced: select to read"
                        onClick={() => onReadout(`${program.key}|${l.readoutKey}`)}
                      />
                    )}
                    {ap !== undefined && <span className="lane__approval" style={{ left: `${ap}%` }} aria-hidden="true" />}
                    {program.laterApprovals.map((t) => (
                      <span key={t} className="lane__approval lane__approval--later" style={{ left: `${place(t)}%` }} aria-hidden="true" />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <ul className="compare__legend" aria-label="Legend">
        <li><span className="swatch swatch--bar" aria-hidden="true" />Pivotal trial, start to primary completion</li>
        {anyOther && <li><span className="swatch swatch--support" aria-hidden="true" />Supportive or other trial</li>}
        {anyLater && <li><span className="swatch swatch--later" aria-hidden="true" />Completed after the approval</li>}
        {anyReadout && <li><span className="swatch swatch--readout" aria-hidden="true" />Results announced</li>}
        <li><span className="swatch swatch--approval" aria-hidden="true" />{programs.some((p) => p.whole) ? 'First approval' : 'Approval'}</li>
        {anyLaterApproval && <li><span className="swatch swatch--approval swatch--later-approval" aria-hidden="true" />Label expansion</li>}
      </ul>
    </div>
  );
}

const kindLabel = (a: Pick<Approval, 'kind' | 'submission'>) => approvalKindLabel(a.kind, a.submission);

/** The FDA's own sentence, shortened until opened, with a light source link. */
function Wording({ text, href, title }: { text: string; href?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <blockquote className="pane__wording">
      “{open || !long ? text : `${text.slice(0, 157).trimEnd()}…`}”
      {long && (
        <button type="button" className="pane__wording-more" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
      {href && (
        <a className="source-link" href={href} target="_blank" rel="noreferrer" title={title}>
          (source ↗)
        </a>
      )}
    </blockquote>
  );
}

/** Each program's trials as result cards, the two programs side by side. */
function EvidenceCards({
  programs,
  rows,
  differ,
  onTrial,
}: {
  programs: ProgramView[];
  rows: EvidenceRow[];
  differ: boolean;
  onTrial: (program: string, trialId: string) => void;
}) {
  return (
    <section className="compare__section" aria-labelledby="evidence">
      <div className="compare__section-head">
        <h2 id="evidence">What the pivotal trials showed</h2>
        <Info label="About these results" align="left">
          Results as posted to ClinicalTrials.gov for each trial’s first primary outcome, every arm against the trial’s
          own control.
        </Info>
        {differ && <span className="compare__caution">Not a head-to-head comparison</span>}
      </div>
      <div className="evcols">
        {programs.map((p) => (
          <div key={p.key} className="evcol">
            <h3 className="evcol__drug">{p.drug.brandName}</h3>
            <ul className="evcol__list">
              {rows
                .filter((r) => r.program === p.key)
                .map((r) => (
                  <li key={r.trialId} className="evcard">
                    <div className="evcard__head">
                      <button type="button" className="evidence__trial" onClick={() => onTrial(r.program, r.trialId)}>
                        {r.trial}
                      </button>
                      <span className="evcard__meta mono">
                        {[r.nctId && r.trial !== r.nctId ? r.nctId : undefined, r.enrollment !== undefined ? `${r.enrollment.toLocaleString('en-US')} patients` : undefined]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {r.result ? (
                      <>
                        <ul className="arms">
                          {r.result.arms.map((a) => (
                            <li key={a.label} className={a.isComparator ? 'is-control' : undefined}>
                              <span className="arms__label" title={a.label}>{a.label}</span>
                              {a.percent !== undefined && (
                                <span className="arms__bar" aria-hidden="true">
                                  <span style={{ width: `${a.percent}%` }} />
                                </span>
                              )}
                              <span className="arms__value mono">{a.shown}</span>
                            </li>
                          ))}
                          {r.result.unitNote && <li className="arms__p">Unit: {r.result.unitNote}</li>}
                          {(r.result.effect || r.result.pValue) && (
                            <li className="arms__p">
                              {[r.result.effect, r.result.pValue && `p ${r.result.pValue}`].filter(Boolean).join(', ')}
                            </li>
                          )}
                        </ul>
                        <details className="evcard__endpoint">
                          <summary>Primary endpoint</summary>
                          <p>{r.result.endpoint}</p>
                        </details>
                      </>
                    ) : (
                      <p className="muted evcard__none">No results posted</p>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
