/**
 * CLMRS KPI strip — 4 cards matching the shared standard
 * (VSLA / Farmer Training layout).
 *
 * Sourced from `/api/clmrs-records` (derived from coaching visits),
 * scoped to the active cooperative and computed from the same records
 * the list below renders.
 */

import { CheckCircle2, Flag, ShieldAlert, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { useClmrsRecords } from '@/shared/api/clmrs';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function ClmrsStats() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number) => n.toLocaleString();

  // Scope the counts to the active cooperative so they match the
  // (coop-filtered) list below.
  const activeCoop = useActiveCoop(selectActiveCoop);
  const { data } = useClmrsRecords(activeCoop?.cooperativeCode ?? null);
  const records = data?.records ?? [];
  const stats = {
    pendingFlags: records.filter((r) => !r.case).length,
    openCases: records.filter((r) => r.case?.status === 'open').length,
    closedCases: records.filter((r) => r.case?.status === 'closed').length,
    relatedFarmers: new Set(records.map((r) => r.flag.farmerId)).size,
  };

  const cards: StatCard[] = [
    {
      label: t('clmrs.stats.pendingFlags'),
      value: num(stats.pendingFlags),
      Icon: Flag,
      tone: stats.pendingFlags > 0 ? 'caution' : 'success',
    },
    {
      label: t('clmrs.stats.openCases'),
      value: num(stats.openCases),
      Icon: ShieldAlert,
      tone: 'info',
    },
    {
      label: t('clmrs.stats.closedCases'),
      value: num(stats.closedCases),
      Icon: CheckCircle2,
      tone: 'success',
    },
    {
      label: t('clmrs.stats.relatedFarmers'),
      value: num(stats.relatedFarmers),
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
