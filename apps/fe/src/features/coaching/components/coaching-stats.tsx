/**
 * Top-of-page KPI strip — mirrors Pencil `XXipo` "statsRow".
 * 4 cards: Visits (30d) · Active farmers · At-risk CLMRS · Pending
 * follow-up. Icon holder is the shared `StatusTag variant="icon"`.
 */

import { CalendarCheck, ClipboardList, ShieldAlert, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { CoachingStats as Stats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function CoachingStats({
  stats,
  filteredCount,
}: {
  stats: Stats | undefined;
  filteredCount?: number;
}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const val = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('coaching.stats.visitCount'),
      value: val(filteredCount ?? stats?.visitsLast30Days),
      Icon: CalendarCheck,
      tone: 'info',
    },
    {
      label: t('coaching.stats.activeFarmers'),
      value: val(stats?.activeFarmers),
      Icon: Users,
      tone: 'success',
    },
    {
      label: t('coaching.stats.atRisk'),
      value: val(stats?.atRiskClmrs),
      Icon: ShieldAlert,
      tone: 'danger',
    },
    {
      label: t('coaching.stats.pendingFollowUp'),
      value: val(stats?.pendingFollowUp),
      Icon: ClipboardList,
      tone: 'caution',
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
