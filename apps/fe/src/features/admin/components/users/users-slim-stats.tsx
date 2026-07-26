/**
 * Users KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Scope + role breakdowns remain accessible via
 * the list filter dropdowns.
 */

import { Trash2, UserCheck, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { useUserStats } from '@/shared/api';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function UsersSlimStats({ filteredCount }: { filteredCount?: number } = {}) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const { data: stats } = useUserStats();
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('users.stats.userCount'),
      value: num(filteredCount ?? stats?.total),
      Icon: Users,
      tone: 'info',
    },
    {
      label: t('users.stats.active'),
      value: num(stats?.active),
      Icon: UserCheck,
      tone: 'success',
    },
    {
      label: t('users.stats.deleted'),
      value: num(stats?.deleted),
      Icon: Trash2,
      tone: 'neutral',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3">
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
