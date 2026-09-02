import type { DateValue, DatePrecision } from '../schema/index.js';

/**
 * Normalizes a partial date string into a DateValue, recording how precise the
 * source actually was.
 *
 * ClinicalTrials.gov reports dates as "2016", "2016-03", or "2016-03-15"
 * depending on what the sponsor submitted. Padding to a full ISO date keeps
 * storage uniform; keeping `precision` alongside it stops the chart from
 * drawing a hard edge on a date nobody actually claimed.
 */
export function toDateValue(input: string | null | undefined): DateValue | undefined {
  if (!input) return undefined;
  const s = input.trim();

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) return { value: s, precision: 'day' };

  const month = /^(\d{4})-(\d{2})$/.exec(s);
  if (month) return { value: `${s}-01`, precision: 'month' };

  const year = /^(\d{4})$/.exec(s);
  if (year) return { value: `${s}-01-01`, precision: 'year' };

  return undefined;
}

/** Milliseconds since epoch, for positioning on the chart's time scale. */
export function toTime(d: DateValue): number {
  return Date.parse(`${d.value}T00:00:00Z`);
}

/**
 * The end of the period a DateValue covers.
 *
 * A year-precision date means "somewhere in 2016", so a bar ending there should
 * extend to the end of 2016 rather than stopping on January 1st.
 */
export function toEndTime(d: DateValue): number {
  const [y, m] = d.value.split('-').map(Number);
  switch (d.precision) {
    case 'year':
      return Date.UTC(y + 1, 0, 1);
    case 'month':
      return Date.UTC(y, m, 1);
    case 'day':
      return toTime(d) + 24 * 60 * 60 * 1000;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Renders a date at the precision actually known — never more. */
export function formatDate(d: DateValue | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.value.split('-').map(Number);
  switch (d.precision) {
    case 'year':
      return String(y);
    case 'month':
      return `${MONTHS[m - 1]} ${y}`;
    case 'day':
      return `${day} ${MONTHS[m - 1]} ${y}`;
  }
}

/** True when the precision is coarser than a day, so the chart softens the edge. */
export function isApproximate(d: DateValue | undefined): boolean {
  return !!d && d.precision !== 'day';
}

export type { DateValue, DatePrecision };
