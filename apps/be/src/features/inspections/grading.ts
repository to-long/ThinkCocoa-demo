/**
 * Certification grading — maps a compliance percentage + farmer's
 * program year to one of three outcomes:
 *
 *   • certified          — audit passed, no follow-up
 *   • certified_with_ca  — passed with corrective actions attached
 *   • not_certified      — failed audit
 *
 * Thresholds are keyed by program year (1–5, "Year 5+" clamps to 5)
 * per the "Scoring system" sheet of the Internal Inspection Form spec
 * (rows R7-R11). Disqualified as a first-class status was dropped by
 * business — anything below the Not Certified floor is bucketed with
 * Not Certified via fallthrough.
 *
 * Program year is counted by **cocoa seasons** (Oct 1 → Sep 30), not
 * calendar years, so an inspection in Feb 2024 for a farmer who
 * registered in May 2023 lands in Year 2 (season 2023/24) — both dates
 * are in the same season.
 */

export type CertificationOutcome = 'certified' | 'certified_with_ca' | 'not_certified';

interface Thresholds {
  certified: number;
  certified_with_ca: number;
  not_certified: number;
}

const THRESHOLDS: Record<number, Thresholds> = {
  1: { certified: 60, certified_with_ca: 50, not_certified: 25 },
  2: { certified: 70, certified_with_ca: 50, not_certified: 25 },
  3: { certified: 75, certified_with_ca: 50, not_certified: 25 },
  4: { certified: 80, certified_with_ca: 50, not_certified: 25 },
  5: { certified: 90, certified_with_ca: 50, not_certified: 25 },
};

const OUTCOMES_DESC: CertificationOutcome[] = ['certified', 'certified_with_ca', 'not_certified'];

/** Return the cocoa-season start year for a date.
 *  Oct-Dec → this year (start of season YYYY/YY+1).
 *  Jan-Sep → previous year (still inside the YYYY-1/YYYY season). */
export function seasonStartYear(d: Date): number {
  return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
}

/** Farmer program year, counted by cocoa seasons between registration
 *  and inspection. Clamps to [1, 5]; null registration → Year 1.  */
export function computeProgramYear(
  registrationDate: Date | null | undefined,
  inspectionDate: Date,
): number {
  if (!registrationDate) return 1;
  const diff = seasonStartYear(inspectionDate) - seasonStartYear(registrationDate);
  return Math.min(Math.max(diff + 1, 1), 5);
}

/** Parse Kobo's `Management/DateOfCertification` choice value into a
 *  program-year integer (1..5). Field is a select with 5 options:
 *  `year1` … `year5plus`. `year5plus` collapses to 5 since the
 *  threshold matrix treats Year ≥5 identically. Returns null when the
 *  field is missing or unrecognised so callers can fall back to the
 *  registration-date season math. */
export function programYearFromKobo(
  raw: Record<string, unknown> | null | undefined,
): number | null {
  if (!raw) return null;
  const v = raw['Management/DateOfCertification'];
  if (typeof v !== 'string') return null;
  const m = /^year(\d+)/.exec(v);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 5);
}

/** Preferred program-year resolver — the inspector-entered Kobo field
 *  takes precedence (it's per-visit, always populated by the form),
 *  and falls back to the season-based derivation from
 *  `farmer.registration_date`. Ops seed rarely carries registration
 *  dates, so relying on the Kobo answer is the more reliable path. */
export function resolveProgramYear(
  raw: Record<string, unknown> | null | undefined,
  registrationDate: Date | null | undefined,
  inspectionDate: Date,
): number {
  return programYearFromKobo(raw) ?? computeProgramYear(registrationDate, inspectionDate);
}

export function gradeInspection(pct: number, programYear: number): CertificationOutcome {
  const t = THRESHOLDS[programYear] ?? THRESHOLDS[1]!;
  for (const outcome of OUTCOMES_DESC) {
    if (pct >= t[outcome]) return outcome;
  }
  // pct < 25 — spec calls this Disqualified, bucketed into not_certified
  // because Disqualified was dropped as a first-class status.
  return 'not_certified';
}
