/**
 * Date/time helpers pinned to UTC, ISO-style output.
 *
 * Timestamps from the BE are stored as UTC (`TIMESTAMPTZ`) and render in
 * UTC everywhere so a value reads the same regardless of where the viewer
 * happens to be — no per-user drift, no DST surprises. A deployment that
 * needs a fixed regional frame can change `APP_TZ` in this one place.
 *
 * Format choice — `YYYY-MM-DD HH:mm` (date) and `YYYY-MM-DD` (date only)
 * — is unambiguous, sortable as plain text, locale-stable, and tight in
 * tabular columns. Picked deliberately over locale-flavoured variants
 * (`19 Apr 2026, 23:53 GMT`) so every list column stays the same width
 * regardless of language toggle.
 *
 * Implementation uses `en-CA` because it natively emits ISO-style
 * `YYYY-MM-DD` for dates; the comma between date and time is dropped
 * with a single replace so the output is `YYYY-MM-DD HH:mm`.
 */

const APP_TZ = 'UTC';
const LOCALE = 'en-CA';

const DATETIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DATE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const CLOCK = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Format a UTC ISO string (or ms / Date) as `YYYY-MM-DD HH:mm`.
 * Example: `"2026-04-19 23:53"`. Returns `placeholder` on null input.
 */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  // `en-CA` emits `2026-04-19, 23:53` — drop the comma so the column
  // width is predictable and the value is greppable.
  return DATETIME.format(d).replace(', ', ' ');
}

/** Date only, ISO style (`YYYY-MM-DD`). */
export function formatDate(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return DATE.format(d);
}

/** Time only, e.g. `"23:53"`. */
export function formatTime(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return TIME.format(d);
}

/** Wall-clock with seconds, e.g. `"23:53:07"`. */
export function formatClock(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return CLOCK.format(d);
}

/** Date, day-first with dashes, e.g. `"19-04-2026"`. */
export function formatDateDMY(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  // DATE emits ISO `YYYY-MM-DD`; flip to `DD-MM-YYYY`.
  const [y, m, day] = DATE.format(d).split('-');
  return `${day}-${m}-${y}`;
}

export const APP_TIME_ZONE = APP_TZ;
