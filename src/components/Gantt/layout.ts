import type { Trial, Milestone, Phase } from '../../schema/index.js';
import { toTime, toEndTime } from '../../lib/dates.js';

export const GUTTER_W = 236;
export const ROW_H = 28;
export const BAR_H = 14;
export const GROUP_H = 30;
export const AXIS_H = 40;
export const TOP_PAD = 8;
export const BOTTOM_PAD = 16;
export const RIGHT_PAD = 28;
/** Minimum horizontal pixels per year, so short programs stay readable. */
export const MIN_PX_PER_YEAR = 64;

/** Display order and labels for the phase lanes. */
export const PHASE_ORDER: Phase[] = [
  'EARLY_PHASE1',
  'PHASE1',
  'PHASE1_2',
  'PHASE2',
  'PHASE2_3',
  'PHASE3',
  'PHASE4',
  'NA',
];

export const PHASE_LABEL: Record<Phase, string> = {
  EARLY_PHASE1: 'Early Phase 1',
  PHASE1: 'Phase 1',
  PHASE1_2: 'Phase 1/2',
  PHASE2: 'Phase 2',
  PHASE2_3: 'Phase 2/3',
  PHASE3: 'Phase 3',
  PHASE4: 'Phase 4',
  NA: 'Phase not applicable',
};

export interface BarLayout {
  trial: Trial;
  y: number;
  x: number;
  width: number;
  /** Where primary completion falls inside the bar, if known and in range. */
  primaryCompletionX: number | null;
  /** Coarser-than-day dates get a softened edge rather than a hard one. */
  fuzzyStart: boolean;
  fuzzyEnd: boolean;
}

export interface GroupLayout {
  phase: Phase;
  label: string;
  y: number;
  bars: BarLayout[];
}

export interface MilestoneLayout {
  milestone: Milestone;
  x: number;
  y: number;
  /** Approvals draw a full-height rule across the plot. */
  isMajor: boolean;
  /** Vertical offset step used to stagger labels that would otherwise collide. */
  labelRow: number;
  /** Text drawn on the chart, and how to anchor it so it stays inside the plot. */
  labelText: string;
  labelAnchor: 'start' | 'middle' | 'end';
  labelX: number;
}

export interface GanttLayout {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  domain: [number, number];
  groups: GroupLayout[];
  milestones: MilestoneLayout[];
  regulatoryLaneY: number;
  yearTicks: { year: number; x: number }[];
  /** Trials with no usable dates; listed outside the chart rather than dropped. */
  undated: Trial[];
  scale: (t: number) => number;
}

/** A trial can be drawn only if it has a start date. */
function trialSpan(t: Trial): { start: number; end: number } | null {
  if (!t.startDate) return null;
  const start = toTime(t.startDate);
  const endSource = t.completionDate ?? t.primaryCompletionDate;
  // A trial with a start but no end still deserves a visible bar; give it a
  // nominal span so it renders as a marker rather than vanishing.
  const end = endSource ? toEndTime(endSource) : start + 30 * 24 * 3600 * 1000;
  return { start, end: Math.max(end, start) };
}

export function computeLayout(
  trials: Trial[],
  milestones: Milestone[],
  availableWidth: number
): GanttLayout {
  const dated = trials.filter((t) => trialSpan(t) !== null);
  const undated = trials.filter((t) => trialSpan(t) === null);

  const times: number[] = [];
  for (const t of dated) {
    const s = trialSpan(t)!;
    times.push(s.start, s.end);
  }
  for (const m of milestones) times.push(toTime(m.date));

  // Fall back to a one-year window so an empty dataset still renders an axis.
  const now = Date.now();
  let min = times.length ? Math.min(...times) : now;
  let max = times.length ? Math.max(...times) : now + 365 * 24 * 3600 * 1000;

  // Snap outward to whole years so the axis starts and ends on a tick.
  const minYear = new Date(min).getUTCFullYear();
  const maxYear = new Date(max).getUTCFullYear();
  min = Date.UTC(minYear, 0, 1);
  max = Date.UTC(maxYear + 1, 0, 1);

  const yearSpan = maxYear + 1 - minYear;
  const plotLeft = GUTTER_W;
  const naturalPlotWidth = Math.max(
    availableWidth - GUTTER_W - RIGHT_PAD,
    yearSpan * MIN_PX_PER_YEAR
  );
  const plotRight = plotLeft + naturalPlotWidth;
  const width = plotRight + RIGHT_PAD;

  const scale = (t: number): number =>
    plotLeft + ((t - min) / (max - min)) * (plotRight - plotLeft);

  const yearTicks: { year: number; x: number }[] = [];
  for (let y = minYear; y <= maxYear + 1; y++) {
    yearTicks.push({ year: y, x: scale(Date.UTC(y, 0, 1)) });
  }

  // Group trials by phase, preserving PHASE_ORDER and dropping empty lanes.
  const groups: GroupLayout[] = [];
  let cursorY = TOP_PAD + AXIS_H;

  for (const phase of PHASE_ORDER) {
    const inPhase = dated.filter((t) => t.phase === phase);
    if (inPhase.length === 0) continue;

    // Longest-running first reads better than registry order.
    inPhase.sort((a, b) => trialSpan(a)!.start - trialSpan(b)!.start);

    const group: GroupLayout = { phase, label: PHASE_LABEL[phase], y: cursorY, bars: [] };
    cursorY += GROUP_H;

    for (const t of inPhase) {
      const span = trialSpan(t)!;
      const x = scale(span.start);
      const barWidth = Math.max(scale(span.end) - x, 3);
      let pcX: number | null = null;
      if (t.primaryCompletionDate) {
        const px = scale(toTime(t.primaryCompletionDate));
        if (px > x && px < x + barWidth) pcX = px;
      }
      group.bars.push({
        trial: t,
        y: cursorY,
        x,
        width: barWidth,
        primaryCompletionX: pcX,
        fuzzyStart: t.startDate!.precision !== 'day',
        fuzzyEnd: (t.completionDate ?? t.primaryCompletionDate)?.precision !== 'day',
      });
      cursorY += ROW_H;
    }
    groups.push(group);
  }

  // Regulatory lane sits below every phase lane.
  const regulatoryLaneY = cursorY + GROUP_H;

  const sortedMs = [...milestones].sort((a, b) => toTime(a.date) - toTime(b.date));
  const msLayout: MilestoneLayout[] = [];
  // Rough advance width for the 10.5px label font. Estimating from character
  // count is imprecise but avoids needing to measure text in the DOM, and it
  // only has to be good enough to decide which labels would collide.
  const CHAR_W = 5.5;
  const LABEL_PAD = 10;
  // Right edge of the text already placed on each stagger row.
  const rowRightEdge: number[] = [];

  for (const m of sortedMs) {
    const x = scale(toTime(m.date));
    const labelText = m.shortLabel ?? m.label;
    const halfWidth = (labelText.length * CHAR_W) / 2;

    // Keep the text inside the plot: near an edge, anchor to it instead of
    // centring, so a long label at the far right does not run off the chart.
    let labelAnchor: 'start' | 'middle' | 'end' = 'middle';
    let labelX = x;
    let left = x - halfWidth;
    let right = x + halfWidth;
    if (left < plotLeft) {
      labelAnchor = 'start';
      labelX = Math.max(x, plotLeft);
      left = labelX;
      right = labelX + halfWidth * 2;
    } else if (right > plotRight) {
      labelAnchor = 'end';
      labelX = Math.min(x, plotRight);
      right = labelX;
      left = labelX - halfWidth * 2;
    }

    // Drop to the next stagger row until the text clears whatever is already there.
    let labelRow = 0;
    while (rowRightEdge[labelRow] !== undefined && left < rowRightEdge[labelRow] + LABEL_PAD) {
      labelRow++;
    }
    rowRightEdge[labelRow] = right;

    msLayout.push({
      milestone: m,
      x,
      y: regulatoryLaneY,
      isMajor: m.type === 'FDA_APPROVAL' || m.type === 'EC_DECISION',
      labelRow,
      labelText,
      labelAnchor,
      labelX,
    });
  }

  const maxLabelRow = msLayout.reduce((acc, m) => Math.max(acc, m.labelRow), 0);
  const height = regulatoryLaneY + 24 + (maxLabelRow + 1) * 16 + BOTTOM_PAD;

  return {
    width,
    height,
    plotLeft,
    plotRight,
    domain: [min, max],
    groups,
    milestones: msLayout,
    regulatoryLaneY,
    yearTicks,
    undated,
    scale,
  };
}
