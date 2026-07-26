/**
 * 4 headline tiles + cross-field warning banner — mirrors Pencil
 * `VJVNY` (tierAHeadline) + `n94Ejl` (warningBanner).
 *
 * Tiles:
 *   1. Certification status    — score % + raw score / 142 + tier badge
 *                                + year-based threshold (per 2026 spec)
 *   2. RA critical criteria    — "N/5 passed" + 5 gate labels
 *   3. EUDR risk               — status badge + score
 *   4. Data warnings           — cross-field validation count
 *
 * The denominator and year thresholds are constants in `lib/certification.ts`.
 * Banner appears below when `metrics.warnings.length > 0`.
 */

import { CalendarCheck, Database, Leaf, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { ApiInspectionDetail } from '@/shared/api';
import { type CertificationTier, MAX_SCORE, tierIntlKey } from '../lib/certification';

const TIER_TONE: Record<CertificationTier, StatusTone> = {
  certified: 'success',
  certified_with_ca: 'success',
  not_certified: 'warning',
  disqualified: 'danger',
};

import { computeMetrics } from '../lib/metrics';

const EUDR_LABEL: Record<string, string> = {
  compliant: 'Compliant',
  needs_review: 'Needs review',
  non_compliant: 'Non-compliant',
  unknown: 'Unknown',
};

export function InspectionHeadlineTiles({ inspection }: { inspection: ApiInspectionDetail }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const m = computeMetrics(inspection);

  // Every certification value comes from the BE now — the parser
  // resolves the program year (Kobo field preferred, farmer registration
  // date fallback) + recomputes the outcome + pct on sync, so list and
  // detail always match. Falls back to displayed defaults only when the
  // BE hasn't populated the row yet.
  const score = inspection.complianceScore ?? 0;
  const pct = inspection.compliancePct ?? 0;
  const yearSeq = (inspection.programYear ?? 1) as 1 | 2 | 3 | 4 | 5;
  const tier: CertificationTier = inspection.certificationOutcome ?? 'not_certified';
  const certifiedThreshold = [60, 70, 75, 80, 90][Math.min(yearSeq, 5) - 1]!;
  const eudrKey = (inspection.eudrStatus ?? 'unknown') as keyof typeof EUDR_LABEL;
  const eudrIsGood = eudrKey === 'compliant';

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Every tile is now a 2-column layout: icon holder on the
            left, text stack on the right. That removes the vertical
            gap between the header row and the big number when the
            icon was pinned to the top-right of a `flex-col` tile. */}
        <Tile
          label={t('inspections.detail.tile.certification')}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone={TIER_TONE[tier]}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-3xl font-bold leading-none text-foreground">
              {pct.toFixed(2)}%
            </span>
            <StatusTag tone={TIER_TONE[tier]}>{t(tierIntlKey(tier))}</StatusTag>
          </div>
          <span className="text-[11px] font-medium text-foreground">
            {intl.formatMessage(
              { id: 'inspections.detail.cert.rawScore' },
              { score, max: MAX_SCORE },
            )}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <CalendarCheck className="size-3" />
            {intl.formatMessage(
              { id: 'inspections.detail.cert.yearThreshold' },
              { year: yearSeq, threshold: certifiedThreshold },
            )}
          </span>
        </Tile>

        <Tile
          label={t('inspections.detail.tile.raCritical')}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone={m.raCritical.passed === m.raCritical.total ? 'success' : 'danger'}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-3xl font-bold leading-none text-foreground">
              {m.raCritical.passed}/{m.raCritical.total}
            </span>
            <StatusTag tone={m.raCritical.passed === m.raCritical.total ? 'success' : 'danger'}>
              {m.raCritical.passed === m.raCritical.total ? 'passed' : 'failed'}
            </StatusTag>
          </div>
          <div className="text-[10px] leading-snug text-muted-foreground">
            {m.raCritical.items.map((it) => it.label).join(' · ')}
          </div>
        </Tile>

        <Tile
          label={t('inspections.detail.tile.eudrRisk')}
          icon={<Leaf className="h-5 w-5" />}
          tone={
            eudrKey === 'compliant'
              ? 'success'
              : eudrKey === 'non_compliant'
                ? 'danger'
                : eudrKey === 'needs_review'
                  ? 'caution'
                  : 'neutral'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {inspection.eudrScore != null ? (
              <span className="flex items-baseline gap-1">
                <span className="text-3xl font-bold leading-none text-foreground">
                  {inspection.eudrScore}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">/ 8</span>
              </span>
            ) : (
              <span className="text-base font-bold leading-tight text-foreground">—</span>
            )}
            <StatusTag
              tone={eudrIsGood ? 'success' : eudrKey === 'non_compliant' ? 'danger' : 'caution'}
            >
              {EUDR_LABEL[eudrKey]}
            </StatusTag>
          </div>
          <div className="text-[10px] leading-snug text-muted-foreground">
            {inspection.eudrNoDeforestation
              ? 'Standard risk · No conversion since 2020'
              : 'Conversion risk needs review'}
          </div>
        </Tile>

        <Tile
          label={t('inspections.detail.tile.dataWarnings')}
          icon={
            m.warnings.length > 0 ? (
              <TriangleAlert className="h-5 w-5" />
            ) : (
              <Database className="h-5 w-5" />
            )
          }
          tone={m.warnings.length > 0 ? 'caution' : 'success'}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none text-foreground">
              {m.warnings.length}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {m.warnings.length === 1 ? 'warning' : 'warnings'}
            </span>
          </div>
          <div className="text-[10px] leading-snug text-muted-foreground">
            {m.warnings[0]?.title ?? 'All cross-field checks passed'}
          </div>
        </Tile>
      </div>

      {/* Warning banner — only renders when there's at least 1 warning */}
      {m.warnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-yellow-300 bg-yellow-50 px-3.5 py-2.5">
          <TriangleAlert className="size-4 shrink-0 text-amber-700 mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-amber-900">
              Cross-field validation flagged {m.warnings.length} issue
              {m.warnings.length > 1 ? 's' : ''}
            </span>
            <span className="text-xs leading-snug text-amber-900">
              {m.warnings[0]?.description}
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 self-start text-xs font-semibold text-amber-900 hover:underline"
          >
            Review →
          </button>
        </div>
      )}
    </div>
  );
}

/** Headline stat tile — two-column layout: uppercase label +
 *  `children` stacked on the LEFT, category-icon holder pinned to
 *  the RIGHT (`StatusTag variant="icon"`). Matches the Training /
 *  Coaching stats card pattern. */
function Tile({
  label,
  icon,
  tone = 'neutral',
  children,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3 shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {children}
      </div>
      <StatusTag tone={tone} variant="icon">
        {icon}
      </StatusTag>
    </div>
  );
}
