/**
 * Event markers above a timeline axis (a diamond and a name at each first
 * US approval). Markers whose labels would overlap are merged into one
 * numbered circle, which lists its members on hover or click.
 */
export interface MarkerInput<T> {
  id: string;
  /** Position along the axis, in pixels from its left edge. */
  x: number;
  /** Width of the marker with its label, in pixels; the label is centred on x. */
  width: number;
  item: T;
}

export interface MarkerCluster<T> {
  /** Centre in pixels: the member's own position, or the mean of several. */
  x: number;
  width: number;
  members: MarkerInput<T>[];
}

/** Width of a merged marker: the numbered circle. */
export const CLUSTER_WIDTH = 22;

/** Rough label width for a short product name in 11px IBM Plex Sans, plus the diamond. */
export function labelWidth(text: string): number {
  return Math.ceil(text.length * 6.4) + 16;
}

/**
 * Merges markers that would overlap, left to right, until none do. Two
 * markers overlap when the gap between their boxes is under `gap` pixels.
 * A merged group is drawn as a circle at the mean position of its members,
 * so it can in turn overlap a neighbour; the loop runs until it doesn't.
 * Members stay in axis order.
 */
export function mergeMarkers<T>(markers: MarkerInput<T>[], gap = 6): MarkerCluster<T>[] {
  let clusters: MarkerCluster<T>[] = [...markers]
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
    .map((m) => ({ x: m.x, width: m.width, members: [m] }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i + 1 < clusters.length; i++) {
      const a = clusters[i];
      const b = clusters[i + 1];
      if (b.x - b.width / 2 - (a.x + a.width / 2) < gap) {
        const members = [...a.members, ...b.members];
        clusters = [
          ...clusters.slice(0, i),
          { x: members.reduce((s, m) => s + m.x, 0) / members.length, width: CLUSTER_WIDTH, members },
          ...clusters.slice(i + 2),
        ];
        merged = true;
        break;
      }
    }
  }
  return clusters;
}
