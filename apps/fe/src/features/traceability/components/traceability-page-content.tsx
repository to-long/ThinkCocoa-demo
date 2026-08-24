/**
 * Traceability — Secondary Evacuation (export lots) list.
 *
 * Mirrors the Pencil `fAjt4` design: KPI strip + filters + table of
 * lots ready for export. Forward chain ends at the port: each lot's
 * primary-waybill children link upstream to primary_evacuation.lots.
 */

import { Anchor, Award, Eye, Loader2, Package, Ship, Truck, Warehouse } from 'lucide-react';
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
import { useSecondaryEvacList, useSecondaryEvacStats } from '@/shared/api';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { TraceabilityStats } from './traceability-stats';

const PAGE_SIZE = 10;

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtKg(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${kg.toFixed(0)} kg`;
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

export function TraceabilityPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.secondaryEvac') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const depotParam = searchParams.get('depot') ?? '';
  const portParam = searchParams.get('port') ?? '';
  const gradeParam = searchParams.get('grade') ?? '';
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

  const { data: stats } = useSecondaryEvacStats();
  const {
    data: list,
    isLoading,
    isValidating,
    error,
  } = useSecondaryEvacList({
    page,
    pageSize: PAGE_SIZE,
    q: urlQ.trim() || undefined,
    depot: depotParam || undefined,
    port: portParam || undefined,
    grade: gradeParam || undefined,
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
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('traceability.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('traceability.subtitle')}</p>
      </header>

      <TraceabilityStats stats={stats} filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-2"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('traceability.filters.searchPlaceholder')}
          />
          <Select
            value={depotParam || undefined}
            onValueChange={(v) => updateUrl({ depot: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={depotParam ? () => updateUrl({ depot: null, page: null }) : undefined}
            >
              <Warehouse className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('traceability.filters.depotAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sankofa_warehouse">Sankofa</SelectItem>
              <SelectItem value="nkabom_warehouse">Nkabom</SelectItem>
              <SelectItem value="adwuma_warehouse">Adwuma</SelectItem>
              <SelectItem value="aboma_warehouse">Aboma</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={portParam || undefined}
            onValueChange={(v) => updateUrl({ port: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={portParam ? () => updateUrl({ port: null, page: null }) : undefined}
            >
              <Ship className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('traceability.filters.portAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="takoradi">Takoradi</SelectItem>
              <SelectItem value="tema">Tema</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={gradeParam || undefined}
            onValueChange={(v) => updateUrl({ grade: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={gradeParam ? () => updateUrl({ grade: null, page: null }) : undefined}
            >
              <Award className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('traceability.filters.gradeAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grade_1">Grade 1</SelectItem>
              <SelectItem value="grade_2">Grade 2</SelectItem>
              <SelectItem value="grade_3">Grade 3</SelectItem>
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
            placeholder={t('traceability.filters.dateRangeAll')}
          />
        </div>
        {(urlQ ||
          depotParam ||
          portParam ||
          gradeParam ||
          dateFromParam ||
          dateToParam ||
          hasSort) && (
          <button
            type="button"
            onClick={() => {
              updateUrl({
                q: null,
                depot: null,
                port: null,
                grade: null,
                dateFrom: null,
                dateTo: null,
                sort: null,
                page: null,
              });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('traceability.filters.reset')}
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
                    label={t('traceability.col.waybill')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('date')} label={t('traceability.col.date')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('origin')}
                    label={t('traceability.col.origin')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('port')} label={t('traceability.col.port')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('grade')} label={t('traceability.col.grade')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('bags')}
                    label={t('traceability.col.bags')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('weight')}
                    label={t('traceability.col.weight')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="text-right">{t('traceability.col.primaries')}</TableHead>
                <TableHead className="text-right">{t('traceability.col.actions')}</TableHead>
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
                    {t('traceability.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => {
                  return (
                    <TableRow key={row.id} className="group/row hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <Link
                          to={`/secondary-evacuation/${row.secondaryWaybillNumber}`}
                          className={LIST_ID_LINK}
                        >
                          {row.secondaryWaybillNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{row.evacuationDate}</TableCell>
                      <TableCell>
                        <StatusTag tone="success">
                          <Warehouse className="size-3" />
                          {formatLabel(row.depotOrigin.replace(/[\s_]*warehouse\s*$/i, ''))}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        <StatusTag tone="info">
                          <Anchor className="size-3" />
                          {formatLabel(row.portDestination.replace(/[\s_]*port\s*$/i, ''))}
                        </StatusTag>
                      </TableCell>
                      <TableCell>{formatLabel(row.beanGrade)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {row.bagsLoaded.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtKg(row.bagsLoaded * 64)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          title={intl.formatMessage(
                            { id: 'traceability.primariesTitle' },
                            { matched: row.primaryLotMatched, total: row.primaryLotCount },
                          )}
                          className="inline-flex"
                        >
                          <StatusTag tone="info2">
                            <Truck className="size-3" />
                            {row.primaryLotCount}
                          </StatusTag>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/secondary-evacuation/${row.secondaryWaybillNumber}`}
                          aria-label={t('traceability.action.open')}
                          className="inline-flex cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Eye className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex shrink-0 items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {intl.formatMessage(
              { id: 'traceability.pagination.showing' },
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

// Re-export icons used by parent layouts (helps Vite tree-shaking when
// the file is the only entry-point for these glyphs).
export { Package, Ship };
