/**
 * Primary Evacuation list — mirrors the Pencil `ZIMtd` design.
 *
 * Columns: Waybill · Date · Source PC+Station · Society · Destination
 *          warehouse · Bags · Weight · Purchases · Eye.
 *
 * URL-backed search + warehouse/society/date-range filters + pagination.
 */

import { Building2, Eye, History, LandPlot, Loader2, ShoppingCart, Warehouse } from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link, useSearchParams } from 'react-router-dom';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ErrorBanner } from '@/components/ui/error-banner';
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
import { LIST_ID_LINK } from '@/lib/link-styles';
import { formatSociety, sortSocieties } from '@/lib/society';
import { usePrimaryEvacList, usePrimaryEvacStats } from '@/shared/api';
import { RefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { PrimaryEvacStats } from './primary-evac-stats';

const PAGE_SIZE = 10;

function fmtKg(kg: number): string {
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function formatWarehouse(w: string): string {
  // Just the district/depot name — the warehouse icon already conveys
  // the type, so a trailing "Warehouse" would be redundant.
  const name = w
    .replace(/[\s_]*warehouse\s*$/i, '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return name || 'Warehouse';
}

function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function PrimaryEvacPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.primaryEvac') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const warehouseParam = searchParams.get('warehouse') ?? '';
  const societyParam = searchParams.get('society') ?? '';
  const dateFromParam = searchParams.get('dateFrom') ?? '';
  const dateToParam = searchParams.get('dateTo') ?? '';
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

  const { data: stats } = usePrimaryEvacStats();
  const {
    data: list,
    isLoading,
    isValidating,
    error,
  } = usePrimaryEvacList({
    page,
    pageSize: PAGE_SIZE,
    q: urlQ.trim() || undefined,
    warehouse: warehouseParam || undefined,
    society: societyParam || undefined,
    dateFrom: dateFromParam || undefined,
    dateTo: dateToParam || undefined,
    sort,
  });

  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-foreground">{t('primaryEvac.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('primaryEvac.subtitle')}</p>
        </div>
        <Link
          to="/notifications?entityTable=primary_evacuation_lots"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium text-foreground text-sm shadow-sm hover:bg-accent"
        >
          <History className="size-3.5" />
          {t('primaryEvac.history')}
        </Link>
      </header>

      <PrimaryEvacStats stats={stats} filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-3"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('primaryEvac.filters.searchPlaceholder')}
          />
          <Select
            value={warehouseParam || undefined}
            onValueChange={(v) => updateUrl({ warehouse: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={
                warehouseParam ? () => updateUrl({ warehouse: null, page: null }) : undefined
              }
            >
              <Warehouse className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('primaryEvac.filters.warehouseAll')} />
            </SelectTrigger>
            <SelectContent>
              {(stats?.warehouses ?? []).map((w) => (
                <SelectItem key={w.warehouse} value={w.warehouse}>
                  {formatWarehouse(w.warehouse)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={societyParam || undefined}
            onValueChange={(v) => updateUrl({ society: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={societyParam ? () => updateUrl({ society: null, page: null }) : undefined}
            >
              <Building2 className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('primaryEvac.filters.societyAll')} />
            </SelectTrigger>
            <SelectContent>
              {sortSocieties(stats?.societies ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {formatSociety(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangePicker
            value={{ from: parseIsoDate(dateFromParam), to: parseIsoDate(dateToParam) }}
            onChange={(r) =>
              updateUrl({
                dateFrom: r.from ? fmtIsoDate(r.from) : null,
                dateTo: r.to ? fmtIsoDate(r.to) : null,
                page: null,
              })
            }
            placeholder={t('primaryEvac.filters.dateRangeAll')}
          />
        </div>
        {(urlQ || warehouseParam || societyParam || dateFromParam || dateToParam || hasSort) && (
          <button
            type="button"
            onClick={() => {
              updateUrl({
                q: null,
                warehouse: null,
                society: null,
                dateFrom: null,
                dateTo: null,
                sort: null,
                page: null,
              });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('primaryEvac.filters.reset')}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error.message ?? String(error)} />}

      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted p-0">
                  <ColumnSorter
                    {...sorterPropsFor('waybill')}
                    label={t('primaryEvac.col.waybill')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('date')} label={t('primaryEvac.col.date')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('source')} label={t('primaryEvac.col.source')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('society')}
                    label={t('primaryEvac.col.society')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('destination')}
                    label={t('primaryEvac.col.destination')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('bags')}
                    label={t('primaryEvac.col.bags')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('weight')}
                    label={t('primaryEvac.col.weight')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="text-right">{t('primaryEvac.col.purchases')}</TableHead>
                <TableHead className="text-right">{t('primaryEvac.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-12 text-center text-muted-foreground">
                    {t('primaryEvac.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow key={row.id} className="group/row hover:bg-muted">
                    <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                      <Link
                        to={`/primary-evacuation/${row.primaryWaybillNumber}`}
                        className={LIST_ID_LINK}
                      >
                        {row.primaryWaybillNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{row.evacuationDate}</TableCell>
                    <TableCell>
                      {/* Purchasing clerk over their station mark — no route
                          for either, so no link. */}
                      <RefCell name={row.pcName} code={row.stationMarkNumber ?? '—'} />
                    </TableCell>
                    <TableCell>
                      {row.society ? (
                        <StatusTag tone="lime">
                          <LandPlot className="size-3" />
                          {formatSociety(row.society)}
                        </StatusTag>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusTag tone="success">
                        <Warehouse className="size-3" />
                        {formatWarehouse(row.districtWarehouse)}
                      </StatusTag>
                    </TableCell>
                    <TableCell className="text-right font-medium">{row.bagsReceived}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {fmtKg(row.kgReceived)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        title={intl.formatMessage(
                          { id: 'primaryEvac.purchasesTitle' },
                          { matched: row.childPurchaseMatched, total: row.childPurchaseCount },
                        )}
                        className="inline-flex"
                      >
                        <StatusTag tone="info">
                          <ShoppingCart className="size-3" />
                          {row.childPurchaseCount}
                        </StatusTag>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/primary-evacuation/${row.primaryWaybillNumber}`}
                        aria-label={t('primaryEvac.action.open')}
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

        <div className="flex shrink-0 items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {intl.formatMessage(
              { id: 'primaryEvac.pagination.showing' },
              {
                from: total === 0 ? 0 : offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              },
            )}
            {isValidating && items.length > 0 && (
              <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </span>
          {totalPages > 1 && (
            <DataPagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => updateUrl({ page: p === 1 ? null : p })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
