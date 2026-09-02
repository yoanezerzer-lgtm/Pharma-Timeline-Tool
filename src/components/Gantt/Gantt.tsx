import { useMemo, useRef, useState, useEffect } from 'react';
import type { Trial, Milestone } from '../../schema/index.js';
import { formatDate } from '../../lib/dates.js';
import {
  computeLayout,
  BAR_H,
  ROW_H,
  AXIS_H,
  TOP_PAD,
  type BarLayout,
} from './layout.js';
import './Gantt.css';

interface GanttProps {
  trials: Trial[];
  milestones: Milestone[];
  selectedTrialId: string | null;
  onSelectTrial: (id: string) => void;
}

interface HoverState {
  bar: BarLayout;
  clientX: number;
  clientY: number;
}

/** Short label for a bar: acronym if there is one, else protocol number or NCT. */
function barLabel(t: Trial): string {
  return t.acronym ?? t.protocolNumber ?? t.nctId ?? t.id;
}

export function Gantt({ trials, milestones, selectedTrialId, onSelectTrial }: GanttProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(1000);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Track the container width so the chart uses the space it has, while
  // layout() enforces a minimum px-per-year that triggers horizontal scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => computeLayout(trials, milestones, availableWidth),
    [trials, milestones, availableWidth]
  );

  return (
    <div className="gantt" ref={containerRef}>
      <div className="gantt__scroll">
        <svg
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label={`Development timeline: ${trials.length} trials and ${milestones.length} regulatory milestones`}
          className="gantt__svg"
        >
          {/* Year gridlines and axis labels */}
          <g className="gantt__axis">
            {layout.yearTicks.map((tick) => (
              <g key={tick.year}>
                <line
                  x1={tick.x}
                  y1={TOP_PAD + AXIS_H - 12}
                  x2={tick.x}
                  y2={layout.height - 8}
                  className="gantt__gridline"
                />
                <text x={tick.x} y={TOP_PAD + AXIS_H - 20} className="gantt__year">
                  {tick.year}
                </text>
              </g>
            ))}
          </g>

          {/* Approval rules span the full plot so you can read every bar against them */}
          {layout.milestones
            .filter((m) => m.isMajor)
            .map((m) => (
              <line
                key={`rule-${m.milestone.id}`}
                x1={m.x}
                y1={TOP_PAD + AXIS_H - 12}
                x2={m.x}
                y2={layout.regulatoryLaneY - 6}
                className="gantt__approval-rule"
              />
            ))}

          {/* Phase lanes */}
          {layout.groups.map((group) => (
            <g key={group.phase}>
              <text x={12} y={group.y + 18} className="gantt__group-label">
                {group.label}
              </text>
              <line
                x1={12}
                y1={group.y + 24}
                x2={layout.plotRight}
                y2={group.y + 24}
                className="gantt__group-rule"
              />
              {group.bars.map((bar) => {
                const selected = bar.trial.id === selectedTrialId;
                const cy = bar.y + (ROW_H - BAR_H) / 2;
                return (
                  <g
                    key={bar.trial.id}
                    className={`gantt__row${selected ? ' is-selected' : ''}`}
                    onClick={() => onSelectTrial(bar.trial.id)}
                    onMouseMove={(e) =>
                      setHover({ bar, clientX: e.clientX, clientY: e.clientY })
                    }
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => onSelectTrial(bar.trial.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${barLabel(bar.trial)}: ${bar.trial.title}`}
                  >
                    {/* Full-width hit area so hovering anywhere on the row works */}
                    <rect
                      x={0}
                      y={bar.y}
                      width={layout.plotRight}
                      height={ROW_H}
                      className="gantt__row-hit"
                    />
                    <text x={20} y={bar.y + ROW_H / 2 + 4} className="gantt__row-label">
                      {barLabel(bar.trial)}
                    </text>
                    <rect
                      x={bar.x}
                      y={cy}
                      width={bar.width}
                      height={BAR_H}
                      rx={3}
                      className={[
                        'gantt__bar',
                        `phase-${bar.trial.phase.toLowerCase()}`,
                        `role-${bar.trial.role.toLowerCase()}`,
                        bar.fuzzyStart ? 'fuzzy-start' : '',
                        bar.fuzzyEnd ? 'fuzzy-end' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    />
                    {bar.primaryCompletionX !== null && (
                      <line
                        x1={bar.primaryCompletionX}
                        y1={cy - 1}
                        x2={bar.primaryCompletionX}
                        y2={cy + BAR_H + 1}
                        className="gantt__primary-completion"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          ))}

          {/* Regulatory lane */}
          <g>
            <text x={12} y={layout.regulatoryLaneY - 6} className="gantt__group-label">
              Regulatory (US)
            </text>
            <line
              x1={12}
              y1={layout.regulatoryLaneY}
              x2={layout.plotRight}
              y2={layout.regulatoryLaneY}
              className="gantt__group-rule"
            />
            {layout.milestones.map((m) => {
              const y = layout.regulatoryLaneY;
              const labelY = y + 26 + m.labelRow * 16;
              return (
                <g key={m.milestone.id} className="gantt__milestone">
                  <title>
                    {m.milestone.label} — {formatDate(m.milestone.date)}
                  </title>
                  <path
                    d={`M ${m.x} ${y - 7} L ${m.x + 6} ${y} L ${m.x} ${y + 7} L ${m.x - 6} ${y} Z`}
                    className={`gantt__diamond${m.isMajor ? ' is-major' : ''}`}
                  />
                  <line
                    x1={m.x}
                    y1={y + 7}
                    x2={m.x}
                    y2={labelY - 8}
                    className="gantt__milestone-leader"
                  />
                  <text
                    x={m.labelX}
                    y={labelY}
                    textAnchor={m.labelAnchor}
                    className={`gantt__milestone-label${m.isMajor ? ' is-major' : ''}`}
                  >
                    {m.labelText}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {hover && <BarTooltip bar={hover.bar} x={hover.clientX} y={hover.clientY} />}

      {layout.undated.length > 0 && (
        <p className="gantt__undated">
          {layout.undated.length} trial{layout.undated.length === 1 ? '' : 's'} not shown —
          no start date recorded: {layout.undated.map(barLabel).join(', ')}
        </p>
      )}

      <GanttLegend />
    </div>
  );
}

function BarTooltip({ bar, x, y }: { bar: BarLayout; x: number; y: number }) {
  const t = bar.trial;
  return (
    <div className="gantt__tooltip" style={{ left: x + 14, top: y + 14 }} role="tooltip">
      <div className="gantt__tooltip-title">{barLabel(t)}</div>
      <div className="gantt__tooltip-sub">{t.title}</div>
      <dl className="gantt__tooltip-facts">
        <dt>Start</dt>
        <dd>{formatDate(t.startDate)}</dd>
        <dt>Primary completion</dt>
        <dd>{formatDate(t.primaryCompletionDate)}</dd>
        {t.enrollment && (
          <>
            <dt>Enrollment</dt>
            <dd>
              {t.enrollment.count.toLocaleString()}
              {t.enrollment.type === 'ESTIMATED' ? ' (est.)' : ''}
            </dd>
          </>
        )}
        <dt>Role</dt>
        <dd>{ROLE_LABEL[t.role]}</dd>
      </dl>
      <div className="gantt__tooltip-hint">Click for full detail</div>
    </div>
  );
}

export const ROLE_LABEL: Record<Trial['role'], string> = {
  PIVOTAL: 'Pivotal',
  SUPPORTIVE: 'Supportive',
  DOSE_FINDING: 'Dose-finding',
  PK: 'Pharmacokinetics',
  SAFETY: 'Safety',
  POST_MARKETING: 'Post-marketing',
  NOT_IN_FILING: 'Not in original filing',
  UNKNOWN: 'Unclassified',
};

function GanttLegend() {
  return (
    <div className="gantt__legend">
      <span className="gantt__legend-item">
        <span className="gantt__swatch role-pivotal" /> Pivotal
      </span>
      <span className="gantt__legend-item">
        <span className="gantt__swatch role-supportive" /> Supportive
      </span>
      <span className="gantt__legend-item">
        <span className="gantt__swatch role-not_in_filing" /> Not in original filing
      </span>
      <span className="gantt__legend-item">
        <span className="gantt__swatch-tick" /> Primary completion
      </span>
      <span className="gantt__legend-item">
        <span className="gantt__swatch-diamond" /> Regulatory milestone
      </span>
      <span className="gantt__legend-item gantt__legend-note">
        Faded bar ends mean the source gave only a month or year.
      </span>
    </div>
  );
}
