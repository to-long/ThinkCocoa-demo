/**
 * KPI strip for `/purchases` — 4-card layout matching the shared
 * standard (Farmer Training). Payment breakdown moves to the list
 * filter row so this strip stays a scannable snapshot.
 */

import { Coins, ShoppingCart, Users, Weight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { PurchaseStats as Stats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

function tonnes(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${kg.toFixed(0)} kg`;
}

function ghs(amount: number): string {
  if (amount >= 1_000_000) return `₵${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `₵${(amount / 1000).toFixed(1)}K`;
  return `₵${amount.toLocaleString()}`;
}

export function PurchaseStats({
  stats,
  filteredCount,
}: {
  stats: Stats | undefined;
  filteredCount?: number;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('purchases.stats.purchaseCount'),
      value: num(filteredCount ?? stats?.totalPurchases),
      Icon: ShoppingCart,
      tone: 'info',
    },
    {
      label: t('purchases.stats.totalWeight'),
      value: stats?.totalWeightKg != null ? tonnes(stats.totalWeightKg) : '—',
      Icon: Weight,
      tone: 'success',
    },
    {
      label: t('purchases.stats.totalAmount'),
      value: stats?.totalAmountGhs != null ? ghs(stats.totalAmountGhs) : '—',
      Icon: Coins,
      tone: 'caution',
    },
    {
      label: t('purchases.stats.activeFarmers'),
      value: num(stats?.activeFarmers),
      Icon: Users,
      tone: 'info2',
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
