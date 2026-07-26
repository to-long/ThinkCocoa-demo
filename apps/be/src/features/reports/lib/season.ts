/**
 * Season → date-range mapping.
 *
 * ThinkCocoa follows the West African cocoa year, which starts 1 Oct
 * and ends 30 Sep of the following calendar year. The FE Reports page
 * surfaces seasons as `YYYY/YY` slugs (e.g., `2024/25` for the season
 * running 2024-10-01 → 2025-09-30).
 *
 * Reports can also cover an arbitrary window — a single calendar year,
 * or **several seasons at once**. To keep the generators unchanged
 * (they take a single `season` string and derive their WHERE bounds +
 * filename from it), the service encodes the exact picked range as a
 * `from..to` token (see `seasonFromRange` in service.ts). This function
 * accepts either shape and NEVER throws for a well-formed input, so
 * exporting a multi-season or off-cycle range can't fail.
 *
 * Pure function so the worker and tests can call it without any
 * runtime context.
 */

export interface DateRange {
  /** ISO date string (yyyy-mm-dd), inclusive. */
  from: string;
  /** ISO date string (yyyy-mm-dd), inclusive. */
  to: string;
}

/** Lossless `from..to` range token (both ISO `yyyy-mm-dd`), emitted by
 *  `seasonFromRange` so an arbitrary / multi-season window survives the
 *  round-trip to the generators. */
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
/** Match `YYYY/YY` or `YYYY/YYYY`. */
const SEASON_RE = /^(\d{4})\/(\d{2}|\d{4})$/;

export function seasonToDateRange(season: string): DateRange {
  const s = season.trim();

  // Exact range token — use the picked dates verbatim (covers single
  // calendar years and multi-season spans).
  const range = RANGE_RE.exec(s);
  if (range) {
    return { from: range[1]!, to: range[2]! };
  }

  const m = SEASON_RE.exec(s);
  if (!m) {
    throw new Error(
      `Invalid season "${season}". Expected YYYY/YY (e.g. 2024/25), YYYY/YYYY, or a from..to range.`,
    );
  }
  const startYear = Number(m[1]);
  const rawEnd = m[2]!;
  let endYear =
    rawEnd.length === 2 ? Math.floor(startYear / 100) * 100 + Number(rawEnd) : Number(rawEnd);
  // Tolerant: a self-referential or backwards second component (e.g.
  // `2026/26`) just means the single cocoa year starting `startYear` —
  // don't reject it. A genuine multi-year `YYYY/YYYY` (e.g. `2024/2026`)
  // is honoured as-is so several seasons export together.
  if (endYear <= startYear) endYear = startYear + 1;
  return {
    from: `${startYear}-10-01`,
    to: `${endYear}-09-30`,
  };
}

/** A filename-safe slug for the season / range. `YYYY/YY` → `2024-25`;
 *  a `from..to` range → `2024-10-01_2026-09-30`. */
export function seasonToSlug(season: string): string {
  const s = season.trim();
  const range = RANGE_RE.exec(s);
  if (range) return `${range[1]}_${range[2]}`;
  return s.replace('/', '-');
}
