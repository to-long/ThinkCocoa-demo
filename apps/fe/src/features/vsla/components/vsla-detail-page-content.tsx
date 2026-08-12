/**
 * VSLA Group detail — one group + its full monthly history from
 * `/api/vsla/:id`.
 *
 * Sections:
 *   1. Hero — group name + number + coop chip(s)
 *   2. Latest-month KPI tiles (4-up, 2-col layout)
 *   3. Monthly reports table — one row per month, newest first
 *   4. Member roster + per-member savings/loan ledger
 *   5. Discrepancy panel when the group has ≥ 1 flagged month
 */

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  PiggyBank,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';
import { type ComponentType, type SVGProps, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useParams } from 'react-router-dom';
import { DataPagination } from '@/components/ui/data-pagination';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useVslaGroup } from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { VslaMembersCard } from './vsla-members-card';
import { VslaTrends } from './vsla-trends';

const HISTORY_PAGE_SIZE = 10;

function usd(amount: number): string {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatMonthLong(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

export function VslaDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  const { data: group, error, isLoading } = useVslaGroup(id);
  const [historyPage, setHistoryPage] = useState(1);

  const reports = group?.monthlyReports ?? [];
  const historyTotalPages = Math.max(1, Math.ceil(reports.length / HISTORY_PAGE_SIZE));
  const historyPageSafe = Math.min(historyPage, historyTotalPages);
  const historySlice = useMemo(
    () =>
      reports.slice((historyPageSafe - 1) * HISTORY_PAGE_SIZE, historyPageSafe * HISTORY_PAGE_SIZE),
    [reports, historyPageSafe],
  );

  useBreadcrumb([
    { label: t('navigation.vsla'), href: '/vsla' },
    { label: group ? group.groupName : t('vsla.detail.title') },
  ]);

  if (error) {
    return <ErrorBanner message={error instanceof Error ? error.message : String(error)} />;
  }

  if (isLoading || !group) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const latest = reports[0] ?? null;
  const discrepancyCount = group.discrepancyCount;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BackButton fallbackTo="/vsla" />
          <h1 className="font-semibold text-2xl text-foreground">{t('vsla.detail.title')}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t('vsla.detail.subtitle')}</p>
      </header>

      {/* Group identity — always present, decoupled from any single report */}
      <section className="flex items-start gap-3 rounded-lg border bg-card p-3.5 shadow-sm">
        <StatusTag tone="info2" variant="icon">
          <PiggyBank className="size-5" />
        </StatusTag>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="font-semibold text-foreground text-xl">{group.groupName}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusTag tone="lime">
              <span className="font-mono">{group.groupNumber}</span>
            </StatusTag>
            <StatusTag tone="neutral">
              <span className="font-mono">{group.enumeratorId}</span>
            </StatusTag>
            {discrepancyCount > 0 && (
              <StatusTag tone="caution">
                <AlertTriangle className="size-3" />
                {intl.formatMessage({ id: 'vsla.discrepancy.nMonths' }, { n: discrepancyCount })}
              </StatusTag>
            )}
          </div>
        </div>
      </section>

      {/* Latest-month snapshot */}
      {latest && (
        <>
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <span className="font-semibold">{t('vsla.detail.latestMonthLabel')}</span>
            <span className="text-foreground">{formatMonthLong(latest.reportMonth)}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            <Tile
              Icon={Users}
              tone="info"
              label={t('vsla.detail.activeMembers')}
              value={latest.activeMembersAtVisit?.toString() ?? '—'}
              sub={intl.formatMessage(
                { id: 'vsla.detail.activeMembersSub' },
                { male: latest.maleMembers ?? 0, female: latest.femaleMembers ?? 0 },
              )}
            />
            <Tile
              Icon={Wallet}
              tone="success"
              label={t('vsla.detail.savingsCumulative')}
              value={latest.savingsCumulative != null ? usd(latest.savingsCumulative) : '—'}
              sub={t('vsla.detail.savingsCumulativeSub')}
            />
            <Tile
              Icon={ShieldAlert}
              tone={(latest.lateLoansCount ?? 0) > 0 ? 'caution' : 'success'}
              label={t('vsla.detail.lateLoans')}
              value={(latest.lateLoansCount ?? 0).toString()}
              sub={
                (latest.lateLoansCount ?? 0) > 0
                  ? intl.formatMessage(
                      { id: 'vsla.detail.lateLoansUnpaid' },
                      { amount: usd(latest.lateLoansUnpaidBalance ?? 0) },
                    )
                  : t('vsla.detail.lateLoansNone')
              }
            />
            <Tile
              Icon={latest.hasDiscrepancy ? AlertTriangle : CheckCircle2}
              tone={latest.hasDiscrepancy ? 'caution' : 'success'}
              label={t('vsla.detail.discrepancy')}
              value={latest.hasDiscrepancy ? t('vsla.discrepancy.yes') : t('vsla.discrepancy.no')}
              sub={
                latest.hasDiscrepancy
                  ? t('vsla.detail.discrepancySub')
                  : t('vsla.detail.discrepancyNoneSub')
              }
            />
          </div>
        </>
      )}

      {/* 12-month trends — sits between the "latest month" stat tiles
          (single point-in-time) and the raw monthly history table
          (row per submission). Answers the "how is the group
          trending?" question without making staff eyeball the table. */}
      <VslaTrends reports={reports} />

      {/* Monthly history */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-1 p-4 pb-0">
          <h2 className="flex items-center gap-2 font-semibold text-base text-foreground">
            <CalendarDays className="size-4 text-muted-foreground" />
            {t('vsla.detail.historyTitle')}
          </h2>
          <p className="text-muted-foreground text-xs">{t('vsla.detail.historySubtitle')}</p>
        </div>
        <div className="p-4">
          <div className="overflow-hidden rounded-md border border-border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[130px] bg-muted">
                    {t('vsla.table.month')}
                  </TableHead>
                  <TableHead className="w-[130px]">{t('vsla.table.members')}</TableHead>
                  <TableHead className="w-[130px] text-right">{t('vsla.table.savings')}</TableHead>
                  <TableHead className="w-[140px] text-right">
                    {t('vsla.table.lateLoans')}
                  </TableHead>
                  <TableHead className="w-[140px]">{t('vsla.table.discrepancy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {t('vsla.detail.historyEmpty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  historySlice.map((r) => (
                    <TableRow key={r.id} className="group/row h-[44px] text-[13px] hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-card text-foreground transition-colors group-hover/row:bg-muted">
                        {formatMonthLong(r.reportMonth)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">
                          {r.activeMembersAtVisit ?? '—'}
                        </span>
                        {r.maleMembers != null && r.femaleMembers != null && (
                          <span className="ml-1 text-muted-foreground text-[11px]">
                            ({r.maleMembers}M · {r.femaleMembers}F)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {r.savingsCumulative != null ? usd(r.savingsCumulative) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {(r.lateLoansCount ?? 0) > 0 ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="font-medium text-foreground">{r.lateLoansCount}</span>
                            <span className="text-muted-foreground text-[11px]">
                              {usd(r.lateLoansUnpaidBalance ?? 0)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.hasDiscrepancy ? (
                          <StatusTag tone="caution">
                            <AlertTriangle className="size-3" />
                            {t('vsla.discrepancy.yes')}
                          </StatusTag>
                        ) : (
                          <StatusTag tone="success">{t('vsla.discrepancy.no')}</StatusTag>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {intl.formatMessage(
              { id: 'common.pager.showing' },
              {
                from: reports.length === 0 ? 0 : (historyPageSafe - 1) * HISTORY_PAGE_SIZE + 1,
                to: Math.min(historyPageSafe * HISTORY_PAGE_SIZE, reports.length),
                total: reports.length.toLocaleString(),
              },
            )}
          </span>
          <DataPagination
            page={historyPageSafe}
            totalPages={historyTotalPages}
            onPageChange={setHistoryPage}
            className="mx-0 w-auto"
          />
        </div>
      </section>

      {/* Member roster — who is in the group, and one member's own ledger.
          Placed after the group history so the page reads group → member. */}
      {group && <VslaMembersCard groupId={group.id} shareValue={group.shareValue} />}
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
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}
