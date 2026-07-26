/**
 * Certification scoring spec — single source of truth on the FE.
 *
 * Drawn from `docs/Internal_Inspection_Form updated 2026 - feedback
 * Richard.xlsx`, sheet `Scoring system`. Numbers will likely shift
 * as the form evolves, so every magic value the UI surfaces (max
 * score, year-based pass thresholds, tier colors) lives here.
 *
 * The BE may currently report a smaller `compliance_max` because a
 * handful of spec questions are absent from the deployed Kobo form;
 * the UI still presents the spec target (`MAX_SCORE`) so reviewers
 * see the canonical denominator. As the Kobo form catches up, the
 * BE-stored max will converge to this constant.
 */

/** Spec target — sum of `max(AO points)` across every Scoring=YES
 *  question on the 2026 form. */
export const MAX_SCORE = 142;

/** Per-year minimum percentage to land in each tier. Years above 4
 *  use the `Year 5+` column. Index = year - 1. */
const YEAR_THRESHOLDS: ReadonlyArray<{
  certified: number;
  certifiedWithCa: number;
  notCertified: number;
}> = [
  { certified: 60, certifiedWithCa: 50, notCertified: 25 }, // Year 1
  { certified: 70, certifiedWithCa: 50, notCertified: 25 }, // Year 2
  { certified: 75, certifiedWithCa: 50, notCertified: 25 }, // Year 3
  { certified: 80, certifiedWithCa: 50, notCertified: 25 }, // Year 4
  { certified: 90, certifiedWithCa: 50, notCertified: 25 }, // Year 5+
];

export type CertificationTier =
  | 'certified'
  | 'certified_with_ca'
  | 'not_certified'
  | 'disqualified';

export interface CertificationResult {
  tier: CertificationTier;
  /** % required to reach `certified` for the given year. */
  certifiedThreshold: number;
  /** Year sequence clamped to [1, 5]. Year ≥5 uses the Year 5+ row. */
  yearClamped: 1 | 2 | 3 | 4 | 5;
}

/** Classify a raw score against the year-based threshold table.
 *
 *  `disqualified` always wins regardless of pct — pass it from the
 *  scorer when any answer of value `D` was found. */
export function classifyCertification(
  pct: number,
  yearSeq: number,
  forceDisqualified = false,
): CertificationResult {
  const yearClamped = Math.min(Math.max(Math.trunc(yearSeq) || 1, 1), 5) as 1 | 2 | 3 | 4 | 5;
  const t = YEAR_THRESHOLDS[yearClamped - 1]!;

  if (forceDisqualified || pct < t.notCertified) {
    return { tier: 'disqualified', certifiedThreshold: t.certified, yearClamped };
  }
  if (pct < t.certifiedWithCa) {
    return { tier: 'not_certified', certifiedThreshold: t.certified, yearClamped };
  }
  if (pct < t.certified) {
    return { tier: 'certified_with_ca', certifiedThreshold: t.certified, yearClamped };
  }
  return { tier: 'certified', certifiedThreshold: t.certified, yearClamped };
}

/** Tailwind-class colour palette per tier. */
export const TIER_STYLES: Record<
  CertificationTier,
  {
    /** Tile + badge background */
    tileBg: string;
    tileBorder: string;
    /** Headline number color */
    headline: string;
    /** Badge background */
    badgeBg: string;
    /** Badge border */
    badgeBorder: string;
    /** Badge text */
    badgeText: string;
  }
> = {
  certified: {
    tileBg: 'bg-green-50',
    tileBorder: 'border-green-200',
    headline: 'text-green-700',
    badgeBg: 'bg-green-100',
    badgeBorder: 'border-green-300',
    badgeText: 'text-green-800',
  },
  // Both Certified tiers pass the audit → green treatment (only the
  // label distinguishes them). Not Certified is the warning colour;
  // Disqualified reserves red for the hard-fail case.
  certified_with_ca: {
    tileBg: 'bg-green-50',
    tileBorder: 'border-green-200',
    headline: 'text-green-700',
    badgeBg: 'bg-green-100',
    badgeBorder: 'border-green-300',
    badgeText: 'text-green-800',
  },
  not_certified: {
    tileBg: 'bg-orange-50',
    tileBorder: 'border-orange-200',
    headline: 'text-orange-700',
    badgeBg: 'bg-orange-100',
    badgeBorder: 'border-orange-300',
    badgeText: 'text-orange-800',
  },
  disqualified: {
    tileBg: 'bg-red-50',
    tileBorder: 'border-red-200',
    headline: 'text-red-700',
    badgeBg: 'bg-red-100',
    badgeBorder: 'border-red-300',
    badgeText: 'text-red-800',
  },
};

/** Intl message key for the tier badge label. */
export function tierIntlKey(tier: CertificationTier): string {
  return `inspections.detail.cert.tier.${tier}`;
}

/** Compute the displayed percentage from a raw score using `MAX_SCORE`
 *  as the denominator. The BE-stored `compliance_pct` is ignored on
 *  purpose so the FE consistently displays against the canonical spec
 *  target — see file header. */
export function pctFromScore(score: number | null): number {
  if (score == null || score < 0) return 0;
  return (score / MAX_SCORE) * 100;
}

/** Kobo field path holding the farmer's years-in-programme on every
 *  inspection submission (`year1` / `year2` / `year3` / `year4` /
 *  `year5plus`). Lives on the form question "30--How long has this
 *  farmer been in the certification programme?".
 *
 *  Source-of-truth decision: this inspector-entered field is treated as
 *  authoritative for the certification-year tier lookup. Alternatives
 *  considered and rejected:
 *
 *    - `farmer.farmers.registration_date` — the column exists but is
 *      NULL on every row because the seed CSV
 *      (`farmer-dataset-2025-2026.csv`) doesn't carry a join-date
 *      column. Populating it would require a separate enrollment data
 *      pipeline.
 *
 *    - Activating the dormant `farmer_registration` Kobo sync and
 *      using `_submission_time` — would only cover farmers registered
 *      AFTER the sync goes live; doesn't backfill existing 4143 rows.
 *
 *    - Counting prior inspections per farmer — all 440 inspections
 *      currently fall inside a 22-day window, so the row-number per
 *      farmer reflects re-submissions of the same visit, not actual
 *      years of programme membership.
 *
 *  When a future enrollment source lands, prefer it over this field
 *  for cross-inspection consistency. */
const KOBO_YEAR_FIELD = 'Management/DateOfCertification';

/** Map the Kobo choice name to a year-sequence integer (1..5).
 *  `year5plus` collapses to 5 — the year-threshold table treats Year ≥5
 *  identically. Returns null when the field is missing/unrecognised so
 *  callers can present a fallback. */
export function yearSeqFromRaw(raw: Record<string, unknown> | undefined): number | null {
  if (!raw) return null;
  const v = raw[KOBO_YEAR_FIELD];
  if (typeof v !== 'string') return null;
  const m = /^year(\d+)/.exec(v);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 5);
}
