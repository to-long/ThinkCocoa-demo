/**
 * Inspections list — mirrors the Pencil `fw5OW` design.
 *
 * Columns: Inspector · Date ↓ · Farmer · Farmer ID · Parcel ID ·
 *          Society · EUDR · Compliance · Actions.
 *
 * Filters: search (q), EUDR status, compliance bucket. URL-backed
 * pagination so direct-links + back-button work the same as the
 * other list pages in this app.
 */

import {
  Eye,
  History,
  LandPlot,
  Leaf,
  Loader2,
  ShieldCheck,
  SquareArrowOutUpRight,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
import { PermissionGate } from '@/features/auth';
import { CertificationOutcomeBadge } from '@/features/farmers/components/certification-outcome-badge';
import { LIST_SUB_LINK } from '@/lib/link-styles';
import { formatSociety } from '@/lib/society';
import { useInspectionStats, useInspectionsList } from '@/shared/api';
import { FarmerRefCell, ParcelRefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { InspectionsStats } from './inspections-stats';

const PAGE_LIMIT = 10;

const EUDR_TONE: Record<string, StatusTone> = {
  compliant: 'success',
  non_compliant: 'danger',
  needs_review: 'caution',
  unknown: 'neutral',
};

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

export function InspectionsPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  useBreadcrumb([{ label: t('inspections.title') }]);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const eudrParam = searchParams.get('eudr') ?? '';
  const complianceParam = searchParams.get('compliance') ?? '';
  const inspectorParam = searchParams.get('inspector') ?? '';
  const dateFromParam = searchParams.get('dateFrom') ?? '';
  const dateToParam = searchParams.get('dateTo') ?? '';
  const { sort, hasSort, sorterPropsFor } = useTableSort();
  const pageParsed = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  const updateUrl = (updates: Record<string, string | number | null>) => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '' || v === undefined) out.delete(k);
          else out.set(k, String(v));
        }
        return out;
      },
      { replace: true },
    );
  };

  const {
    data: listResp,
    isLoading,
    isValidating,
    error: listError,
  } = useInspectionsList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ.trim() || undefined,
    eudr: eudrParam || undefined,
    compliance: complianceParam || undefined,
    inspector: inspectorParam || undefined,
    dateFrom: dateFromParam || undefined,
    dateTo: dateToParam || undefined,
    sort,
  });

  const { data: stats } = useInspectionStats();

  // Inspector list — distinct values currently visible in the page. Not
  // exhaustive (only the page items), but the dropdown still works for
  // the common case where a coop has ~5 inspectors. Move to a dedicated
  // endpoint if the list grows past one page.
  const inspectorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of listResp?.items ?? []) {
      if (it.inspectorCode) set.add(it.inspectorCode);
    }
    if (inspectorParam) set.add(inspectorParam);
    return [...set].sort();
  }, [listResp, inspectorParam]);

  // Sync handler — fire-and-forget. The BE returns 202 immediately,
  // runs the Kobo pull in the background, and writes an audit-log
  // notification when it finishes (which the notification bell
  // surfaces via SSE). Admin sees a "sync started" toast right away
  // and a "sync completed" notification in the bell when it's done.
  // No need to keep the button spinning beyond the trigger ACK.
  const items = listResp?.items ?? [];
  const total = listResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const initialLoading = isLoading && !listResp;
  const refetching = isValidating && !!listResp;

  return (
    <div className="flex flex-col gap-4">
      {/* Header row — title on the left, History on the right.
          Settings + Sync moved to /admin/sync (per-form Run + Edit
          for all 13 Kobo forms — keeping them inline here was
          redundant + only covered the inspection job). */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{t('inspections.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('inspections.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <PermissionGate codes={['inspection:notification']}>
            <Button variant="outline" asChild>
              <Link to="/notifications?entity=inspections">
                <History className="size-4" />
                {t('common.history')}
              </Link>
            </Button>
          </PermissionGate>
          {/* Settings + Sync buttons live on /admin/sync now — that
              page lists ALL 13 Kobo forms with per-form Run + Edit
              actions. Keeping them here was redundant. */}
        </div>
      </div>

      <InspectionsStats stats={stats} filteredCount={total} />

      {/* Filter row — search + 5 controls + Reset on the shared grid. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-2"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('inspections.filters.searchPlaceholder')}
          />
          <Select
            value={eudrParam || undefined}
            onValueChange={(v) => updateUrl({ eudr: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={eudrParam ? () => updateUrl({ eudr: null, page: null }) : undefined}
            >
              <Leaf className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('inspections.filters.allEudr')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compliant">{t('inspections.eudr.compliant')}</SelectItem>
              <SelectItem value="needs_review">{t('inspections.eudr.needs_review')}</SelectItem>
              <SelectItem value="non_compliant">{t('inspections.eudr.non_compliant')}</SelectItem>
              <SelectItem value="unknown">{t('inspections.eudr.unknown')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={inspectorParam || undefined}
            onValueChange={(v) => updateUrl({ inspector: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={
                inspectorParam ? () => updateUrl({ inspector: null, page: null }) : undefined
              }
            >
              <User className="size-4 text-muted-foreground" />
              <SelectValue
                placeholder={`${t('inspections.filters.inspectorLabel')} ${t('inspections.filters.inspectorAll')}`}
              />
            </SelectTrigger>
            <SelectContent>
              {inspectorOptions.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
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
            placeholder={t('inspections.filters.dateAll')}
          />
          <Select
            value={complianceParam || undefined}
            onValueChange={(v) => updateUrl({ compliance: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={
                complianceParam ? () => updateUrl({ compliance: null, page: null }) : undefined
              }
            >
              <ShieldCheck className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('inspections.filters.allCertificate')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="certified">
                {t('farmers.certification.outcome.certified')}
              </SelectItem>
              <SelectItem value="certified_with_ca">
                {t('farmers.certification.outcome.certified_with_ca')}
              </SelectItem>
              <SelectItem value="not_certified">
                {t('farmers.certification.outcome.not_certified')}
              </SelectItem>
              <SelectItem value="disqualified">
                {t('farmers.certification.outcome.disqualified')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(urlQ ||
          eudrParam ||
          inspectorParam ||
          complianceParam ||
          dateFromParam ||
          dateToParam ||
          hasSort) && (
          <button
            type="button"
            onClick={() => {
              setSearchParams({}, { replace: true });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('inspections.filters.reset')}
          </button>
        )}
      </div>

      {listError && <ErrorBanner message={(listError as Error).message} />}

      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
          <Table className="min-w-[1080px] table-fixed" containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-20 w-[160px] bg-muted p-0">
                  <ColumnSorter
                    {...sorterPropsFor('inspector')}
                    label={t('inspections.table.inspector')}
                  />
                </TableHead>
                {/* Farmer = name (top) + farmer-ID link (bottom); Parcel
                  = field-ID link. Consolidated to match coaching /
                  farms lists. */}
                <TableHead className="w-[200px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('farmer')}
                    label={t('inspections.table.farmer')}
                  />
                </TableHead>
                <TableHead className="w-[150px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('parcel_name')}
                    label={t('inspections.table.parcel')}
                  />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('society')}
                    label={t('inspections.table.society')}
                  />
                </TableHead>
                <TableHead className="w-[140px] p-0">
                  <ColumnSorter {...sorterPropsFor('eudr')} label={t('inspections.table.eudr')} />
                </TableHead>
                <TableHead className="w-[180px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('certification')}
                    label={t('farmers.table.certificate')}
                  />
                </TableHead>
                <TableHead className="w-[130px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('corrective_actions')}
                    label={t('inspections.table.correctiveActions')}
                  />
                </TableHead>
                <TableHead className="w-[80px] text-right">
                  {t('inspections.table.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody style={refetching ? { opacity: 0.85 } : undefined}>
              {initialLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {t('inspections.table.noInspections')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((i) => {
                  const eudrKey = i.eudrStatus ?? 'unknown';
                  return (
                    <TableRow
                      key={i.id}
                      className="group/row h-[41px] [&_td]:py-2 [&_td]:leading-[25px] text-[13px] cursor-pointer hover:bg-muted"
                      onClick={() => navigate(`/inspections/${encodeURIComponent(i.id)}`)}
                    >
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex flex-col gap-1 leading-tight">
                          <span className="truncate font-medium">{i.inspectorCode ?? '—'}</span>
                          {i.dateInspection && (
                            <Link
                              to={`/inspections/${encodeURIComponent(i.id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className={LIST_SUB_LINK}
                            >
                              {i.dateInspection}
                              <SquareArrowOutUpRight className="size-3" />
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      {/* Farmer — name on top, farmer-ID + cross-ref link
                        below (gated by farmer:read). stopRowClick so the
                        link doesn't also fire the row's
                        navigate-to-inspection handler. */}
                      <TableCell>
                        <FarmerRefCell
                          farmerName={i.farmerName}
                          farmerCode={i.farmerId}
                          stopRowClick
                        />
                      </TableCell>
                      {/* Parcel — name on top, field-ID + cross-ref link to /farms. */}
                      <TableCell>
                        <ParcelRefCell
                          parcelName={i.parcelName}
                          parcelId={i.parcelId}
                          stopRowClick
                        />
                      </TableCell>
                      <TableCell>
                        {i.society ? (
                          <StatusTag tone="lime">
                            <LandPlot className="size-3" />
                            {formatSociety(i.society)}
                          </StatusTag>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={EUDR_TONE[eudrKey] ?? 'neutral'} dot>
                          {t(`inspections.eudr.${eudrKey}`)}
                        </StatusTag>
                      </TableCell>
                      <TableCell>
                        <CertificationOutcomeBadge outcome={i.certificationOutcome} />
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const n = i.followUps.filter((f) => f.status !== 'done').length;
                          return n > 0 ? (
                            <StatusTag tone="caution">
                              <TriangleAlert className="size-3" />
                              {n}
                            </StatusTag>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          title={t('inspections.table.view')}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/inspections/${encodeURIComponent(i.id)}`);
                          }}
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <Eye className="size-4 inline-block" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {total > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-3">
            <span className="text-[13px] text-muted-foreground">
              {intl.formatMessage(
                { id: 'inspections.table.showing' },
                {
                  start: (page - 1) * PAGE_LIMIT + 1,
                  end: Math.min(page * PAGE_LIMIT, total),
                  total,
                },
              )}
            </span>
            <DataPagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => updateUrl({ page: p <= 1 ? null : p })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
