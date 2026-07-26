/**
 * KPI strip — mirrors Pencil `zQKxN` statsRow.
 * 4 cards: Sessions (30d) · Participants · Consent rate · Avg attendance.
 * Each card's icon holder is the shared `StatusTag variant="icon"` so the
 * palette + shape match everywhere else in the app.
 */

import { Calendar, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { TrainingStats as Stats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function TrainingStats({
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
      label: t('training.stats.sessionCount'),
      value: num(filteredCount ?? stats?.sessionsLast30Days),
      Icon: Calendar,
      tone: 'info',
    },
    {
      label: t('training.stats.participants'),
      value: num(stats?.totalParticipants),
      Icon: Users,
      tone: 'success',
    },
    {
      label: t('training.stats.consentRate'),
      value: stats?.consentRate != null ? `${stats.consentRate}%` : '—',
      Icon: ShieldCheck,
      tone: 'success',
    },
    {
      label: t('training.stats.avgAttendance'),
      value: stats?.avgAttendance != null ? String(Math.round(stats.avgAttendance)) : '—',
      Icon: TrendingUp,
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
