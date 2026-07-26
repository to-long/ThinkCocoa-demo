/**
 * Cooperatives KPI strip — 3 cards, counts derived client-side from the
 * loaded list.
 *
 * No "Inactive" card: cooperatives are always created active (the dialog has
 * no control for it), so the tile sat permanently at 0. Deactivating one is
 * still possible from its detail page, and that shows in the row's Status
 * column where it's actionable.
 */

import { Building2, MapPin, Trash2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { useIntl } from 'react-intl';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import type { ApiCooperative } from '@/shared/api';

interface Props {
  cooperatives: ApiCooperative[];
  filteredCount?: number;
}

interface StatCard {
  label: string;
  value: string;
  Icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
}

export function CooperativesSlimStats({ cooperatives, filteredCount }: Props) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

  const districts = new Set(
    cooperatives.map((c) => c.districtName).filter((d): d is string => !!d),
  );
  const active = cooperatives.filter((c) => !c.deletedAt && c.isActive).length;
  const deleted = cooperatives.filter((c) => c.deletedAt).length;

  const cards: StatCard[] = [
    {
      // Reflects the current filter/search result; falls back to the
      // loaded-list length before the first list load resolves.
      label: t('cooperatives.stats.count'),
      value: num(filteredCount ?? cooperatives.length),
      Icon: Building2,
      tone: 'info',
    },
    {
      label: t('cooperatives.stats.groupStatus'),
      value: num(active),
      Icon: MapPin,
      tone: 'success',
    },
    {
      label: t('cooperatives.status.deleted'),
      value: num(deleted),
      Icon: Trash2,
      tone: 'neutral',
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="flex items-start justify-between rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                {c.label}
              </span>
              <span className="font-semibold text-2xl text-foreground">{c.value}</span>
            </div>
            <StatusTag tone={c.tone} variant="icon">
              <c.Icon className="h-5 w-5" />
            </StatusTag>
          </div>
        ))}
      </div>
      <span className="text-muted-foreground text-xs">
        {intl.formatMessage({ id: 'cooperatives.stats.districtsCount' }, { count: districts.size })}
      </span>
    </>
  );
}
