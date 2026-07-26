/**
 * Certification-outcome pill — derived from the latest inspection for
 * a farmer. Delegates styling to the shared `StatusTag`, only owning
 * the outcome→tone map + i18n key resolution.
 */

import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';

export type CertificationOutcome =
  | 'certified'
  | 'certified_with_ca'
  | 'not_certified'
  | 'disqualified';

// Business palette: Certified + CA both pass → success (green);
// Not Certified = warning (orange); Disqualified = danger (red).
const OUTCOME_TONE: Record<CertificationOutcome, StatusTone> = {
  certified: 'success',
  certified_with_ca: 'lime',
  not_certified: 'warning',
  disqualified: 'danger',
};

interface Props {
  outcome: CertificationOutcome | null;
  /** Optional `%` chip rendered right after the outcome pill (own tag). */
  compliancePct?: number | null;
}

export function CertificationOutcomeBadge({ outcome, compliancePct }: Props) {
  const intl = useIntl();
  if (!outcome) {
    return <span className="text-muted-foreground text-[13px]">—</span>;
  }
  const label = intl.formatMessage({ id: `farmers.certification.outcome.${outcome}` });
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <StatusTag tone={OUTCOME_TONE[outcome]} dot>
        {label}
      </StatusTag>
      {compliancePct != null && (
        <StatusTag tone="neutral">{`${compliancePct.toFixed(1)}%`}</StatusTag>
      )}
    </div>
  );
}

/** Raw compliance score as `N / 142` (max is fixed at 142 per the
 *  RA scoring sheet). Rendered as plain InfoField text. */
const MAX_SCORE = 142;
export function ComplianceScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-muted-foreground text-[13px]">—</span>;
  }
  return (
    <span>
      {score} / {MAX_SCORE}
    </span>
  );
}

/** Compliance % — plain text (1-decimal) on farmer detail. */
export function CompliancePctBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="text-muted-foreground text-[13px]">—</span>;
  }
  return <span>{pct.toFixed(1)}%</span>;
}

/** Program-year chip — `info2` (violet) because it's a sequence
 *  marker (cohort year), not a state. */
export function ProgramYearBadge({ programYear }: { programYear: number | null }) {
  if (programYear == null) {
    return <span className="text-muted-foreground text-[13px]">—</span>;
  }
  const label = `Year ${programYear >= 5 ? '5+' : programYear}`;
  return <StatusTag tone="info2">{label}</StatusTag>;
}
