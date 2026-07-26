/**
 * Read-only summary of the flag a case belongs to — farmer, household,
 * DOB, source and flagged activities. Shared by the create-case and the
 * reopen/close dialogs so both surface the same child context.
 */

import { AlertTriangle, Building2, User } from 'lucide-react';
import { useIntl } from 'react-intl';
import { StatusTag } from '@/components/ui/status-tag';
import type { ClmrsFlag } from '../lib/mock';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function CaseFlagSummary({ flag }: { flag: ClmrsFlag }) {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3 text-sm">
      <SummaryRow
        label={t('clmrs.dialog.summaryFarmer')}
        icon={<User className="size-3.5 text-muted-foreground" />}
      >
        <span className="text-foreground">{flag.farmerName}</span>
      </SummaryRow>
      <SummaryRow label={t('clmrs.detail.field.farmerId')}>
        <span className="font-mono text-foreground">{flag.farmerId}</span>
      </SummaryRow>
      <SummaryRow
        label={t('clmrs.detail.field.cooperative')}
        icon={<Building2 className="size-3.5 text-muted-foreground" />}
      >
        <span className="text-foreground">{flag.cooperativeName}</span>
      </SummaryRow>
      <SummaryRow label={t('clmrs.dialog.summaryDob')}>
        <span className="text-foreground">{formatDate(flag.childDob)}</span>
      </SummaryRow>
      <SummaryRow label={t('clmrs.dialog.summarySource')}>
        <StatusTag tone={flag.source === 'household_visit' ? 'info' : 'lime'}>
          {flag.source === 'household_visit'
            ? t('clmrs.source.householdVisit')
            : t('clmrs.source.farmVisit')}
        </StatusTag>
      </SummaryRow>
      <SummaryRow label={t('clmrs.dialog.summaryActivities')}>
        <div className="flex flex-wrap gap-1">
          {flag.flaggedActivities.map((a) => (
            <StatusTag key={a} tone="caution">
              <AlertTriangle className="size-3" />
              {a}
            </StatusTag>
          ))}
        </div>
      </SummaryRow>
    </div>
  );
}

function SummaryRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-1.5 text-[13px]">{children}</div>
    </div>
  );
}
