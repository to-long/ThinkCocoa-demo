/**
 * Date/time helpers pinned to Ghana's timezone, ISO-style output.
 *
 * ImpactCocoa's primary users operate in Ghana (UTC+0, no DST). Timestamps
 * from the BE are stored as UTC (`TIMESTAMPTZ`) but render in the
 * farmer's / admin's local frame of reference, which for this product is
 * `Africa/Accra` regardless of where the user happens to be reading the
 * dashboard from.
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

const GHANA_TZ = 'Africa/Accra';
const LOCALE = 'en-CA';

const DATETIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: GHANA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DATE = new Intl.DateTimeFormat(LOCALE, {
  timeZone: GHANA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: GHANA_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const CLOCK = new Intl.DateTimeFormat(LOCALE, {
  timeZone: GHANA_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Format a UTC ISO string (or ms / Date) as Ghana-local `YYYY-MM-DD HH:mm`.
 * Example: `"2026-04-19 23:53"`. Returns `placeholder` on null input.
 */
export function formatGhanaDateTime(
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

/** Ghana-local date only, ISO style (`YYYY-MM-DD`). */
export function formatGhanaDate(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return DATE.format(d);
}

/** Ghana-local time only, e.g. `"23:53"`. */
export function formatGhanaTime(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return TIME.format(d);
}

/** Ghana-local wall-clock with seconds, e.g. `"23:53:07"`. */
export function formatGhanaClock(
  value: string | number | Date | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) return placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return placeholder;
  return CLOCK.format(d);
}

/** Ghana-local date, day-first with dashes, e.g. `"19-04-2026"`. */
export function formatGhanaDateDMY(
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

export const GHANA_TIME_ZONE = GHANA_TZ;
