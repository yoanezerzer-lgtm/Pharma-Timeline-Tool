import { describe, expect, it } from 'vitest';
import { CLUSTER_WIDTH, labelWidth, mergeMarkers, type MarkerInput } from '../src/lib/markers.js';

const m = (id: string, x: number, width = 60): MarkerInput<string> => ({ id, x, width, item: id });
const ids = (c: { members: { id: string }[] }[]) => c.map((k) => k.members.map((x) => x.id));

describe('mergeMarkers', () => {
  it('keeps markers apart when their labels fit', () => {
    const out = mergeMarkers([m('a', 0), m('b', 100), m('c', 200)]);
    expect(ids(out)).toEqual([['a'], ['b'], ['c']]);
    expect(out.map((c) => c.x)).toEqual([0, 100, 200]);
  });

  it('merges two overlapping labels into one circle at their mean', () => {
    const out = mergeMarkers([m('a', 100), m('b', 130)]);
    expect(ids(out)).toEqual([['a', 'b']]);
    expect(out[0].x).toBe(115);
    expect(out[0].width).toBe(CLUSTER_WIDTH);
  });

  it('respects the gap: boxes 5px apart merge at gap 6, not at gap 4', () => {
    // a ends at 30, b starts at 35.
    expect(mergeMarkers([m('a', 0), m('b', 65)], 6)).toHaveLength(1);
    expect(mergeMarkers([m('a', 0), m('b', 65)], 4)).toHaveLength(2);
  });

  it('sorts by position and keeps members in axis order', () => {
    const out = mergeMarkers([m('late', 120), m('early', 100)]);
    expect(ids(out)).toEqual([['early', 'late']]);
  });

  it('merges again when a new circle overlaps its neighbour (chain)', () => {
    // a (-2..2) and b (6..10) are 4px apart and merge into a circle at 4 (-7..15).
    // c (20..24) was 10px from b, but is only 5px from the circle, so it joins.
    const out = mergeMarkers([m('a', 0, 4), m('b', 8, 4), m('c', 22, 4)]);
    expect(ids(out)).toEqual([['a', 'b', 'c']]);
    expect(ids(mergeMarkers([m('b', 8, 4), m('c', 22, 4)]))).toEqual([['b'], ['c']]);
  });

  it('leaves a far neighbour of a circle alone', () => {
    const out = mergeMarkers([m('a', 100), m('b', 120), m('c', 300)]);
    expect(ids(out)).toEqual([['a', 'b'], ['c']]);
  });

  it('handles same-day events and an empty list', () => {
    expect(ids(mergeMarkers([m('x', 50), m('y', 50)]))).toEqual([['x', 'y']]);
    expect(mergeMarkers([])).toEqual([]);
  });

  it('a lone marker keeps its own width', () => {
    expect(mergeMarkers([m('a', 10, 80)])[0].width).toBe(80);
  });
});

describe('labels', () => {
  it('estimates wider labels for longer names', () => {
    expect(labelWidth('Ebglyss')).toBeGreaterThan(labelWidth('Adbry'));
  });
});
