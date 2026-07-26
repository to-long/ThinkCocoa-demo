/**
 * Farmer Coaching list — mirrors the Pencil `XXipo` design.
 *
 * Columns: Visit date · Farmer · Coach · Society · GAP / overall ·
 *          CLMRS risk · Follow-up · Actions.
 * Filters: search · CLMRS risk · follow-up only.
 *
 * URL-backed pagination + filters so deep-links and back-button
 * behave like the rest of the app (same convention as inspections).
 */

import {
  Eye,
  LandPlot,
  Loader2,
  ShieldAlert,
  SquareArrowOutUpRight,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LIST_SUB_LINK } from '@/lib/link-styles';
import { formatSociety } from '@/lib/society';
import { useCoachingStats, useCoachingVisitsList } from '@/shared/api';
import { FarmerRefCell, ParcelRefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { CoachingStats } from './coaching-stats';

const PAGE_SIZE = 10;

const RISK_TONE: Record<string, StatusTone> = {
  no_risk: 'success',
  at_risk: 'caution',
  case: 'danger',
};

function scoreColor(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground';
  if (pct >= 85) return 'text-green-700 font-medium';
  if (pct >= 70) return 'text-yellow-800 font-medium';
  return 'text-red-700 font-medium';
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

export function CoachingPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  useBreadcrumb([{ label: t('navigation.coaching') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const riskParam = searchParams.get('risk') ?? '';
  const coachParam = searchParams.get('coach') ?? '';
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

  const { data: stats } = useCoachingStats();
  const {
    data: list,
    isLoading,
    isValidating,
    error,
  } = useCoachingVisitsList({
    page,
    pageSize: PAGE_SIZE,
    q: urlQ.trim() || undefined,
    clmrsRisk: riskParam || undefined,
    coaches: coachParam || undefined,
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
        <h1 className="font-semibold text-2xl text-foreground">{t('coaching.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('coaching.subtitle')}</p>
      </header>

      <CoachingStats stats={stats} filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-3"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('coaching.filters.searchPlaceholder')}
          />
          <Select
            value={coachParam || undefined}
            onValueChange={(v) => updateUrl({ coach: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={coachParam ? () => updateUrl({ coach: null, page: null }) : undefined}
            >
              <User className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('coaching.filters.coachAll')} />
            </SelectTrigger>
            <SelectContent>
              {(stats?.coaches ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={riskParam || undefined}
            onValueChange={(v) => updateUrl({ risk: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={riskParam ? () => updateUrl({ risk: null, page: null }) : undefined}
            >
              <ShieldAlert className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('coaching.filters.riskAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no_risk">{t('coaching.risk.no_risk')}</SelectItem>
              <SelectItem value="at_risk">{t('coaching.risk.at_risk')}</SelectItem>
              <SelectItem value="case">{t('coaching.risk.case')}</SelectItem>
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
            placeholder={t('coaching.filters.dateRangeAll')}
          />
        </div>
        {(urlQ || coachParam || riskParam || dateFromParam || dateToParam || hasSort) && (
          <button
            type="button"
            onClick={() => {
              updateUrl({
                q: null,
                coach: null,
                risk: null,
                dateFrom: null,
                dateTo: null,
                sort: null,
                page: null,
              });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('coaching.filters.reset')}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error.message ?? String(error)} />}

      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-20 bg-muted p-0">
                  <ColumnSorter {...sorterPropsFor('coach')} label={t('coaching.col.coach')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('farmer')} label={t('coaching.col.farmer')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('parcel_name')}
                    label={t('coaching.col.parcel')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('society')} label={t('coaching.col.society')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('score')}
                    label={t('coaching.col.score')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('clmrs')} label={t('coaching.col.clmrs')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('follow_up')}
                    label={t('coaching.col.followUp')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('corrective_actions')}
                    label={t('coaching.col.correctiveActions')}
                  />
                </TableHead>
                <TableHead>{t('coaching.col.activities')}</TableHead>
                <TableHead className="text-right">{t('coaching.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-12 text-center text-muted-foreground">
                    {t('coaching.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => {
                  const risk = row.clmrsRiskLevel ?? 'no_risk';
                  const activityTotal =
                    row.nChemicalApps +
                    row.nFertilizerApps +
                    row.nWeedingActs +
                    row.nPruningActs +
                    row.nHarvestActs +
                    row.nOtherActs;
                  return (
                    <TableRow key={row.id} className="group/row hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex flex-col gap-1 leading-tight">
                          <span className="truncate font-medium">{row.coachName ?? '—'}</span>
                          {row.visitDate && (
                            <Link to={`/coaching/${row.id}`} className={LIST_SUB_LINK}>
                              {row.visitDate}
                              <SquareArrowOutUpRight className="size-3" />
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <FarmerRefCell farmerName={row.farmerName} farmerCode={row.farmerCode} />
                      </TableCell>
                      <TableCell>
                        <ParcelRefCell parcelName={row.parcelName} parcelId={row.parcelId} />
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
                      <TableCell className={`text-right ${scoreColor(row.overallScore)}`}>
                        {row.overallScore != null ? `${row.overallScore}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={RISK_TONE[risk] ?? 'neutral'}>
                          {t(`coaching.risk.${risk}`)}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        {row.followUpRequired ? (
                          <span className="text-foreground text-sm">
                            {row.followUpDate ?? t('coaching.followUp.required')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.correctiveActions > 0 ? (
                          <StatusTag tone="caution">
                            <TriangleAlert className="size-3" />
                            {row.correctiveActions}
                          </StatusTag>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-foreground text-sm">{activityTotal}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          aria-label={t('coaching.action.open')}
                          className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() => navigate(`/coaching/${row.id}`)}
                        >
                          <Eye className="size-4" />
                        </button>
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
              { id: 'coaching.pagination.showing' },
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
