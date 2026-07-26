/**
 * Inspection KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Detailed EUDR + certificate breakdowns are still
 * available on the list filter chips + inspection detail page; here
 * we show only the top-level snapshot.
 */

import { CalendarCheck, ClipboardList, Leaf, ShieldCheck } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { InspectionStats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function InspectionsStats({
  stats,
  filteredCount,
}: {
  stats: InspectionStats | undefined;
  filteredCount?: number;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const certifiedTotal = stats
    ? stats.certificate.certified + stats.certificate.certified_with_ca
    : null;

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('inspections.stats.count'),
      value: num(filteredCount ?? stats?.total),
      Icon: ClipboardList,
      tone: 'info',
    },
    {
      label: t('inspections.stats.thisMonth'),
      value: num(stats?.thisMonth),
      Icon: CalendarCheck,
      tone: 'info2',
    },
    {
      label: t('inspections.stats.eudrCompliant'),
      value: num(stats?.eudr.compliant),
      Icon: Leaf,
      tone: 'success',
    },
    {
      label: t('inspections.stats.certified'),
      value: num(certifiedTotal),
      Icon: ShieldCheck,
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
