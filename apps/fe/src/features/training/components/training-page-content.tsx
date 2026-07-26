/**
 * Farmer Training list — mirrors the Pencil `zQKxN` design.
 *
 * Columns: Date · Program · Topics · Location · Trainer · Attendance ·
 *          Consent · Actions.
 *
 * Same URL-backed filter/pagination convention as inspections/coaching.
 */

import {
  Building2,
  Eye,
  GraduationCap,
  LandPlot,
  Loader2,
  SquareArrowOutUpRight,
  Tag,
} from 'lucide-react';
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
import { formatSociety, sortSocieties } from '@/lib/society';
import { useTrainingSessionsList, useTrainingStats } from '@/shared/api';
import { RefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { TrainingStats } from './training-stats';

const PAGE_SIZE = 10;

/**
 * Program chips are all `info` (blue). Per-program tones were dropped —
 * the programme name is a label, not a status, so colour-coding it read
 * as severity and the keys drifted from the stored values anyway.
 */
const PROGRAM_TONE: StatusTone = 'info';

/** Data-collection consent rate → tone. ≥85% green, 50–85% amber, <50% red. */
function consentTone(pct: number): StatusTone {
  if (pct >= 85) return 'success';
  if (pct >= 50) return 'caution';
  return 'danger';
}

function formatProgramLabel(p: string | null): string {
  if (!p) return '—';
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

export function TrainingPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  useBreadcrumb([{ label: t('navigation.training') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const programParam = searchParams.get('program') ?? '';
  const topicParam = searchParams.get('topic') ?? '';
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

  const { data: stats } = useTrainingStats();
  const {
    data: list,
    isLoading,
    isValidating,
    error,
  } = useTrainingSessionsList({
    page,
    pageSize: PAGE_SIZE,
    q: urlQ.trim() || undefined,
    programs: programParam || undefined,
    topics: topicParam || undefined,
    societies: societyParam || undefined,
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
        <h1 className="font-semibold text-2xl text-foreground">{t('training.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('training.subtitle')}</p>
      </header>

      <TrainingStats stats={stats} filteredCount={total} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-2"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('training.filters.searchPlaceholder')}
          />
          <Select
            value={programParam || undefined}
            onValueChange={(v) => updateUrl({ program: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={programParam ? () => updateUrl({ program: null, page: null }) : undefined}
            >
              <GraduationCap className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('training.filters.programAll')} />
            </SelectTrigger>
            <SelectContent>
              {(stats?.programs ?? []).map((p) => (
                <SelectItem key={p} value={p}>
                  {formatProgramLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={topicParam || undefined}
            onValueChange={(v) => updateUrl({ topic: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={topicParam ? () => updateUrl({ topic: null, page: null }) : undefined}
            >
              <Tag className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('training.filters.topicAll')} />
            </SelectTrigger>
            <SelectContent>
              {(stats?.topics ?? []).map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {formatLabel(tp)}
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
              <SelectValue placeholder={t('training.filters.societyAll')} />
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
            placeholder={t('training.filters.dateRangeAll')}
          />
        </div>
        {(urlQ ||
          programParam ||
          topicParam ||
          societyParam ||
          dateFromParam ||
          dateToParam ||
          hasSort) && (
          <button
            type="button"
            onClick={() => {
              updateUrl({
                q: null,
                program: null,
                topic: null,
                society: null,
                dateFrom: null,
                dateTo: null,
                sort: null,
                page: null,
              });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('training.filters.reset')}
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
                  <ColumnSorter {...sorterPropsFor('trainer')} label={t('training.col.trainer')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter {...sorterPropsFor('program')} label={t('training.col.program')} />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('location')}
                    label={t('training.col.location')}
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('attendance')}
                    label={t('training.col.attendance')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="p-0">
                  <ColumnSorter
                    {...sorterPropsFor('consent')}
                    label={t('training.col.consent')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="text-right">{t('training.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-12 text-center text-muted-foreground">
                    {t('training.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => {
                  const consent = row.consentRate;
                  return (
                    <TableRow key={row.id} className="group/row hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex flex-col gap-1 leading-tight">
                          <span className="truncate font-medium">{row.trainerName ?? '—'}</span>
                          {row.trainingDate && (
                            <Link to={`/training/${row.id}`} className={LIST_SUB_LINK}>
                              {row.trainingDate}
                              <SquareArrowOutUpRight className="size-3" />
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.program ? (
                          <StatusTag tone={PROGRAM_TONE}>
                            {formatProgramLabel(row.program)}
                          </StatusTag>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Society chip over the venue — no basePath, so the
                            venue line renders as plain muted text. */}
                        <RefCell
                          name={
                            row.society ? (
                              <StatusTag tone="lime">
                                <LandPlot className="size-3" />
                                {formatSociety(row.society)}
                              </StatusTag>
                            ) : null
                          }
                          code={[row.venue, row.district].filter(Boolean).join(' · ') || '—'}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <RefCell
                          align="end"
                          name={row.totalParticipants ?? 0}
                          code={`${row.numMale ?? 0}M · ${row.numFemale ?? 0}F`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {consent == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <StatusTag tone={consentTone(consent)}>{consent}%</StatusTag>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/training/${row.id}`}
                          aria-label={t('training.action.open')}
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

        <div className="flex shrink-0 items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {intl.formatMessage(
              { id: 'training.pagination.showing' },
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
