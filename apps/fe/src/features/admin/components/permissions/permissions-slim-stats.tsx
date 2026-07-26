/**
 * Permissions KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Uses the top 2 actions as the last 2 cards.
 */

import { Eye, KeyRound, Layers, Pencil } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { PermissionsStats } from '@/shared/api/permissions';

interface Props {
  stats: PermissionsStats | undefined;
  filteredCount?: number;
}

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/[_\s]+/)
    .map((p, i) =>
      i === 0 ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase(),
    )
    .join(' ');
}

export function PermissionsSlimStats({ stats, filteredCount }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const readCount = stats?.byAction.find((a) => a.action === 'read')?.count ?? 0;
  const updateCount = stats?.byAction.find((a) => a.action === 'update')?.count ?? 0;

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('permissions.stats.count'),
      value: num(filteredCount ?? stats?.total),
      Icon: KeyRound,
      tone: 'info',
    },
    {
      label: t('permissions.stats.groupScope'),
      value: num(stats?.groupCount),
      Icon: Layers,
      tone: 'success',
    },
    {
      label: titleCase('read'),
      value: num(readCount),
      Icon: Eye,
      tone: 'info2',
    },
    {
      label: titleCase('update'),
      value: num(updateCount),
      Icon: Pencil,
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
