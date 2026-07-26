/**
 * Dashboard breakdown charts — one section per tab. All charts route
 * through the shared DonutCard / BarCard so palette, ring thickness
 * (10px), bar thickness (10px), HTML legend, and empty-state
 * affordances stay identical to the Farmers tab.
 *
 * Each section derives its data from a stats endpoint the parent tab
 * has already subscribed to; SWR shares the cache so we don't refetch.
 */

import { useIntl } from 'react-intl';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  ApiVslaListItem,
  CorrectiveActionStats,
  ParcelStats,
  PrimaryEvacStats,
  PurchaseStats,
  SecondaryEvacStats,
} from '@/shared/api';
import { BarCard, type BreakdownItem, DonutCard, LineCard } from './breakdown-cards';

// ─── Farms ─────────────────────────────────────────────────────────

export function FarmsBreakdown({ stats }: { stats: ParcelStats | undefined }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  const eudrSlices: BreakdownItem[] = [
    { label: t('farms.eudr.compliant'), count: stats.eudr.compliant, tone: 'success' },
    { label: t('farms.eudr.needs_review'), count: stats.eudr.needs_review, tone: 'caution' },
    { label: t('farms.eudr.non_compliant'), count: stats.eudr.non_compliant, tone: 'danger' },
    { label: t('farms.eudr.unknown'), count: stats.eudr.unknown, tone: 'neutral' },
  ];

  const mappedSlices: BreakdownItem[] = [
    { label: t('dashboard.breakdown.mapped'), count: stats.mapped, tone: 'info' },
    {
      label: t('dashboard.breakdown.unmapped'),
      count: Math.max(0, stats.total - stats.mapped),
      tone: 'neutral',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DonutCard
        title={t('dashboard.breakdown.eudrTitle')}
        subtitle={t('dashboard.breakdown.eudrSubtitle')}
        items={eudrSlices}
        showEmpty
      />
      <DonutCard
        title={t('dashboard.breakdown.mappedTitle')}
        subtitle={t('dashboard.breakdown.mappedSubtitle')}
        items={mappedSlices}
      />
    </div>
  );
}

// ─── Corrective actions (inspection follow-ups) ────────────────────

export function CorrectiveActionsBreakdown({
  stats,
}: {
  stats: CorrectiveActionStats | undefined;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  // Workflow status mix. open/reopen are "not started", processing is
  // in-flight, done is resolved.
  const statusSlices: BreakdownItem[] = [
    { label: t('inspections.followUp.status.open'), count: stats.byStatus.open, tone: 'caution' },
    {
      label: t('inspections.followUp.status.reopen'),
      count: stats.byStatus.reopen,
      tone: 'warning',
    },
    {
      label: t('inspections.followUp.status.processing'),
      count: stats.byStatus.processing,
      tone: 'info',
    },
    { label: t('inspections.followUp.status.done'), count: stats.byStatus.done, tone: 'success' },
  ];

  const topicBars: BreakdownItem[] = (stats.byTopic ?? []).map((row) => ({
    label: t(`inspections.followUp.topic.${row.topic}`),
    count: row.count,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DonutCard
        title={t('dashboard.breakdown.caStatusTitle')}
        subtitle={intl.formatMessage(
          { id: 'dashboard.breakdown.caStatusSubtitle' },
          { overdue: stats.overdue },
        )}
        items={statusSlices}
      />
      <BarCard
        title={t('dashboard.breakdown.caTopicTitle')}
        subtitle={t('dashboard.breakdown.caTopicSubtitle')}
        items={topicBars}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
    </div>
  );
}

// ─── VSLA ──────────────────────────────────────────────────────────

export function VslaBreakdown({ groups }: { groups: ApiVslaListItem[] | undefined }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!groups) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  // Top-N groups by members / by savings — pre-sorted descending so
  // BarCard's slice keeps the biggest bars. Groups with null latest
  // metrics are dropped (they have no report yet, nothing to chart).
  const byMembers: BreakdownItem[] = groups
    .filter((g) => (g.latestActiveMembers ?? 0) > 0)
    .sort((a, b) => (b.latestActiveMembers ?? 0) - (a.latestActiveMembers ?? 0))
    .map((g) => ({ label: g.groupName, count: g.latestActiveMembers ?? 0 }));

  const bySavings: BreakdownItem[] = groups
    .filter((g) => (g.latestSavingsCumulative ?? 0) > 0)
    .sort((a, b) => (b.latestSavingsCumulative ?? 0) - (a.latestSavingsCumulative ?? 0))
    .map((g) => ({
      label: g.groupName,
      count: Math.round(g.latestSavingsCumulative ?? 0),
    }));

  // Top groups by outstanding late loans (only groups that have any).
  const byLateLoans: BreakdownItem[] = groups
    .filter((g) => (g.latestLateLoansCount ?? 0) > 0)
    .sort((a, b) => (b.latestLateLoansCount ?? 0) - (a.latestLateLoansCount ?? 0))
    .map((g) => ({ label: g.groupName, count: g.latestLateLoansCount ?? 0 }));

  // Groups carrying any discrepancy — named so admins can see exactly
  // which groups to chase, sorted by how many reports were flagged.
  const byDiscrepancy: BreakdownItem[] = groups
    .filter((g) => g.discrepancyCount > 0)
    .sort((a, b) => b.discrepancyCount - a.discrepancyCount)
    .map((g) => ({ label: g.groupName, count: g.discrepancyCount, tone: 'danger' }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BarCard
        title={t('dashboard.breakdown.vslaMembersTitle')}
        subtitle={t('dashboard.breakdown.vslaMembersSubtitle')}
        items={byMembers}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
      <BarCard
        title={t('dashboard.breakdown.vslaSavingsTitle')}
        subtitle={t('dashboard.breakdown.vslaSavingsSubtitle')}
        items={bySavings}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
      <BarCard
        title={t('dashboard.breakdown.vslaLateLoansTitle')}
        subtitle={t('dashboard.breakdown.vslaLateLoansSubtitle')}
        items={byLateLoans}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
      <BarCard
        title={t('dashboard.breakdown.vslaDiscrepancyTitle')}
        subtitle={t('dashboard.breakdown.vslaDiscrepancySubtitle')}
        items={byDiscrepancy}
        emptyLabel={t('dashboard.breakdown.vslaDiscrepancyNone')}
      />
    </div>
  );
}

// ─── Traceability (2nd evac) ───────────────────────────────────────

export function TraceabilityBreakdown({ stats }: { stats: SecondaryEvacStats | undefined }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  const grades: BreakdownItem[] = (stats.grades ?? []).map((g) => ({
    label: g.grade,
    count: g.lots,
  }));
  const ports: BreakdownItem[] = (stats.ports ?? []).map((p) => ({
    label: p.port,
    count: p.lots ?? 0,
  }));
  const monthly = (stats.monthlyLots ?? []).map((p) => ({
    label: shortMonth(p.month),
    value: p.count,
  }));

  // Traceability completeness — of the primary lots referenced by
  // secondary lots, how many resolved to a real primary lot vs stayed
  // orphan (raw waybill entered but no matching 1st-evac record).
  const matched = stats.totalPrimaryMatched ?? 0;
  const orphan = Math.max(0, (stats.totalPrimaryLinked ?? 0) - matched);
  const matchSlices: BreakdownItem[] = [
    { label: t('dashboard.breakdown.traceMatchMatched'), count: matched, tone: 'success' },
    { label: t('dashboard.breakdown.traceMatchOrphan'), count: orphan, tone: 'danger' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DonutCard
        title={t('dashboard.breakdown.traceMatchTitle')}
        subtitle={t('dashboard.breakdown.traceMatchSubtitle')}
        items={matchSlices}
      />
      <LineCard
        title={t('dashboard.breakdown.lotsPerMonthTitle')}
        subtitle={t('dashboard.breakdown.lotsPerMonth2ndSubtitle')}
        points={monthly}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
      <DonutCard
        title={t('dashboard.breakdown.gradesTitle')}
        subtitle={t('dashboard.breakdown.gradesSubtitle')}
        items={grades}
      />
      <DonutCard
        title={t('dashboard.breakdown.portsTitle')}
        subtitle={t('dashboard.breakdown.portsSubtitle')}
        items={ports}
        sliceLimit={6}
      />
    </div>
  );
}

// ─── Primary evacuation (1st evac) ─────────────────────────────────

export function PrimaryEvacBreakdown({ stats }: { stats: PrimaryEvacStats | undefined }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  const bySociety: BreakdownItem[] = (stats.bySociety ?? []).map((s) => ({
    label: s.society,
    count: s.lots,
  }));

  const monthly = (stats.monthlyLots ?? []).map((p) => ({
    label: shortMonth(p.month),
    value: p.count,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BarCard
        title={t('dashboard.breakdown.societyLotsTitle')}
        subtitle={t('dashboard.breakdown.societyLotsSubtitle')}
        items={bySociety}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
      <LineCard
        title={t('dashboard.breakdown.lotsPerMonthTitle')}
        subtitle={t('dashboard.breakdown.lotsPerMonthSubtitle')}
        points={monthly}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
    </div>
  );
}

// ─── Purchases ─────────────────────────────────────────────────────

/** Short month label from a `YYYY-MM` key (e.g. "Jul 25"). */
function shortMonth(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short' });
}

export function PurchasesBreakdown({ stats }: { stats: PurchaseStats | undefined }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  const pay = stats.paymentBreakdown;
  // Cash → success (green), mobile money → info2 (violet — matches
  // the money-transfer pill on the purchases list), cheque → caution
  // (amber), card → info (blue).
  const paymentSlices: BreakdownItem[] = [
    { label: t('purchases.payment.cash'), count: pay.cash, tone: 'success' },
    { label: t('purchases.payment.mobile_money'), count: pay.mobile_money, tone: 'info2' },
    { label: t('purchases.payment.cheque'), count: pay.cheque, tone: 'caution' },
    { label: t('purchases.payment.card'), count: pay.card, tone: 'info' },
  ];

  const trend = (stats.monthlyPurchases ?? []).map((p) => ({
    label: shortMonth(p.month),
    value: p.count,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DonutCard
        title={t('dashboard.breakdown.paymentTitle')}
        subtitle={t('dashboard.breakdown.paymentSubtitle')}
        items={paymentSlices}
      />
      <LineCard
        title={t('dashboard.breakdown.purchasesTrendTitle')}
        subtitle={t('dashboard.breakdown.purchasesTrendSubtitle')}
        points={trend}
        emptyLabel={t('dashboard.breakdown.noData')}
      />
    </div>
  );
}
