/**
 * KPI strip for `/primary-evac` — 4-card layout matching the shared
 * standard (Farmer Training). Warehouses + throughput breakdowns
 * remain accessible via the list filter row, so the top of the page
 * stays scannable.
 */

import { PackageCheck, Truck, Users, Weight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { PrimaryEvacStats as Stats } from '@/shared/api';

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

export function PrimaryEvacStats({
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
      label: t('primaryEvac.stats.lotCount'),
      value: num(filteredCount ?? stats?.totalLots),
      Icon: Truck,
      tone: 'info',
    },
    {
      label: t('primaryEvac.stats.totalWeight'),
      value: stats?.totalKg != null ? tonnes(stats.totalKg) : '—',
      Icon: Weight,
      tone: 'success',
    },
    {
      label: t('primaryEvac.stats.totalBags'),
      value: num(stats?.totalBags),
      Icon: PackageCheck,
      tone: 'caution',
    },
    {
      label: t('primaryEvac.stats.activeDrivers'),
      value: num(stats?.activeDrivers),
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
