/**
 * Farmer KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Status / consent / cert-outcome breakdowns are
 * still surfaced via the filter row below the strip.
 */

import { BadgeCheck, ShieldCheck, UserCheck, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { type CertOutcomeBucket, useFarmerStats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

type FarmerStatsByCertOutcome = Array<{ outcome: CertOutcomeBucket; count: number }>;

function certOutcomeCount(
  rows: FarmerStatsByCertOutcome | undefined,
  outcome: CertOutcomeBucket,
): number {
  if (!rows) return 0;
  return rows.find((r) => r.outcome === outcome)?.count ?? 0;
}

export function FarmersSlimStats({ filteredCount }: { filteredCount?: number }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats } = useFarmerStats();
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const certifiedTotal =
    certOutcomeCount(stats?.byCertificationOutcome, 'certified') +
    certOutcomeCount(stats?.byCertificationOutcome, 'certified_with_ca');

  // % of farmers with an active RA cert (both certified + certified
  // with CA). Denominator is TOTAL farmers — farmers with no inspection
  // yet count as "not certified" toward the ratio.
  const totalFarmers = stats?.total ?? 0;
  const certPct = totalFarmers > 0 ? Math.round((certifiedTotal / totalFarmers) * 100) : null;

  const cards: StatCard[] = [
    {
      // Reflects the CURRENT filter/search result, not the global total —
      // falls back to the global stat before the first list load resolves.
      label: t('farmers.stats.count'),
      value: num(filteredCount ?? stats?.total),
      Icon: Users,
      tone: 'info',
    },
    {
      label: t('farmers.status.active'),
      value: num(stats?.active),
      Icon: UserCheck,
      tone: 'success',
    },
    {
      // Whole-catalog total of RA-certified farmers (certified +
      // certified_with_ca) — from useFarmerStats(), NOT the filtered list.
      label: t('farmers.stats.raCertified'),
      value: num(certifiedTotal),
      Icon: ShieldCheck,
      tone: 'info2',
    },
    {
      // Catalog-wide ratio, also unaffected by the filter row.
      label: t('farmers.stats.raCertificatePct'),
      value: certPct == null ? '—' : `${certPct}%`,
      Icon: BadgeCheck,
      tone: 'success',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex items-start justify-between rounded-lg border bg-card p-4 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs uppercase tracking-wide">{c.label}</span>
            <span className="font-semibold text-2xl text-foreground">{c.value}</span>
          </div>
          <StatusTag tone={c.tone} variant="icon">
            <c.Icon className="h-5 w-5" />
          </StatusTag>
        </div>
      ))}
    </div>
  );
}
