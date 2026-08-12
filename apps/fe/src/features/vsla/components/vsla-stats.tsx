/**
 * VSLA KPI strip — 4 cards from `/api/vsla/stats`.
 * Tenant-scoped by the active-coop cookie; cross-coop groups (BE
 * cooperative_id IS NULL) are included in every scope.
 */

import { AlertTriangle, PiggyBank, Users, Wallet } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { useVslaStats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

function usd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toLocaleString()}`;
}

export function VslaStats({ filteredCount }: { filteredCount?: number } = {}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number) => n.toLocaleString();

  const { data } = useVslaStats();
  const activeGroups = data?.activeGroups ?? 0;
  const activeMembers = data?.activeMembers ?? 0;
  const savings = data?.cumulativeSavings ?? 0;
  const discrepancies = data?.groupsWithDiscrepancy ?? 0;

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('vsla.stats.groupCount'),
      value: num(filteredCount ?? activeGroups),
      Icon: PiggyBank,
      tone: 'info',
    },
    {
      label: t('vsla.stats.activeMembers'),
      value: num(activeMembers),
      Icon: Users,
      tone: 'success',
    },
    {
      label: t('vsla.stats.savingsCumulative'),
      value: usd(savings),
      Icon: Wallet,
      tone: 'info2',
    },
    {
      label: t('vsla.stats.discrepancies'),
      value: num(discrepancies),
      Icon: AlertTriangle,
      tone: discrepancies > 0 ? 'caution' : 'success',
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
