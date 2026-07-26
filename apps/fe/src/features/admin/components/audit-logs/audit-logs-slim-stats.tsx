/**
 * Audit Logs KPI strip — 4-card layout matching the shared standard
 * (Farmer Training). Detailed scope breakdown lives on the list
 * filter chips.
 */

import { AlertTriangle, Calendar, CheckCircle2, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { AuditLogStats } from '@/shared/api/audit-logs';

interface Props {
  stats: AuditLogStats | undefined;
  filteredCount?: number;
}

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function AuditLogsSlimStats({ stats, filteredCount }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // global stat before the first list load resolves.
      label: t('auditLogs.stats.eventCount'),
      value: num(filteredCount ?? stats?.total),
      Icon: Calendar,
      tone: 'info',
    },
    {
      label: t('auditLogs.status.success'),
      value: num(stats?.byStatus.success),
      Icon: CheckCircle2,
      tone: 'success',
    },
    {
      label: t('auditLogs.status.failed'),
      value: num(stats?.byStatus.failed),
      Icon: XCircle,
      tone: 'danger',
    },
    {
      label: t('auditLogs.status.warning'),
      value: num(stats?.byStatus.warning),
      Icon: AlertTriangle,
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
