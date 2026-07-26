/**
 * Roles KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Per-role user counts remain accessible in the
 * table below.
 */

import { KeyRound, Shield, Users, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { RolesStats } from '@/shared/api';

interface Props {
  stats: RolesStats | undefined;
  filteredCount?: number;
  /** Present for backward-compat; not used by the KPI strip anymore. */
  roleLabel?: (code: string, fallback: string) => string;
}

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function RolesSlimStats({ stats, filteredCount }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const totalUsers = (stats?.byRole ?? []).reduce((sum, r) => sum + r.userCount, 0);

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('roles.stats.roleCount'),
      value: num(filteredCount ?? stats?.total),
      Icon: Shield,
      tone: 'info',
    },
    {
      label: t('roles.stats.totalUsers'),
      value: num(totalUsers),
      Icon: Users,
      tone: 'success',
    },
    {
      label: t('roles.stats.permissionsAssigned'),
      value: num(stats?.permissions.assigned),
      Icon: KeyRound,
      tone: 'info2',
    },
    {
      label: t('roles.stats.permissionsUnassigned'),
      value: num(stats?.permissions.unassigned),
      Icon: XCircle,
      tone: 'neutral',
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
