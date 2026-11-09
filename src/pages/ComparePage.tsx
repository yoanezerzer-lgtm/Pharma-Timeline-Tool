import { Info } from '../components/Info/Info.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Approval, Trial } from '../schema/index.js';
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
  WHOLE_USE,
  type Axis,
  type EvidenceRow,
  type ProgramRef,
  type ProgramView,
} from '../lib/compare.js';
import { formatDate } from '../lib/dates.js';
import { indicationLabel, ROLE_LABEL, shortIndication } from '../lib/drugs.js';
import { SEVERITY_LABEL, severityOfText, type Severity } from '../lib/diseases.js';
import { indicationHref, replaceQuery } from '../lib/router.js';
import { TrialDrawer } from '../components/TrialDetail/TrialDrawer.js';
import { approvalKindLabel } from '../lib/copy.js';
import './ComparePage.css';

interface ProgramOption {
  ref: string;
  drug: string;
  inn: string;
  /** The FDA's words, cut at a word for the picker; the full wording is the tooltip. */
  indication: string;
  full: string;
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
      severity: severityOfText([i.name]),
      year: i.approvalDate?.value.slice(0, 4),
      trials: i.trialCount,
    }))
  )
  .sort((a, b) => a.drug.localeCompare(b.drug) || a.indication.localeCompare(b.indication));

// Two moderate-to-severe atopic dermatitis approvals: the featured area, and a fair pair to set side by side.
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
  const axis = useMemo(() => buildAxis(ready), [ready.map((p) => p.key + p.lanes.length).join()]);
  const rows = useMemo(() => evidenceRows(ready), [ready]);
  const cards = useMemo(() => readoutCards(ready), [ready]);
  const severities = programs.map((p) => (p ? programSeverity(p) : undefined));
  const mismatch = clash(severities[0], severities[1]);
  const anySupport = ready.some((p) => p.lanes.some((l) => l.role !== 'PIVOTAL'));

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

  return (
    <main className={`compare${selectedTrial ? ' has-drawer' : ''}`}>
      <div className="compare__head">
        <h1>Compare two approvals</h1>
        <div className="compare__actions">
          <button type="button" className="compare__button" onClick={exportCsv} disabled={rows.length === 0}>
            Download CSV
          </button>
        </div>
      </div>

      <div className="compare__legend">
        <span><span className="swatch swatch--bar" aria-hidden="true" />Pivotal trial, start to primary completion</span>
        {anySupport && <span><span className="swatch swatch--support" aria-hidden="true" />Supportive trial</span>}
        {cards.length > 0 && <span><span className="swatch swatch--readout" aria-hidden="true" />Results announced</span>}
        <span><span className="swatch swatch--approval" aria-hidden="true" />FDA approval</span>
        {ready.some((p) => p.whole) && (
          <span><span className="swatch swatch--approval swatch--later-approval" aria-hidden="true" />Later approval of the same use</span>
        )}
      </div>

      {mismatch && (
        <p className="compare__severity" role="alert">
          {SEVERITY_LABEL[severities[0]!]} and {SEVERITY_LABEL[severities[1]!].toLowerCase()} approvals can’t be
          compared side by side. Pick an approval of the same severity.
        </p>
      )}

      <div className="compare__panes">
        {([0, 1] as const).map((i) => (
          <ProgramPane
            key={i}
            index={i}
            current={programRefString({ slug: refs[i].slug, indicationSlug: refs[i].indicationSlug })}
            state={states[i]}
            program={programs[i]}
            axis={axis}
            otherSeverity={severities[i === 0 ? 1 : 0]}
            onPick={(ref) => setRef(i, ref)}
            onPickApproval={(submission) => setApproval(i, submission)}
            onReadout={showReadout}
            onTrial={showTrial}
          />
        ))}
      </div>

      {rows.length > 0 && !mismatch && <EvidenceTable rows={rows} onTrial={showTrial} />}

      {rows.length > 0 && !mismatch && cards.length === 0 && (
        <p className="compare__note">No company announcement of these trials’ results found yet.</p>
      )}

      {rows.length > 0 && !mismatch && cards.length > 0 && (
        <section className="compare__section" aria-labelledby="readouts">
          <h2 id="readouts">Readouts: when results were first announced</h2>
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
        <TrialDrawer trial={selectedTrial} indication={openProgram.indication.name} onClose={() => setOpenTrial(null)} />
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
}: {
  index: number;
  current: string;
  otherSeverity?: Severity;
  onPick: (ref: string) => void;
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
              <span><strong>{o.drug}</strong> · {o.indication}</span>
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

const VISIBLE_LANES = 4;

function ProgramPane({
  index,
  current,
  state,
  program,
  axis,
  otherSeverity,
  onPick,
  onPickApproval,
  onReadout,
  onTrial,
}: {
  index: 0 | 1;
  current: string;
  state: DrugState;
  program?: ProgramView;
  axis: Axis;
  otherSeverity?: Severity;
  onPick: (ref: string) => void;
  onPickApproval: (submission: string) => void;
  onReadout: (key: string) => void;
  onTrial: (program: string, trialId: string) => void;
}) {
  const pivotal = program?.lanes.filter((l) => l.role === 'PIVOTAL') ?? [];
  const supporting = (program?.lanes.length ?? 0) - pivotal.length;
  // Only pivotal trials completed before the approval count toward it.
  const lastCompletion = Math.max(...pivotal.filter((l) => !l.afterApproval).map((l) => l.primaryCompletion ?? -Infinity));
  const later = program?.lanes.filter((l) => l.afterApproval).length ?? 0;
  const months = program && !program.whole && Number.isFinite(lastCompletion) && lastCompletion <= (program.approval ?? -Infinity)
    ? monthsBetween(lastCompletion, program.approval)
    : undefined;
  const at = (t: number | undefined) => (t === undefined ? undefined : axis.position(t));
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <section className="pane" aria-label={program ? `${program.drug.brandName}, ${indicationLabel(program.indication)}` : `Approval ${index + 1}`}>
      <div className="pane__controls">
        <ProgramPicker index={index} current={current} otherSeverity={otherSeverity} onPick={onPick} />
      </div>

      {state.status === 'loading' && <p className="pane__status">Loading…</p>}
      {(state.status === 'missing' || state.status === 'error' || (state.status === 'ready' && !program)) && (
        <p className="pane__status">Couldn’t load this approval. Pick another above.</p>
      )}

      {program && (
        <>
          <div className="pane__head">
            <div>
              <p className="pane__title" title={indicationLabel(program.indication)}>
                <a href={indicationHref(program.drug.slug, program.indication.slug)}>{program.drug.brandName}</a>{' '}
                <span>· {shortIndication(program.indication, 50)}</span>
              </p>
              <p className="pane__sub">
                {program.whole
                  ? `Approved in ${program.approvals.length} steps, first ${formatDate(program.approvals[0].date)}`
                  : program.chosen
                    ? `${kindLabel(program.chosen)} ${formatDate(program.chosen.date)}`
                    : program.indication.approvalDate
                      ? `Approved ${formatDate(program.indication.approvalDate)}`
                      : 'Approval date unclear'}{' '}
                · {pivotal.length} pivotal{supporting > 0 ? ` · ${supporting} supportive` : ''}
              </p>
            </div>
            {program.whole ? (
              <div className="pane__metric">
                <p className="pane__metric-label">
                  Trials not tied to one approval letter
                  <Info label="Why there is no month count">
                    This use was approved in steps and the records don’t say which letter each trial backs, so the time
                    from primary completion to approval is left blank. Every trial the label cites for the use is shown.
                  </Info>
                </p>
              </div>
            ) : (
              <div className="pane__metric">
                <p className="pane__metric-value">{months === undefined ? '—' : <>{months} <span>mo</span></>}</p>
                <p className="pane__metric-label">
                  Primary completion to approval
                  <Info label="What this measures">
                    From the date the last patient was assessed for the primary endpoint in the final pivotal trial
                    (ClinicalTrials.gov) to this FDA approval.
                  </Info>
                </p>
              </div>
            )}
          </div>

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
          {program.whole && (
            <Wording
              text={program.indication.wording?.text ?? program.indication.name}
              href={program.indication.wording?.provenance.sourceUrl}
              title="FDA label"
            />
          )}

          {program.lanes.length === 0 ? (
            <p className="pane__status">
              Not yet matched to a trial.
            </p>
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
                            title={l.afterApproval ? 'Completed after this approval' : `${l.name}: open trial details`}
                            onClick={() => onTrial(program.key, l.trialId)}
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
                        {program.laterApprovals.map((t) => (
                          <span key={t} className="lane__approval lane__approval--later" style={{ left: `${axis.position(t)}%` }} aria-hidden="true" />
                        ))}
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
                      <span className="swatch swatch--later" aria-hidden="true" /> {later} completed after
                      {program.whole ? ' the first approval.' : ' this approval.'}
                    </>
                  )}
                </p>
              )}
            </div>
          )}
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

function EvidenceTable({ rows, onTrial }: { rows: EvidenceRow[]; onTrial: (program: string, trialId: string) => void }) {
  return (
    <section className="compare__section" aria-labelledby="evidence">
      <div className="compare__section-head">
        <h2 id="evidence">Pivotal evidence</h2>
        <Info label="About these results" align="left">
          Results as posted to ClinicalTrials.gov for each trial’s first primary outcome, every arm against the trial’s
          own control.
        </Info>
        {endpointsDiffer(rows) && (
          <span className="compare__caution">Endpoints, timepoints or controls differ: not a head-to-head comparison</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="evidence">
          <thead>
            <tr>
              <th scope="col">Drug</th>
              <th scope="col">Trial</th>
              <th scope="col" className="is-num">N</th>
              <th scope="col">Primary endpoint</th>
              <th scope="col">Result by arm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.program}|${r.trialId}`} className={r.firstOfProgram ? 'is-first' : undefined}>
                <td>{r.firstOfProgram && <strong>{r.drug}</strong>}</td>
                <td>
                  <button type="button" className="evidence__trial" onClick={() => onTrial(r.program, r.trialId)}>
                    {r.trial}
                  </button>
                  {r.nctId && r.trial !== r.nctId && (
                    <a className="muted mono evidence__nct" href={`https://clinicaltrials.gov/study/${r.nctId}`} target="_blank" rel="noreferrer">
                      {r.nctId} ↗
                    </a>
                  )}
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
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
