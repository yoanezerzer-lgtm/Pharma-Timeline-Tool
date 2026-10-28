import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Drug } from '../schema/index.js';
import { drugIndex, useDrug, type DrugState } from '../lib/catalog.js';
import {
  buildAxis,
  endpointsDiffer,
  evidenceCsv,
  evidenceRows,
  monthsBetween,
  parseProgramRef,
  programRefString,
  programView,
  readoutCards,
  type Axis,
  type AxisMode,
  type EvidenceRow,
  type ProgramRef,
  type ProgramView,
} from '../lib/compare.js';
import { formatDate } from '../lib/dates.js';
import { indicationLabel } from '../lib/drugs.js';
import { useConfirmations, type Confirmation } from '../lib/reference.js';
import { indicationHref, indicationTrialHref } from '../lib/router.js';
import { BackLink } from '../components/BackLink/BackLink.js';
import './ComparePage.css';

interface ProgramOption {
  ref: string;
  drug: string;
  inn: string;
  indication: string;
  year?: string;
  trials: number;
}

const OPTIONS: ProgramOption[] = drugIndex
  .flatMap((d) =>
    d.indications.map((i) => ({
      ref: programRefString({ slug: d.slug, indicationSlug: i.slug }),
      drug: d.brandName,
      inn: d.inn,
      indication: indicationLabel(i),
      year: i.approvalDate?.value.slice(0, 4),
      trials: i.trialCount,
    }))
  )
  .sort((a, b) => a.drug.localeCompare(b.drug) || a.indication.localeCompare(b.indication));

const DEFAULTS = ['upadacitinib:rheumatoid-arthritis', 'risankizumab:psoriatic-arthritis'];

function readParams(): URLSearchParams {
  const hash = window.location.hash;
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

function initialRefs(): [ProgramRef, ProgramRef] {
  const p = readParams();
  const pick = (key: string, fallback: string) =>
    parseProgramRef(p.get(key)) ?? parseProgramRef(OPTIONS.some((o) => o.ref === fallback) ? fallback : OPTIONS[0]?.ref ?? '')!;
  return [pick('a', DEFAULTS[0]), pick('b', DEFAULTS[1])];
}

export function ComparePage() {
  const [refs, setRefs] = useState<[ProgramRef, ProgramRef]>(initialRefs);
  const [axisMode, setAxisMode] = useState<AxisMode>(() => (readParams().get('axis') === 'aligned' ? 'aligned' : 'calendar'));
  const [pivotalOnly, setPivotalOnly] = useState<[boolean, boolean]>([true, true]);
  const [focusedReadout, setFocusedReadout] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ a: programRefString(refs[0]), b: programRefString(refs[1]) });
    if (axisMode === 'aligned') qs.set('axis', 'aligned');
    window.history.replaceState(null, '', `#/compare?${qs}`);
  }, [refs, axisMode]);

  const states: [DrugState, DrugState] = [useDrug(refs[0].slug), useDrug(refs[1].slug)];
  const confirmations = [useConfirmations(refs[0]?.slug), useConfirmations(refs[1]?.slug)];

  const programs = useMemo(
    () =>
      states.map((s, i) => {
        if (s.status !== 'ready') return undefined;
        const indication = s.drug.indications.find((x) => x.slug === refs[i].indicationSlug);
        return indication ? programView(s.drug, indication, pivotalOnly[i]) : undefined;
      }),
    [states[0], states[1], refs, pivotalOnly]
  );
  const ready = programs.filter((p): p is ProgramView => !!p);
  const axis = useMemo(() => buildAxis(ready, axisMode), [ready.map((p) => p.key + p.lanes.length).join(), axisMode]);
  const rows = useMemo(() => evidenceRows(ready), [ready]);
  const cards = useMemo(() => readoutCards(ready), [ready]);
  const notFound = ready.flatMap((p) => p.lanes.filter((l) => l.readout === undefined).map((l) => `${l.name} (${p.drug.brandName})`));

  const setRef = (i: 0 | 1, ref: string) => {
    const r = parseProgramRef(ref);
    if (!r) return;
    setRefs((prev) => (i === 0 ? [r, prev[1]] : [prev[0], r]));
  };

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

  return (
    <main className="compare">
      <BackLink href="#/" label="All drugs" />
      <div className="compare__head">
        <h1>Compare two programs</h1>
        <div className="compare__actions">
          <div className="compare__toggle" role="group" aria-label="Timeline axis">
            <button type="button" aria-pressed={axis.mode === 'calendar'} onClick={() => setAxisMode('calendar')}>
              Calendar dates
            </button>
            <button type="button" aria-pressed={axis.mode === 'aligned'} onClick={() => setAxisMode('aligned')}>
              Aligned at approval
            </button>
          </div>
          <button type="button" className="compare__button" onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="compare__legend">
        <span><span className="swatch swatch--bar" aria-hidden="true" />Trial, start to primary completion</span>
        <span><span className="swatch swatch--readout" aria-hidden="true" />Results announced (select to read)</span>
        <span><span className="swatch swatch--approval" aria-hidden="true" />FDA approval</span>
        {axis.autoAligned && <span role="status" className="compare__note">These programs are years apart, so both are shown aligned at approval.</span>}
      </div>

      <div className="compare__panes">
        {([0, 1] as const).map((i) => (
          <ProgramPane
            key={i}
            index={i}
            current={programRefString(refs[i])}
            state={states[i]}
            program={programs[i]}
            axis={axis}
            pivotalOnly={pivotalOnly[i]}
            onPivotalOnly={(v) => setPivotalOnly((prev) => (i === 0 ? [v, prev[1]] : [prev[0], v]))}
            onPick={(ref) => setRef(i, ref)}
            onReadout={showReadout}
          />
        ))}
      </div>

      {ready.length > 0 && (
        <EvidenceTable rows={rows} programs={ready} confirmations={confirmations} refs={refs} />
      )}

      {ready.length > 0 && (
        <section className="compare__section" aria-labelledby="readouts">
          <h2 id="readouts">Readouts: when results were first announced</h2>
          <div className="readouts">
            {cards.map((c) => (
              <article key={c.key} id={readoutAnchor(c.key)} className={`readout${focusedReadout === c.key ? ' is-focused' : ''}`}>
                <div className="readout__meta">
                  <span><strong>{c.trials.join(' and ')}</strong> · {c.drug}, {c.indication}</span>
                  <span className="mono">{formatDate(c.date)}</span>
                </div>
                {c.provenance.sourceLabel && <p className="readout__headline">{c.provenance.sourceLabel.replace(/^[^:]+:\s*/, '')}</p>}
                {c.provenance.quote && <blockquote className="readout__quote">“{c.provenance.quote}”</blockquote>}
                <div className="readout__stats">
                  <Stat label="Primary completion → announced" months={c.completionToAnnouncement} />
                  <Stat label="Announced → approval" months={c.announcementToApproval} />
                </div>
                <div className="readout__foot">
                  <span>{c.provenance.sourceLabel?.split(':')[0]}</span>
                  {c.provenance.sourceUrl && (
                    <a href={c.provenance.sourceUrl} target="_blank" rel="noreferrer">
                      Read the release ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
            {notFound.length > 0 && (
              <div className="readout readout--empty">
                <p className="readout__headline">Not found yet</p>
                <p>{notFound.join(', ')}</p>
                <p className="readout__fine">
                  The overnight search looks for each sponsor’s first release reporting the primary result. A release
                  covering several trials shows once, with all of them.
                </p>
              </div>
            )}
          </div>
        </section>
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

/** A small "i" button whose note opens on click, tap or keyboard, and closes on Escape or leaving it. */
function Info({ label, children, align = 'right' }: { label: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="info" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="info__button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        i
      </button>
      {open && (
        <span role="note" id={id} className={`info__note info__note--${align}`}>
          {children}
        </span>
      )}
    </span>
  );
}

function ProgramPicker({ index, current, onPick }: { index: number; current: string; onPick: (ref: string) => void }) {
  const currentOption = OPTIONS.find((o) => o.ref === current);
  const shown = currentOption ? `${currentOption.drug} · ${currentOption.indication}` : '';
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const needle = (query ?? '').trim().toLowerCase();
  const matches = OPTIONS.filter((o) => !needle || `${o.drug} ${o.inn} ${o.indication}`.toLowerCase().includes(needle)).slice(0, 12);

  const choose = (o: ProgramOption) => {
    onPick(o.ref);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && (setOpen(false), setQuery(null))}>
      <input
        role="combobox"
        aria-label={`Program ${index + 1}: search a drug or indication`}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={query ?? shown}
        placeholder="Drug or indication"
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
        <div className="picker__list" id={listId} role="listbox" aria-label="Programs">
          {matches.length === 0 && <p className="picker__empty">No program matches. Try a drug or indication name.</p>}
          {matches.map((o, k) => (
            <button
              type="button"
              tabIndex={-1}
              key={o.ref}
              id={`${listId}-${k}`}
              role="option"
              aria-selected={o.ref === current}
              className={k === active ? 'is-active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <span><strong>{o.drug}</strong> · {o.indication}</span>
              <span className="picker__meta">{o.year ?? 'undated'} · {o.trials} trials</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VISIBLE_LANES = 4;

function ProgramPane({
  index,
  current,
  state,
  program,
  axis,
  pivotalOnly,
  onPivotalOnly,
  onPick,
  onReadout,
}: {
  index: 0 | 1;
  current: string;
  state: DrugState;
  program?: ProgramView;
  axis: Axis;
  pivotalOnly: boolean;
  onPivotalOnly: (v: boolean) => void;
  onPick: (ref: string) => void;
  onReadout: (key: string) => void;
}) {
  // Only trials completed before the approval count toward it.
  const lastCompletion = program ? Math.max(...program.lanes.filter((l) => !l.afterApproval).map((l) => l.primaryCompletion ?? -Infinity)) : undefined;
  const later = program?.lanes.filter((l) => l.afterApproval).length ?? 0;
  const months = program && Number.isFinite(lastCompletion) && lastCompletion! <= (program.approval ?? -Infinity)
    ? monthsBetween(lastCompletion, program.approval)
    : undefined;
  const at = (t: number | undefined) => (t === undefined || !program ? undefined : axis.position(t, program.approval));
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <section className="pane" aria-label={program ? `${program.drug.brandName}, ${indicationLabel(program.indication)}` : `Program ${index + 1}`}>
      <div className="pane__controls">
        <ProgramPicker index={index} current={current} onPick={onPick} />
        <label className="pane__check">
          <input type="checkbox" checked={pivotalOnly} onChange={(e) => onPivotalOnly(e.target.checked)} />
          Pivotal only
        </label>
      </div>

      {state.status === 'loading' && <p className="pane__status">Loading…</p>}
      {(state.status === 'missing' || state.status === 'error' || (state.status === 'ready' && !program)) && (
        <p className="pane__status">This program couldn’t be loaded. Pick another above.</p>
      )}

      {program && (
        <>
          <div className="pane__head">
            <div>
              <p className="pane__title">
                <a href={indicationHref(program.drug.slug, program.indication.slug)}>{program.drug.brandName}</a>{' '}
                <span>· {indicationLabel(program.indication)}</span>
              </p>
              <p className="pane__sub">
                {program.indication.approvalDate ? `Approved ${formatDate(program.indication.approvalDate)}` : 'Approval date not established'} ·{' '}
                {program.lanes.length} {pivotalOnly ? 'pivotal' : 'supporting'} trial{program.lanes.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="pane__metric">
              <p className="pane__metric-value">{months === undefined ? '—' : <>{months} <span>mo</span></>}</p>
              <p className="pane__metric-label">
                Primary completion to approval
                <Info label="What this measures">
                  From the date the last patient was assessed for the primary endpoint in the final pivotal trial
                  (ClinicalTrials.gov) to the FDA approval of this indication.
                </Info>
              </p>
            </div>
          </div>

          {program.lanes.length === 0 ? (
            <p className="pane__status">No {pivotalOnly ? 'pivotal ' : ''}trials recorded for this indication.</p>
          ) : (
            <div className="chart">
              <div className="chart__axis" aria-hidden="true">
                {axis.ticks.map((t, k) => (
                  <span key={k} className={`chart__tick${t.major ? ' is-major' : ''}`} style={{ left: `${t.at}%` }}>
                    <span className="chart__tick-label">{t.label}</span>
                  </span>
                ))}
              </div>
              <div
                className="chart__lanes"
                ref={scrollRef}
                tabIndex={program.lanes.length > VISIBLE_LANES ? 0 : -1}
                aria-label={`${program.drug.brandName} trials`}
                style={{ maxHeight: `${VISIBLE_LANES * 44 + 2}px` }}
              >
                {program.lanes.map((l) => {
                  const s = at(l.start);
                  const pc = at(l.primaryCompletion);
                  const ap = at(program.approval);
                  const ro = at(l.readout);
                  return (
                    <div key={l.trialId} className="lane">
                      <a className="lane__name" href={indicationTrialHref(program.drug.slug, program.indication.slug, l.trialId)} title={l.name}>
                        {l.name}
                      </a>
                      <div className="lane__track">
                        {s !== undefined && pc !== undefined && (
                          <span
                            className={`lane__bar${l.afterApproval ? ' lane__bar--later' : ''}`}
                            style={{ left: `${s}%`, width: `${Math.max(pc - s, 0.5)}%` }}
                            title={l.afterApproval ? 'Completed after the first approval: supports a later label update' : undefined}
                          />
                        )}
                        {pc !== undefined && ap !== undefined && ap > pc && (
                          <span className="lane__gap" style={{ left: `${pc}%`, width: `${ap - pc}%` }} />
                        )}
                        {ro !== undefined && l.readoutKey && (
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
                      </div>
                    </div>
                  );
                })}
              </div>
              {(program.lanes.length > VISIBLE_LANES || later > 0) && (
                <p className="chart__more">
                  {program.lanes.length > VISIBLE_LANES && <>Scroll for all {program.lanes.length}. </>}
                  {later > 0 && (
                    <>
                      <span className="swatch swatch--later" aria-hidden="true" /> {later} completed after the first approval and
                      supported later label updates for this indication.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EvidenceTable({
  rows,
  programs,
  confirmations,
  refs,
}: {
  rows: EvidenceRow[];
  programs: ProgramView[];
  confirmations: Map<string, Confirmation>[];
  refs: ProgramRef[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const confirmationFor = (r: EvidenceRow): Confirmation | undefined => {
    const i = refs.findIndex((x) => programRefString(x) === r.program);
    const p = programs.find((x) => x.key === r.program);
    if (i < 0 || !p) return undefined;
    return confirmations[i].get(`${p.indication.name}|${r.nctId ?? r.trialId}`);
  };
  const drugOf = (r: EvidenceRow): Drug | undefined => programs.find((x) => x.key === r.program)?.drug;

  return (
    <section className="compare__section" aria-labelledby="evidence">
      <div className="compare__section-head">
        <h2 id="evidence">The pivotal evidence, side by side</h2>
        <Info label="About these results" align="left">
          Results as posted to ClinicalTrials.gov for each trial’s first primary outcome, every arm against the trial’s
          own control. ✓ Verified opens the FDA label sentence that names the trial for this indication.
        </Info>
        {endpointsDiffer(rows) && (
          <span className="compare__caution">Endpoints, timepoints or controls differ: not a head-to-head comparison</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="evidence">
          <thead>
            <tr>
              <th scope="col">Program</th>
              <th scope="col">Trial</th>
              <th scope="col" className="is-num">N</th>
              <th scope="col">Primary endpoint</th>
              <th scope="col">Result by arm</th>
              <th scope="col">Checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = confirmationFor(r);
              const key = `${r.program}|${r.trialId}`;
              const drug = drugOf(r);
              return (
                <tr key={key} className={r.firstOfProgram ? 'is-first' : undefined}>
                  <td>
                    {r.firstOfProgram && (
                      <>
                        <strong>{r.drug}</strong>
                        <div className="muted">{r.indication}</div>
                      </>
                    )}
                  </td>
                  <td>
                    <strong>{r.trial}</strong>
                    {r.nctId && <div className="muted mono">{r.nctId}</div>}
                  </td>
                  <td className="is-num mono">{r.enrollment?.toLocaleString('en-US') ?? '—'}</td>
                  <td className="evidence__endpoint" title={r.result?.endpoint}>
                    {r.result ? <span className="clamp">{r.result.endpoint}</span> : <span className="muted">No results posted</span>}
                  </td>
                  <td>
                    {r.result ? (
                      <ul className="arms">
                        {r.result.arms.map((a) => (
                          <li key={a.label} className={a.isComparator ? 'is-control' : undefined}>
                            <span className="arms__label">{a.label}</span>
                            {a.percent !== undefined && (
                              <span className="arms__bar" aria-hidden="true">
                                <span style={{ width: `${a.percent}%` }} />
                              </span>
                            )}
                            <span className="arms__value mono">{a.value}</span>
                          </li>
                        ))}
                        {r.result.pValue && <li className="arms__p">p {r.result.pValue}</li>}
                      </ul>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="evidence__check">
                    {c ? (
                      <>
                        <button type="button" className="verified" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                          ✓ Verified
                        </button>
                        {open === key && (
                          <div role="note" className="verified__note">
                            {c.evidence?.map((e) => (
                              <p key={e.sourceUrl + e.quote}>
                                “{e.quote}” <a href={e.sourceUrl} target="_blank" rel="noreferrer">source ↗</a>
                              </p>
                            ))}
                            <p className="muted">{drug?.brandName} label, checked against the document.</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="unchecked">Not yet checked</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
