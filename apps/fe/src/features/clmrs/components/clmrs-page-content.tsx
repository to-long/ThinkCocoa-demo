/**
 * CLMRS unified list — every child observation (flag) with its case
 * fields joined in when a case has been opened.
 *
 * Row states (encoded via the CLMRS Case column + Action):
 *   • no case yet  → CLMRS Case shows "—", Action = "Create case"
 *   • case open    → CLMRS Case shows the clmrs_code + open pill,
 *                    Action = eye icon → /clmrs/cases/:id
 *   • case closed  → CLMRS Case shows the clmrs_code + closed pill,
 *                    Action = eye icon → /clmrs/cases/:id
 *
 * The Status filter dropdown collapses those three states into a
 * single filter surface: pending | open | closed.
 */

import { AlertTriangle, Eye, ShieldAlert, SquareArrowOutUpRight } from 'lucide-react';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { LIST_SUB_LINK } from '@/lib/link-styles';
import { useClmrsRecords } from '@/shared/api/clmrs';
import { FarmerRefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { selectActiveCoop, useActiveCoop } from '@/shared/store/useActiveCoop';
import type { ClmrsRecord } from '../lib/mock';
import { ClmrsStats } from './clmrs-stats';

const PAGE_SIZE = 10;

type StatusFilter = '' | 'pending' | 'open' | 'closed';

function recordStatus(r: ClmrsRecord): 'pending' | 'open' | 'closed' {
  if (!r.case) return 'pending';
  return r.case.status;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDob(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function ClmrsPageContent() {
  const intl = useIntl();
  const navigate = useNavigate();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.clmrs') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = (searchParams.get('status') ?? '') as StatusFilter;
  const source = searchParams.get('source') ?? '';
  const pageParsed = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;
  const activeCoop = useActiveCoop(selectActiveCoop);
  const { data: clmrsData } = useClmrsRecords(activeCoop?.cooperativeCode ?? null);
  const records = clmrsData?.records ?? [];

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

  const filtered = useMemo(() => {
    const trimmed = q.trim().toLowerCase();
    const scopeCode = activeCoop?.cooperativeCode?.toUpperCase() ?? null;
    return records.filter((r) => {
      const f = r.flag;
      if (scopeCode && f.cooperativeCode.toUpperCase() !== scopeCode) return false;
      if (source && f.source !== source) return false;
      if (status && recordStatus(r) !== status) return false;
      if (trimmed) {
        const hay =
          `${f.childNameDisplay} ${f.farmerName} ${f.farmerId} ${f.cooperativeName} ${r.case?.clmrsCode ?? ''}`.toLowerCase();
        if (!hay.includes(trimmed)) return false;
      }
      return true;
    });
  }, [q, status, source, activeCoop, clmrsData]);

  // Client-side sort over the mock records, URL-backed via the shared
  // sort hook so behaviour matches every other list screen.
  const { hasSort, sortSpec, sorterPropsFor } = useTableSort();
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortSpec.length === 0) return arr;
    const byField = (field: string, a: ClmrsRecord, b: ClmrsRecord): number => {
      switch (field) {
        case 'child':
          return a.flag.childNameDisplay.localeCompare(b.flag.childNameDisplay);
        case 'farmer':
          return (a.flag.farmerName ?? '').localeCompare(b.flag.farmerName ?? '');
        case 'source':
          return a.flag.source.localeCompare(b.flag.source);
        case 'activities':
          return a.flag.flaggedActivities.length - b.flag.flaggedActivities.length;
        case 'status':
          return recordStatus(a).localeCompare(recordStatus(b));
        case 'code':
          return (a.case?.clmrsCode ?? '').localeCompare(b.case?.clmrsCode ?? '');
        case 'last_visit':
          return (a.case?.lastVisitDate ?? '').localeCompare(b.case?.lastVisitDate ?? '');
        default:
          return 0;
      }
    };
    arr.sort((a, b) => {
      for (const { field, dir } of sortSpec) {
        const c = byField(field, a, b) * (dir === 'desc' ? -1 : 1);
        if (c !== 0) return c;
      }
      return 0;
    });
    return arr;
  }, [filtered, sortSpec]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;
  const items = sorted.slice(offset, offset + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl text-foreground">{t('clmrs.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('clmrs.subtitle')}</p>
      </header>

      <ClmrsStats />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-4"
            value={q}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('clmrs.filters.searchPlaceholder')}
          />
          <Select
            value={source || undefined}
            onValueChange={(v) => updateUrl({ source: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={source ? () => updateUrl({ source: null, page: null }) : undefined}
            >
              <AlertTriangle className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('clmrs.filters.sourceAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="household_visit">{t('clmrs.filters.sourceHousehold')}</SelectItem>
              <SelectItem value="farm_visit">{t('clmrs.filters.sourceFarm')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status || undefined}
            onValueChange={(v) => updateUrl({ status: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={status ? () => updateUrl({ status: null, page: null }) : undefined}
            >
              <ShieldAlert className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('clmrs.filters.statusAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{t('clmrs.status.pending')}</SelectItem>
              <SelectItem value="open">{t('clmrs.status.open')}</SelectItem>
              <SelectItem value="closed">{t('clmrs.status.closed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(q || status || source || hasSort) && (
          <button
            type="button"
            onClick={() =>
              updateUrl({ q: null, status: null, source: null, sort: null, page: null })
            }
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('clmrs.filters.reset')}
          </button>
        )}
      </div>

      {/* Table + pager wrapper — pinned under the AppHeader (`top-12`)
          and viewport-tall, so the table scrolls (both axes) inside, the
          header freezes at its top, and the pager stays at the bottom
          (matches the farmers list). The inner box owns scroll; the Table
          primitive's own container is `overflow-visible` so the sticky
          header + sticky first column both anchor to the inner box. */}
      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
          <Table className="table-fixed" containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-20 w-[200px] bg-muted p-0">
                  <ColumnSorter {...sorterPropsFor('child')} label={t('clmrs.table.child')} />
                </TableHead>
                <TableHead className="w-[200px] p-0">
                  <ColumnSorter {...sorterPropsFor('farmer')} label={t('clmrs.table.farmer')} />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter {...sorterPropsFor('source')} label={t('clmrs.table.source')} />
                </TableHead>
                <TableHead className="w-[110px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('activities')}
                    label={t('clmrs.table.activities')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[140px] p-0">
                  <ColumnSorter {...sorterPropsFor('status')} label={t('clmrs.table.caseStatus')} />
                </TableHead>
                <TableHead className="w-[160px] p-0">
                  <ColumnSorter {...sorterPropsFor('code')} label={t('clmrs.table.clmrsCode')} />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('last_visit')}
                    label={t('clmrs.table.lastVisit')}
                  />
                </TableHead>
                <TableHead className="w-[60px] text-right">{t('clmrs.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {t('clmrs.empty.records')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => {
                  const f = r.flag;
                  const c = r.case;
                  return (
                    <TableRow
                      key={f.childId}
                      className="group/row h-[52px] cursor-pointer text-[13px] hover:bg-muted"
                      onClick={() => navigate(`/clmrs/${f.childId}`)}
                    >
                      <TableCell className="sticky left-0 z-10 w-[200px] bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex flex-col gap-1 leading-tight">
                          <span className="font-medium text-foreground">{f.childNameDisplay}</span>
                          {f.childDob && (
                            <Link
                              to={`/clmrs/${f.childId}`}
                              onClick={(e) => e.stopPropagation()}
                              className={LIST_SUB_LINK}
                            >
                              {formatDob(f.childDob)}
                              <SquareArrowOutUpRight className="size-3" />
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <FarmerRefCell
                          farmerName={f.farmerName}
                          farmerCode={f.farmerId}
                          stopRowClick
                        />
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={f.source === 'household_visit' ? 'info' : 'lime'}>
                          {f.source === 'household_visit'
                            ? t('clmrs.source.householdVisit')
                            : t('clmrs.source.farmVisit')}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusTag tone="caution">
                          <AlertTriangle className="size-3" />
                          {f.flaggedActivities.length}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        {c ? (
                          <StatusTag tone={c.status === 'open' ? 'danger' : 'caution'}>
                            {c.status === 'open'
                              ? t('clmrs.status.open')
                              : t('clmrs.status.closed')}
                          </StatusTag>
                        ) : (
                          <StatusTag tone="success">{t('clmrs.status.pending')}</StatusTag>
                        )}
                      </TableCell>
                      <TableCell>
                        {c ? (
                          <span className="font-mono text-[12px] text-foreground">
                            {c.clmrsCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(c?.lastVisitDate ?? null)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/clmrs/${f.childId}`}
                          aria-label={t('clmrs.action.view')}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex cursor-pointer items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
