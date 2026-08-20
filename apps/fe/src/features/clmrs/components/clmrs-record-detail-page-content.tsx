/**
 * CLMRS Record detail — universal detail page for every observed
 * child, cased or pending.
 *
 * URL contract: `/clmrs/:flagId`. The flag id is minted by
 * the BE on parser insert (`clmrs.flags.id`, uuid) — Kobo itself
 * doesn't give us a stable per-child identifier since B/C submissions
 * pack N children into one submission via repeat-groups whose rows
 * only have position (`child_index`), not their own id.
 *
 * Two states:
 *   • Pending (case IS null)  — read-only flag info + primary
 *                                "Create case" CTA that opens the
 *                                dialog and produces a case row.
 *   • Cased (case IS NOT null) — full case identity + status toggle
 *                                (Close ↔ Reopen) + last-visit date.
 */

import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flag,
  FolderOpen,
  Home,
  Loader2,
  ShieldAlert,
  SquareArrowOutUpRight,
  User,
} from 'lucide-react';
import { type ComponentType, type SVGProps, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import { PermissionGate } from '@/features/auth';
import { formatDate } from '@/lib/datetime';
import { setClmrsCaseStatus, useClmrsRecord } from '@/shared/api/clmrs';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';
import type { ClmrsFlag } from '../lib/mock';
import { CaseCreateDialog } from './case-create-dialog';
import { CaseStatusDialog } from './case-status-dialog';
import { ClmrsStatusPill } from './clmrs-status-pill';

export function ClmrsRecordDetailPageContent() {
  const { childId } = useParams<{ childId: string }>();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const activeCoop = useActiveCoop(selectActiveCoop);
  const { data: record, mutate } = useClmrsRecord(childId, activeCoop?.cooperativeCode ?? null);

  useBreadcrumb([
    { label: t('navigation.clmrs'), href: '/clmrs' },
    { label: record ? record.flag.childNameDisplay : t('clmrs.detail.title') },
  ]);

  if (!childId) {
    return <ErrorBanner message="Missing record id" />;
  }
  if (!record) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { flag, case: caseRow } = record;
  const status = caseRow ? caseRow.status : ('pending' as const);
  const isOpen = caseRow?.status === 'open';

  // Both directions go through the confirm dialog; reopening also
  // captures a follow-up (recheck) date.
  const handleStatusConfirm = async (followUpDate: string | null) => {
    if (!caseRow) return;
    const next = caseRow.status === 'open' ? 'closed' : 'open';
    try {
      await setClmrsCaseStatus(flag.childId, next, followUpDate);
      await mutate();
      toast.success(
        t(
          next === 'closed' ? 'clmrs.detail.statusToastClosed' : 'clmrs.detail.statusToastReopened',
        ),
      );
    } catch {
      toast.error(t('clmrs.dialog.createError'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/clmrs" />
          <h1 className="font-semibold text-2xl text-foreground">{t('clmrs.detail.title')}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('clmrs.detail.subtitle')}</p>
      </header>

      {/* Identity hero */}
      <section className="flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm">
        <StatusTag tone="info2" variant="icon">
          <ShieldAlert className="size-5" />
        </StatusTag>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="font-semibold text-foreground text-xl">{flag.childNameDisplay}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {caseRow && (
              <StatusTag tone="lime">
                <span className="font-mono">{caseRow.clmrsCode}</span>
              </StatusTag>
            )}
            <ClmrsStatusPill status={status} />
            <StatusTag tone={flag.source === 'household_visit' ? 'info' : 'lime'}>
              {flag.source === 'household_visit'
                ? t('clmrs.source.householdVisit')
                : t('clmrs.source.farmVisit')}
            </StatusTag>
          </div>
        </div>
      </section>

      {/* Stats strip — 4 tiles that read differently by state */}
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
        <Tile
          Icon={AlertTriangle}
          tone="caution"
          label={t('clmrs.detail.field.activities')}
          value={String(flag.flaggedActivities.length)}
          sub={t('clmrs.detail.field.activitiesSub')}
        />
        <Tile
          Icon={Calendar}
          tone="info"
          label={t('clmrs.detail.field.dob')}
          value={formatDate(flag.childDob)}
          sub={t('clmrs.detail.field.dobSub')}
        />
        {caseRow ? (
          <Tile
            Icon={Clock}
            tone="info"
            label={t('clmrs.detail.field.lastVisit')}
            value={formatDate(caseRow.lastVisitDate)}
            sub={
              caseRow.lastVisitDate
                ? t('clmrs.detail.field.lastVisitSub')
                : t('clmrs.detail.field.lastVisitNone')
            }
          />
        ) : (
          <Tile
            Icon={Calendar}
            tone="info2"
            label={t('clmrs.detail.field.observed')}
            value={formatDate(flag.lastObservedAt)}
            sub={t('clmrs.detail.field.observedSub')}
          />
        )}
        <Tile
          Icon={isOpen ? AlertTriangle : caseRow ? CheckCircle2 : ShieldAlert}
          tone={isOpen ? 'danger' : caseRow ? 'caution' : 'success'}
          label={t('clmrs.detail.field.status')}
          value={
            caseRow
              ? isOpen
                ? t('clmrs.status.open')
                : t('clmrs.status.closed')
              : t('clmrs.status.pending')
          }
          sub={
            caseRow
              ? isOpen
                ? t('clmrs.detail.statusOpenSub')
                : t('clmrs.detail.statusClosedSub')
              : t('clmrs.detail.statusPendingSub')
          }
        />
      </div>

      {/* Farmer / household panel — who the child belongs to */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-1 border-b pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-base text-foreground">
            <Home className="size-4 text-muted-foreground" />
            {t('clmrs.detail.household')}
          </h2>
          <p className="text-muted-foreground text-xs">{t('clmrs.detail.householdBody')}</p>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoField label={t('clmrs.detail.field.farmerId')}>
            <Link
              to={`/farmers/${encodeURIComponent(flag.farmerId)}`}
              className="inline-flex items-center gap-1 font-mono text-foreground hover:underline"
            >
              {flag.farmerId}
              <SquareArrowOutUpRight className="size-3.5 text-muted-foreground" />
            </Link>
          </InfoField>
          <InfoField label={t('clmrs.detail.field.farmerName')}>
            <span className="flex items-center gap-1 text-foreground">
              <User className="size-3 text-muted-foreground" />
              {flag.farmerName}
            </span>
          </InfoField>
        </div>
      </section>

      {/* Originating flag panel — the raw observation */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-1 border-b pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-base text-foreground">
            <Flag className="size-4 text-muted-foreground" />
            {t('clmrs.detail.originatingFlag')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {caseRow
              ? t('clmrs.detail.originatingFlagBody')
              : t('clmrs.detail.originatingFlagBodyPending')}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoField label={t('clmrs.detail.field.child')}>
            <span className="text-foreground">{flag.childNameDisplay}</span>
          </InfoField>
          <InfoField label={t('clmrs.detail.field.dob')}>
            <span className="text-foreground">{formatDate(flag.childDob)}</span>
          </InfoField>
          <InfoField label={t('clmrs.dialog.summarySource')}>
            <StatusTag tone={flag.source === 'household_visit' ? 'info' : 'lime'}>
              {flag.source === 'household_visit'
                ? t('clmrs.source.householdVisit')
                : t('clmrs.source.farmVisit')}
            </StatusTag>
          </InfoField>
          <InfoField label={t('clmrs.dialog.summaryActivities')}>
            <div className="flex flex-wrap gap-1">
              {flag.flaggedActivities.map((a) => (
                <StatusTag key={a} tone="caution">
                  <AlertTriangle className="size-3" />
                  {a}
                </StatusTag>
              ))}
            </div>
          </InfoField>
        </div>
      </section>

      {/* Case detail panel — always rendered; empty state prompts creation */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b pb-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 font-semibold text-base text-foreground">
              <FolderOpen className="size-4 text-muted-foreground" />
              {t('clmrs.detail.caseBlock')}
            </h2>
            <p className="text-muted-foreground text-xs">
              {caseRow ? t('clmrs.detail.caseBlockBody') : t('clmrs.detail.caseBlockBodyEmpty')}
            </p>
          </div>
          {caseRow ? (
            <PermissionGate codes={['clmrs:update']}>
              <Button
                size="sm"
                variant={isOpen ? 'default' : 'outline'}
                onClick={() => setStatusDialogOpen(true)}
              >
                {isOpen ? t('clmrs.action.closeCase') : t('clmrs.action.reopenCase')}
              </Button>
            </PermissionGate>
          ) : (
            <PermissionGate codes={['clmrs:create']}>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                {t('clmrs.action.createCase')}
              </Button>
            </PermissionGate>
          )}
        </div>
        {caseRow ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <InfoField label={t('clmrs.detail.field.clmrsCode')}>
              <span className="font-mono text-foreground">{caseRow.clmrsCode}</span>
            </InfoField>
            <InfoField label={t('clmrs.detail.field.status')}>
              <ClmrsStatusPill status={caseRow.status} />
            </InfoField>
            <InfoField label={t('clmrs.detail.field.lastVisit')}>
              <span className="text-foreground">{formatDate(caseRow.lastVisitDate)}</span>
            </InfoField>
            <InfoField label={t('clmrs.detail.field.followUp')}>
              {caseRow.followUpDate ? (
                <StatusTag tone="caution">
                  <CalendarClock className="size-3" />
                  {formatDate(caseRow.followUpDate)}
                </StatusTag>
              ) : (
                <span className="text-muted-foreground">
                  {t('clmrs.detail.field.followUpNone')}
                </span>
              )}
            </InfoField>
            <InfoField label={t('clmrs.detail.field.created')}>
              <span className="text-foreground">{formatDate(caseRow.createdAt)}</span>
              {caseRow.createdByName && (
                <span className="ml-1.5 text-muted-foreground text-[11px]">
                  by {caseRow.createdByName}
                </span>
              )}
            </InfoField>
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            {t('clmrs.detail.caseEmpty')}
          </div>
        )}
      </section>

      <CaseCreateDialog
        flag={dialogOpen ? (flag as ClmrsFlag) : null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => mutate()}
      />

      {caseRow && (
        <CaseStatusDialog
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
          mode={isOpen ? 'close' : 'reopen'}
          flag={flag}
          onConfirm={handleStatusConfirm}
        />
      )}
    </div>
  );
}

function Tile({
  Icon,
  tone,
  label,
  value,
  sub,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: StatusTone;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-row-reverse items-start gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <StatusTag tone={tone} variant="icon">
        <Icon className="h-5 w-5" />
      </StatusTag>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className="font-semibold text-2xl text-foreground">{value}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function InfoField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}
