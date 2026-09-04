import { describe, it, expect } from 'vitest';
import { computeLayout } from '../src/components/Gantt/layout.js';
import type { Trial, Milestone } from '../src/schema/index.js';

function trial(o: Partial<Trial>): Trial {
  return {
    id: 't', title: 'x', phase: 'PHASE3', roles: [], arms: [],
    primaryEndpoints: [], secondaryEndpoints: [], metPrimaryEndpoint: null,
    takeaways: [], limitations: [], publications: [], provenance: {}, ...o,
  };
}

const approval: Milestone = {
  id: 'ap', type: 'FDA_APPROVAL', region: 'US', label: 'FDA approval',
  date: { value: '2019-08-16', precision: 'day' },
};

describe('computeLayout', () => {
  it('groups trials into phase lanes and drops empty ones', () => {
    const layout = computeLayout(
      [
        trial({ id: 'a', phase: 'PHASE1', startDate: { value: '2013-01-01', precision: 'month' } }),
        trial({ id: 'b', phase: 'PHASE3', startDate: { value: '2016-01-01', precision: 'month' } }),
      ],
      [],
      1000
    );
    expect(layout.groups.map((g) => g.phase)).toEqual(['PHASE1', 'PHASE3']);
  });

  it('sets trials without a start date aside instead of dropping them silently', () => {
    const layout = computeLayout(
      [trial({ id: 'dated', startDate: { value: '2016-01-01', precision: 'month' } }), trial({ id: 'undated' })],
      [],
      1000
    );
    expect(layout.undated.map((t) => t.id)).toEqual(['undated']);
    expect(layout.groups[0].bars).toHaveLength(1);
  });

  it('marks approval as a major milestone so it draws a full-height rule', () => {
    const layout = computeLayout([], [approval], 1000);
    expect(layout.milestones[0].isMajor).toBe(true);
  });

  it('flags coarse date precision so the bar edge can be softened', () => {
    const layout = computeLayout(
      [
        trial({
          startDate: { value: '2016-03-01', precision: 'month' },
          completionDate: { value: '2018-06-15', precision: 'day' },
        }),
      ],
      [],
      1000
    );
    const bar = layout.groups[0].bars[0];
    expect(bar.fuzzyStart).toBe(true);
    expect(bar.fuzzyEnd).toBe(false);
  });

  it('keeps every milestone label inside the plot area', () => {
    // A long label on the last milestone must not run off the right edge.
    const milestones: Milestone[] = [
      { ...approval, id: 'm1', date: { value: '2012-01-01', precision: 'year' }, label: 'IND opened' },
      { ...approval, id: 'm2', date: { value: '2023-12-01', precision: 'month' },
        label: 'Supplement approved — a very long indication name indeed' },
    ];
    const layout = computeLayout([], milestones, 900);
    for (const m of layout.milestones) {
      expect(m.labelX).toBeGreaterThanOrEqual(layout.plotLeft);
      expect(m.labelX).toBeLessThanOrEqual(layout.plotRight);
    }
    expect(layout.milestones[1].labelAnchor).toBe('end');
  });

  it('staggers milestone labels that would otherwise overlap', () => {
    const close: Milestone[] = ['2022-01-01', '2022-02-01', '2022-03-01'].map((v, i) => ({
      ...approval, id: `m${i}`, date: { value: v, precision: 'month' },
      label: 'Supplement approved — long indication name',
    }));
    const layout = computeLayout([], close, 1000);
    const rows = layout.milestones.map((m) => m.labelRow);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('snaps the axis to whole years', () => {
    const layout = computeLayout(
      [trial({ startDate: { value: '2016-05-01', precision: 'month' }, completionDate: { value: '2018-07-01', precision: 'month' } })],
      [],
      1000
    );
    expect(new Date(layout.domain[0]).getUTCFullYear()).toBe(2016);
    expect(new Date(layout.domain[0]).getUTCMonth()).toBe(0);
    expect(layout.yearTicks[0].year).toBe(2016);
  });

  it('enforces a minimum width per year so long programs stay readable', () => {
    // A 12-year program in a narrow viewport should overflow and scroll, not compress.
    const layout = computeLayout(
      [trial({ startDate: { value: '2012-01-01', precision: 'year' }, completionDate: { value: '2023-01-01', precision: 'year' } })],
      [],
      400
    );
    expect(layout.width).toBeGreaterThan(400);
  });

  it('renders an axis even with no data at all', () => {
    const layout = computeLayout([], [], 1000);
    expect(layout.yearTicks.length).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
