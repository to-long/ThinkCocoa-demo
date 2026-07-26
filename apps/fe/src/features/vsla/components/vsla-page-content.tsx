/**
 * VSLA Groups list — one row per group from `/api/vsla`.
 *
 * Columns: Group · Latest month · Active members · Latest savings ·
 *          Reports · Latest discrepancy · Actions.
 *
 * The header CoopSwitcher owns tenant scope (see the `/vsla` entry in
 * app-header SWITCHER_ROOTS). Cross-coop groups (BE `cooperative_id
 * IS NULL`) show under every active-coop scope automatically.
 */

import { AlertTriangle, Eye, LandPlot } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link, useSearchParams } from 'react-router-dom';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusTag } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatSociety, sortSocieties } from '@/lib/society';
import { useVslaList, useVslaStats } from '@/shared/api';
import { RefCell, VslaRefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { VslaStats } from './vsla-stats';

const PAGE_SIZE = 10;

function formatMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

function ghs(amount: number): string {
  return `₵${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function VslaPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.vsla') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const discrepancy = searchParams.get('discrepancy') as 'yes' | 'no' | null;
  const societyParam = searchParams.get('society') ?? '';
  const { data: stats } = useVslaStats();
  const { sort, hasSort, sorterPropsFor } = useTableSort();
  const pageParsed = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  const updateUrl = (updates: Record<string, string | number | null>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '' || v === undefined) next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  };

  const { data, isLoading } = useVslaList({
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
    discrepancy: discrepancy ?? undefined,
    society: societyParam || undefined,
    sort,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-foreground">{t('vsla.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('vsla.subtitle')}</p>
        </div>
      </header>

      <VslaStats filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-4"
            value={q}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('vsla.filters.searchPlaceholder')}
          />
          <Select
            value={societyParam || undefined}
            onValueChange={(v) => updateUrl({ society: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={societyParam ? () => updateUrl({ society: null, page: null }) : undefined}
            >
              <SelectValue placeholder={t('vsla.filters.societyAll')} />
            </SelectTrigger>
            <SelectContent>
              {sortSocieties(stats?.societies ?? []).map((soc) => (
                <SelectItem key={soc} value={soc}>
                  {formatSociety(soc)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={discrepancy ?? undefined}
            onValueChange={(v) => updateUrl({ discrepancy: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={discrepancy ? () => updateUrl({ discrepancy: null, page: null }) : undefined}
            >
              <AlertTriangle className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('vsla.filters.discrepancyAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">{t('vsla.filters.discrepancyYes')}</SelectItem>
              <SelectItem value="no">{t('vsla.filters.discrepancyNo')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(q || discrepancy || societyParam || hasSort) && (
          <button
            type="button"
            onClick={() => setSearchParams({}, { replace: true })}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('vsla.filters.reset')}
          </button>
        )}
      </div>

      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
          <Table className="table-fixed" containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-20 w-[240px] bg-muted p-0">
                  <ColumnSorter {...sorterPropsFor('group')} label={t('vsla.table.group')} />
                </TableHead>
                <TableHead className="w-[150px] p-0">
                  <ColumnSorter {...sorterPropsFor('society')} label={t('vsla.table.society')} />
                </TableHead>
                <TableHead className="w-[150px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('enumerator')}
                    label={t('vsla.table.enumerator')}
                  />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('latest_month')}
                    label={t('vsla.table.latestMonth')}
                  />
                </TableHead>
                <TableHead className="w-[130px] p-0">
                  <ColumnSorter {...sorterPropsFor('members')} label={t('vsla.table.members')} />
                </TableHead>
                <TableHead className="w-[130px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('savings')}
                    label={t('vsla.table.latestSavings')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[90px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('reports')}
                    label={t('vsla.table.reports')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[170px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('discrepancy')}
                    label={t('vsla.table.discrepancy')}
                  />
                </TableHead>
                <TableHead className="w-[80px] text-right">{t('vsla.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    …
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {t('vsla.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((s) => (
                  <TableRow
                    key={s.id}
                    className="group/row h-[48px] cursor-pointer text-[13px] hover:bg-muted"
                  >
                    <TableCell className="sticky left-0 z-10 w-[240px] bg-card transition-colors group-hover/row:bg-muted">
                      <VslaRefCell
                        groupName={s.groupName}
                        groupNumber={s.groupNumber}
                        stopRowClick
                      />
                    </TableCell>
                    <TableCell>
                      {s.society ? (
                        <StatusTag tone="lime">
                          <LandPlot className="size-3" />
                          {formatSociety(s.society)}
                        </StatusTag>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Enumerator — name over id, no cross-ref route exists. */}
                    <TableCell>
                      <RefCell name={s.communityWorkerName} code={s.enumeratorId} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.latestReportMonth ? formatMonth(s.latestReportMonth) : '—'}
                    </TableCell>
                    <TableCell>
                      {s.latestActiveMembers != null ? (
                        <span className="font-medium text-foreground">{s.latestActiveMembers}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {s.latestSavingsCumulative != null ? ghs(s.latestSavingsCumulative) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-foreground">{s.reportCount}</TableCell>
                    <TableCell>
                      {s.discrepancyCount > 0 ? (
                        <StatusTag tone="caution">
                          <AlertTriangle className="size-3" />
                          {intl.formatMessage(
                            { id: 'vsla.discrepancy.nMonths' },
                            { n: s.discrepancyCount },
                          )}
                        </StatusTag>
                      ) : (
                        <StatusTag tone="success">{t('vsla.discrepancy.no')}</StatusTag>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/vsla/${s.id}`}
                        aria-label={t('vsla.action.open')}
                        className="inline-flex cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Eye className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {intl.formatMessage(
              { id: 'common.pager.showing' },
              {
                from: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, total),
                total: total.toLocaleString(),
              },
            )}
          </span>
          <DataPagination
            page={page}
            totalPages={totalPages}
            onPageChange={(p) => updateUrl({ page: p === 1 ? null : p })}
            className="mx-0 w-auto"
          />
        </div>
      </div>
    </div>
  );
}
