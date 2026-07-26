/**
 * Farms KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Status + EUDR breakdowns live on the filter row
 * beneath the strip.
 */

import { LandPlot, Leaf, MapPin, ShieldAlert } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { useParcelStats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function FarmsStats({ filteredCount }: { filteredCount?: number } = {}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats, isLoading } = useParcelStats();
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-[88px] w-full" />
        <Skeleton className="h-[88px] w-full" />
        <Skeleton className="h-[88px] w-full" />
        <Skeleton className="h-[88px] w-full" />
      </div>
    );
  }

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('farms.stats.farmCount'),
      value: num(filteredCount ?? stats.total),
      Icon: LandPlot,
      tone: 'info',
    },
    {
      label: t('farms.stats.mapped'),
      value: num(stats.mapped),
      Icon: MapPin,
      tone: 'success',
    },
    {
      label: t('farms.eudr.compliant'),
      value: num(stats.eudr.compliant),
      Icon: Leaf,
      tone: 'success',
    },
    {
      label: t('farms.eudr.non_compliant'),
      value: num(stats.eudr.non_compliant),
      Icon: ShieldAlert,
      tone: 'danger',
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
