import type { Approval, DateValue, Drug, Indication, PostedOutcome, Provenance, Trial, TrialRole } from '../schema/index.js';
import { toTime } from './dates.js';
import { roleFor, trialShortName, trialsForIndication } from './drugs.js';

/**
 * The comparison page's logic: what each program shows, the shared calendar
 * axis and the evidence table. Pure, so it's tested without a browser.
 */

export interface ProgramRef {
  slug: string;
  indicationSlug: string;
  /** One FDA approval within the indication ("SUPPL-40"); the indication's first when absent. */
  submission?: string;
}

/** "pembrolizumab:melanoma@SUPPL-40", as kept in the page's URL. */
export function parseProgramRef(s: string | null): ProgramRef | undefined {
  const m = s?.match(/^([a-z0-9-]+):([a-z0-9-]+)(?:@([A-Z]+-\d+))?$/);
  return m ? { slug: m[1], indicationSlug: m[2], ...(m[3] ? { submission: m[3] } : {}) } : undefined;
}

export function programRefString(r: ProgramRef): string {
  return `${r.slug}:${r.indicationSlug}${r.submission ? `@${r.submission}` : ''}`;
}

export interface Lane {
  trialId: string;
  name: string;
  /** Its part in this indication's approval: pivotal, supportive and so on. */
  role: TrialRole;
  start?: number;
  primaryCompletion?: number;
  readout?: number;
  readoutKey?: string;
  /**
   * Primary completion after the indication's (first) approval: the trial
   * supported a later label update for this indication, such as Keytruda's
   * adjuvant melanoma trials years after the 2014 approval.
   */
  afterApproval: boolean;
}

export interface UnmatchedTrial {
  trialId: string;
  name: string;
  role: TrialRole;
}

export interface ProgramView {
  key: string;
  drug: Drug;
  indication: Indication;
  /** Every FDA approval of this indication, oldest first; empty for records ingested before approvals were read. */
  approvals: Approval[];
  /** The approval this view is about. */
  chosen?: Approval;
  approval?: number;
  lanes: Lane[];
  /** Trials the label cites for the indication that aren't matched to any approval yet. */
  unmatched: UnmatchedTrial[];
}

/**
 * One approval and the trials that supported it: those linked to it from
 * its approval letter, and, when the indication has had only that one
 * approval, its supporting trials too. Pivotal ones first, then the rest,
 * each by start date. Records without an approval history show every
 * cited trial against the indication's first approval.
 */
export function programView(drug: Drug, indication: Indication, submission?: string): ProgramView {
  const t = (d?: DateValue) => (d ? toTime(d) : undefined);
  const approvals = indication.approvals ?? [];
  const chosen = approvals.find((a) => a.submission === submission) ?? approvals[0];
  const approval = t(chosen?.date ?? indication.approvalDate);
  const cited = trialsForIndication(drug, indication.name);
  const linkedTo = (tr: Trial) => tr.roles.find((r) => r.indication === indication.name && r.approval)?.approval?.submission;
  const belongs = (tr: Trial) =>
    !chosen || linkedTo(tr) === chosen.submission || (approvals.length === 1 && roleFor(tr, indication.name) !== 'PIVOTAL');
  const lanes = cited
    .filter(belongs)
    .map((tr) => ({
      trialId: tr.id,
      name: trialShortName(tr),
      role: roleFor(tr, indication.name) ?? ('UNKNOWN' as const),
      start: t(tr.startDate),
      primaryCompletion: t(tr.primaryCompletionDate),
      readout: t(tr.readoutDate),
      readoutKey: tr.provenance.readoutDate?.sourceUrl,
      afterApproval: approval !== undefined && tr.primaryCompletionDate !== undefined && t(tr.primaryCompletionDate)! > approval,
    }))
    .sort((a, b) => Number(b.role === 'PIVOTAL') - Number(a.role === 'PIVOTAL') || (a.start ?? Infinity) - (b.start ?? Infinity));
  const unmatched = cited
    .filter((tr) => !belongs(tr) && !linkedTo(tr))
    .map((tr) => ({ trialId: tr.id, name: trialShortName(tr), role: roleFor(tr, indication.name) ?? ('UNKNOWN' as const) }));
  const key = programRefString({ slug: drug.slug, indicationSlug: indication.slug, submission: chosen?.submission });
  return { key, drug, indication, approvals, chosen, approval, lanes, unmatched };
}

const DAY = 86400000;
const MONTH = 30.4375 * DAY;
const QUARTER = 3 * MONTH;

/** First trial start to approval: the stretch the program's chart covers. */
function programSpan(p: ProgramView): [number, number] | undefined {
  const times = p.lanes.flatMap((l) => [l.start, l.primaryCompletion]).filter((x): x is number => x !== undefined);
  if (p.approval !== undefined) times.push(p.approval);
  return times.length > 0 ? [Math.min(...times), Math.max(...times)] : undefined;
}

export interface Tick {
  /** 0–100, across the chart. */
  at: number;
  label: string;
  major: boolean;
}

export interface Axis {
  /** Position (0–100) of a time on the charts. */
  position: (time: number) => number;
  ticks: Tick[];
}

/** One real-date axis for both charts: years labelled, quarters marked while they fit. */
export function buildAxis(programs: ProgramView[]): Axis {
  const known = programs.map(programSpan).filter((s): s is [number, number] => !!s);
  const from = known.length ? Math.min(...known.map((s) => s[0])) - QUARTER : Date.UTC(2000, 0, 1);
  const to = known.length ? Math.max(...known.map((s) => s[1])) + QUARTER : Date.UTC(2001, 0, 1);
  const pos = (t: number) => ((t - from) / (to - from)) * 100;
  const years = (to - from) / (12 * MONTH);
  // Label every year while there's room, then every second or fifth.
  const labelEvery = years > 24 ? 5 : years > 12 ? 2 : 1;
  const ticks: Tick[] = [];
  for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) {
    for (let q = 0; q < 4; q++) {
      const t = Date.UTC(y, q * 3, 1);
      if (t < from || t > to) continue;
      if (q > 0 && years > 10) continue;
      const major = q === 0 && y % labelEvery === 0;
      ticks.push({ at: pos(t), label: major ? String(y) : '', major });
    }
  }
  return { position: pos, ticks };
}

/** Whole months from one time to another, or undefined when either is missing. */
export function monthsBetween(from: number | undefined, to: number | undefined): number | undefined {
  return from === undefined || to === undefined ? undefined : Math.round((to - from) / MONTH);
}

const CONTROL = /\b(placebo|control|vehicle|sham|standard of care|best supportive care)\b/i;

export interface Arm {
  label: string;
  value: string;
  /** 0–100 when the measure is a percentage of patients, for a bar. */
  percent?: number;
  /** Not the drug's own arm: placebo, standard care or an active comparator. */
  isComparator: boolean;
}

export interface ResultSummary {
  endpoint: string;
  unit: string;
  arms: Arm[];
  pValue?: string;
}

function unitSuffix(unit: string | undefined): string {
  if (!unit) return '';
  if (/percent|%/i.test(unit) && !/change/i.test(unit)) return '%';
  if (/^months?$/i.test(unit)) return ' mo';
  return ` ${unit}`;
}

/**
 * The first posted primary outcome, arm by arm, exactly as the sponsor posted
 * it: the drug's own arms first (named by `drugNames`), then active
 * comparators, then placebo or control. Values stay as posted strings.
 */
export function resultSummary(trial: Trial, drugNames: string[] = []): ResultSummary | undefined {
  const o: PostedOutcome | undefined = trial.postedResults?.[0];
  if (!o || o.groups.length === 0) return undefined;
  const suffix = unitSuffix(o.unitOfMeasure);
  const isPercent = suffix === '%';
  const names = drugNames.map((d) => d.toLowerCase()).filter((d) => d.length >= 3);
  const arms = o.groups.flatMap((g) => {
    // A broken-down outcome lists one row per category; take the first.
    const m = o.measurements.find((x) => x.groupId === g.id);
    if (!m) return [];
    const n = Number(m.value);
    // "NA" (not estimable, e.g. a median not reached) is shown as posted, without a unit.
    const numeric = m.value.trim() !== '' && Number.isFinite(n);
    const own = names.some((d) => g.title.toLowerCase().includes(d));
    const rank = own ? 0 : CONTROL.test(g.title) ? 2 : names.length > 0 ? 1 : 0;
    return [{
      label: g.title,
      value: numeric ? `${m.value}${suffix}` : m.value,
      percent: isPercent && numeric && n >= 0 && n <= 100 ? n : undefined,
      isComparator: rank > 0,
      rank,
    }];
  });
  arms.sort((a, b) => a.rank - b.rank);
  return { endpoint: o.title, unit: o.unitOfMeasure ?? '', arms: arms.map(({ rank: _rank, ...a }) => a), pValue: o.analyses[0]?.pValue };
}

export interface EvidenceRow {
  program: string;
  drug: string;
  indication: string;
  trialId: string;
  trial: string;
  nctId?: string;
  enrollment?: number;
  result?: ResultSummary;
  firstOfProgram: boolean;
}

export function evidenceRows(programs: ProgramView[]): EvidenceRow[] {
  return programs.flatMap((p) =>
    p.lanes.map((l, i) => {
      const t = p.drug.trials.find((x) => x.id === l.trialId)!;
      return {
        program: p.key,
        drug: p.drug.brandName,
        indication: p.indication.displayName || p.indication.name,
        trialId: t.id,
        trial: l.name,
        nctId: t.nctId,
        enrollment: t.enrollment?.count,
        result: resultSummary(t, [p.drug.inn, p.drug.brandName]),
        firstOfProgram: i === 0,
      };
    })
  );
}

/** Whether the rows measure different things, so a side-by-side reading would mislead. */
export function endpointsDiffer(rows: EvidenceRow[]): boolean {
  const kinds = new Set(rows.flatMap((r) => (r.result ? [r.result.endpoint.trim().toLowerCase()] : [])));
  return kinds.size > 1;
}

export interface ReadoutCard {
  key: string;
  drug: string;
  indication: string;
  trials: string[];
  date: DateValue;
  provenance: Provenance;
  /** Last primary completion among these trials to the announcement. */
  completionToAnnouncement?: number;
  announcementToApproval?: number;
}

/** One card per release: a release that reported two trials shows once, naming both. */
export function readoutCards(programs: ProgramView[]): ReadoutCard[] {
  const cards = new Map<string, ReadoutCard & { lastCompletion?: number; approval?: number }>();
  for (const p of programs) {
    for (const l of p.lanes) {
      const t = p.drug.trials.find((x) => x.id === l.trialId)!;
      const prov = t.provenance.readoutDate;
      if (!t.readoutDate || !prov?.sourceUrl) continue;
      const key = `${p.key}|${prov.sourceUrl}`;
      const card = cards.get(key) ?? {
        key,
        drug: p.drug.brandName,
        indication: p.indication.displayName || p.indication.name,
        trials: [],
        date: t.readoutDate,
        provenance: prov,
        approval: p.approval,
      };
      card.trials.push(l.name);
      if (l.primaryCompletion !== undefined) card.lastCompletion = Math.max(card.lastCompletion ?? -Infinity, l.primaryCompletion);
      cards.set(key, card);
    }
  }
  return [...cards.values()]
    .map(({ lastCompletion, approval, ...c }) => ({
      ...c,
      completionToAnnouncement: monthsBetween(lastCompletion, toTime(c.date)),
      announcementToApproval: monthsBetween(toTime(c.date), approval),
    }))
    .sort((a, b) => a.date.value.localeCompare(b.date.value));
}

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The evidence table as CSV, each row with its source links, for a client file. */
export function evidenceCsv(rows: EvidenceRow[], programs: ProgramView[]): string {
  const header = ['Drug', 'Indication', 'Approval date', 'Approval (FDA wording)', 'Trial', 'NCT number', 'Enrollment', 'Primary endpoint', 'Results by arm', 'p-value', 'Results announced', 'Announcement source', 'Registry record'];
  const lines = rows.map((r) => {
    const p = programs.find((x) => x.key === r.program)!;
    const t = p.drug.trials.find((x) => x.id === r.trialId)!;
    return [
      r.drug,
      r.indication,
      (p.chosen?.date ?? p.indication.approvalDate)?.value,
      p.chosen?.statement,
      r.trial,
      r.nctId,
      r.enrollment,
      r.result?.endpoint,
      r.result?.arms.map((a) => `${a.label}: ${a.value}`).join('; '),
      r.result?.pValue,
      t.readoutDate?.value,
      t.provenance.readoutDate?.sourceUrl,
      r.nctId ? `https://clinicaltrials.gov/study/${r.nctId}` : undefined,
    ].map(csvCell).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}
