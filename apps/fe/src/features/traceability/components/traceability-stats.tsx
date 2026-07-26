/**
 * Traceability (secondary evacuation) KPI strip — 4-card layout
 * matching the shared standard (Farmer Training).
 */

import { Anchor, PackageCheck, Truck, Weight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { SecondaryEvacStats as Stats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

const KG_PER_BAG = 64;

/** Truck mirrored horizontally so it faces right (toward the port). */
function TruckFlipped({ className }: { className?: string }) {
  return <Truck className={`${className ?? ''} -scale-x-100`} />;
}

function tonnes(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${kg.toFixed(0)} kg`;
}

export function TraceabilityStats({
  stats,
  filteredCount,
}: {
  stats: Stats | undefined;
  filteredCount?: number;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const totalBags = stats?.totalBags ?? 0;
  const totalKg = totalBags * KG_PER_BAG;

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('traceability.stats.lotCount'),
      value: num(filteredCount ?? stats?.totalLots),
      Icon: TruckFlipped,
      tone: 'info',
    },
    {
      label: t('traceability.stats.totalWeight'),
      value: totalKg > 0 ? tonnes(totalKg) : '—',
      Icon: Weight,
      tone: 'success',
    },
    {
      label: t('traceability.stats.primaryLinked'),
      value: num(stats?.totalPrimaryLinked),
      Icon: PackageCheck,
      tone: 'caution',
    },
    {
      label: t('traceability.stats.topPortsCount'),
      value: num(stats?.ports?.length ?? 0),
      Icon: Anchor,
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
