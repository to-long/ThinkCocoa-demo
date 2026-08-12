/**
 * Farms Management list — mirrors the Pencil `cqcus` design.
 *
 * Columns: Parcel ID · Parcel Name · Farmer ID · Farmer · EUDR ·
 *          Trees · Area · Planting Date · Status · Actions.
 *
 * Filters: search (q), status, EUDR, crop. * direct-links + back-button work the same as the farmers list.
 */

import type { CreateParcelInput, UpdateParcelInput } from '@thinkcocoa/shared';
import {
  CircleDot,
  EllipsisVertical,
  Eye,
  History,
  Layers,
  Leaf,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TreePine,
  Trees,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionGate } from '@/features/auth';
import { ShadeSurvivalBadge } from '@/features/farmers/components/shade-survival-badge';
import { formatDate } from '@/lib/datetime';
import {
  type ApiParcel,
  createParcel,
  deleteParcel,
  restoreParcel,
  updateParcel,
  useApiErrorToast,
  useApiSuccessToast,
  useParcelsList,
} from '@/shared/api';
import { FarmerRefCell, ParcelRefCell } from '@/shared/components/composed/entity-ref-cell';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { EudrCsvImportModal } from './eudr-csv-import-modal';
import { FarmDialog } from './farm-dialog';
import { FarmsStats } from './farms-stats';
import { GeoJsonImportModal } from './geojson-import-modal';

const PAGE_LIMIT = 10;

// Status / EUDR → shared StatusTag tones (dot variant), so the pills
// match the rest of the app instead of hand-rolled colour classes.
const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  inactive: 'caution',
  archived: 'neutral',
  deleted: 'neutral',
};

const EUDR_TONE: Record<string, StatusTone> = {
  compliant: 'success',
  non_compliant: 'danger',
  needs_review: 'caution',
  unknown: 'neutral',
};

// "Added" column — two lines: bold HH:MM:SS over a small grey
// YYYY-MM-DD. Both formatted in UTC so they stay
// consistent with the rest of the app's date display.
const CREATED_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const CREATED_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function formatCreatedTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : CREATED_TIME_FMT.format(d);
}
function formatCreatedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : CREATED_DATE_FMT.format(d);
}

/**
 * One EUDR verdict as a chip — or an em dash when the verdict is the
 * benign one. Three columns share it so "Medium" means the same weight
 * in all three, and so the benign case is rendered identically instead of
 * three slightly different empty states.
 */
function RiskChip({
  value,
  benign,
  label,
  tooltip,
  icon,
  tone,
}: {
  value: string | null;
  benign: string;
  label: string;
  tooltip: string;
  icon: ReactNode;
  tone: 'danger' | 'caution';
}) {
  if (!value || value === benign) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <StatusTag tone={tone}>
            {icon}
            {label}
          </StatusTag>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function FarmsPageContent() {
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });
  const navigate = useNavigate();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  useBreadcrumb([{ label: t('farms.title') }]);

  // ── URL state ─────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const statusParam = searchParams.get('status') ?? '';
  const eudrParam = searchParams.get('eudr') ?? '';
  const deforestParam = searchParams.get('deforestation') ?? '';
  const protectedParam = searchParams.get('protectedArea') ?? '';
  const overlapParam = searchParams.get('overlap') ?? '';
  const survivalParam = searchParams.get('survival') ?? '';
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

  const includeDeleted = statusParam === 'deleted';

  const {
    data: listResp,
    isLoading,
    isValidating,
    error: listError,
  } = useParcelsList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ.trim() || undefined,
    parcelStatus: statusParam && statusParam !== 'deleted' ? statusParam : undefined,
    eudr: eudrParam || undefined,
    deforestation: deforestParam || undefined,
    protectedArea: protectedParam || undefined,
    overlap: overlapParam || undefined,
    survival: survivalParam || undefined,
    includeDeleted,
    sort,
  });

  const items = listResp?.items ?? [];
  const total = listResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const initialLoading = isLoading && !listResp;
  const refetching = isValidating && !!listResp;

  // ── Dialogs ───────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiParcel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiParcel | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ApiParcel | null>(null);

  // ── Import Menus & Modals ──────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const [geoJsonOpen, setGeoJsonOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  const handleCreate = async (data: CreateParcelInput | UpdateParcelInput) => {
    try {
      await createParcel(data as CreateParcelInput);
      const c = data as CreateParcelInput;
      successToast({
        id: 'farms.toast.created',
        values: { name: c.parcelName || c.id },
      });
      setCreateOpen(false);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleEdit = async (data: CreateParcelInput | UpdateParcelInput) => {
    if (!editTarget) return;
    try {
      await updateParcel(editTarget.id, data as UpdateParcelInput);
      successToast({
        id: 'farms.toast.updated',
        values: { name: editTarget.parcelName || editTarget.id },
      });
      setEditTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteParcel(deleteTarget.id);
      successToast({
        id: 'farms.toast.deleted',
        values: { name: deleteTarget.parcelName || deleteTarget.id },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restoreParcel(restoreTarget.id);
      successToast({
        id: 'farms.toast.restored',
        values: { name: restoreTarget.parcelName || restoreTarget.id },
      });
      setRestoreTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{t('farms.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('farms.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* List-wide History — lands on the audit feed pre-filtered
              to `entity=parcels`. Per-parcel history is reached by
              clicking History on any individual parcel detail page. */}
          <PermissionGate codes={['parcel:notification']}>
            <Button variant="outline" asChild>
              <Link to="/notifications?entity=parcels">
                <History className="size-4" />
                {t('common.history')}
              </Link>
            </Button>
          </PermissionGate>
          <PermissionGate codes={['parcel:create']}>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('farms.actions.addFarm')}
            </Button>
          </PermissionGate>
          {/* Overflow menu — GeoJSON and CSV Import tucked behind a "⋮" */}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('common.moreActions')}>
                <EllipsisVertical className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto min-w-[176px] p-1">
              <PermissionGate codes={['parcel:create']}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setGeoJsonOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Upload className="size-4" />
                  {t('farms.geoJsonImport.title')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setCsvOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Upload className="size-4" />
                  {t('farms.eudrImport.title')}
                </button>
              </PermissionGate>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Stats row */}
      <FarmsStats filteredCount={total} />

      {/* Filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
          <ListSearch
            className="col-span-1 lg:col-span-3"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={t('farms.filters.searchPlaceholder')}
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
              <SelectValue placeholder={t('farms.filters.allEudr')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compliant">{t('farms.eudr.compliant')}</SelectItem>
              <SelectItem value="non_compliant">{t('farms.eudr.non_compliant')}</SelectItem>
              <SelectItem value="needs_review">{t('farms.eudr.needs_review')}</SelectItem>
              <SelectItem value="unknown">{t('farms.eudr.unknown')}</SelectItem>
            </SelectContent>
          </Select>
          {/* The three EUDR verdicts, each its own filter: a plot can sit
              near cleared forest without overlapping a protected boundary,
              so folding them into one control would hide the distinction a
              buyer is actually asking about. */}
          <Select
            value={deforestParam || undefined}
            onValueChange={(v) => updateUrl({ deforestation: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={
                deforestParam ? () => updateUrl({ deforestation: null, page: null }) : undefined
              }
            >
              <TreePine className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('farms.filters.allDeforestation')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">{t('farms.risk.high')}</SelectItem>
              <SelectItem value="medium">{t('farms.risk.medium')}</SelectItem>
              <SelectItem value="low">{t('farms.risk.low')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={protectedParam || undefined}
            onValueChange={(v) => updateUrl({ protectedArea: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={
                protectedParam ? () => updateUrl({ protectedArea: null, page: null }) : undefined
              }
            >
              <ShieldAlert className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('farms.filters.allProtectedArea')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">{t('farms.risk.high')}</SelectItem>
              <SelectItem value="medium">{t('farms.risk.medium')}</SelectItem>
              <SelectItem value="low">{t('farms.risk.low')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={overlapParam || undefined}
            onValueChange={(v) => updateUrl({ overlap: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={overlapParam ? () => updateUrl({ overlap: null, page: null }) : undefined}
            >
              <Layers className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('farms.filters.allOverlap')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overlap">{t('farms.overlap.overlap')}</SelectItem>
              <SelectItem value="review">{t('farms.overlap.review')}</SelectItem>
              <SelectItem value="none">{t('farms.overlap.none')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={survivalParam || undefined}
            onValueChange={(v) => updateUrl({ survival: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={survivalParam ? () => updateUrl({ survival: null, page: null }) : undefined}
            >
              <Trees className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('farms.filters.allSurvival')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="healthy">{t('farms.survival.healthy')}</SelectItem>
              <SelectItem value="caution">{t('farms.survival.caution')}</SelectItem>
              <SelectItem value="warning">{t('farms.survival.warning')}</SelectItem>
              <SelectItem value="danger">{t('farms.survival.danger')}</SelectItem>
              <SelectItem value="none">{t('farms.survival.none')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusParam || undefined}
            onValueChange={(v) => updateUrl({ status: v || null, page: null })}
          >
            <SelectTrigger
              className="w-full"
              onClear={statusParam ? () => updateUrl({ status: null, page: null }) : undefined}
            >
              <CircleDot className="size-4 text-muted-foreground" />
              <SelectValue placeholder={t('farms.filters.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t('farms.status.active')}</SelectItem>
              <SelectItem value="deleted">{t('farms.status.deleted')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(urlQ ||
          statusParam ||
          eudrParam ||
          deforestParam ||
          protectedParam ||
          overlapParam ||
          survivalParam ||
          hasSort) && (
          <button
            type="button"
            onClick={() => {
              setSearchParams({}, { replace: true });
            }}
            className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
          >
            {t('farms.filters.reset')}
          </button>
        )}
      </div>

      {listError && <ErrorBanner message={(listError as Error).message} />}

      {/* Table + pager wrapper — pinned under the AppHeader (`top-12`)
          and viewport-tall, so the table scrolls (both axes) inside, the
          header freezes at its top, and the pager stays at the bottom
          (matches the farmers list). The inner box owns scroll; the Table
          primitive's own container is `overflow-visible` so the sticky
          header + sticky first column both anchor to the inner box. */}
      <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
          <Table className="min-w-[1180px] table-fixed" containerClassName="overflow-visible">
            {/* `sticky top-0` freezes the header; `[&_th]:bg-muted` keeps
                every header cell opaque (no hover bleed-through). */}
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
              <TableRow className="bg-muted">
                {/* Parcel = name (top) + field-ID with cross-ref link
                    (bottom); Farmer = name (top) + farmer-ID link
                    (bottom). Parcel is the sticky first column. */}
                <TableHead className="sticky left-0 z-20 w-[150px] bg-muted p-0">
                  <ColumnSorter
                    {...sorterPropsFor('parcel_name')}
                    label={t('farms.table.parcel')}
                  />
                </TableHead>
                <TableHead className="w-[160px] p-0">
                  <ColumnSorter {...sorterPropsFor('farmer_id')} label={t('farms.table.farmer')} />
                </TableHead>
                <TableHead className="w-[140px] p-0">
                  <ColumnSorter {...sorterPropsFor('eudr')} label={t('farms.table.eudr')} />
                </TableHead>
                <TableHead className="w-[120px]">{t('farms.table.deforestation')}</TableHead>
                <TableHead className="w-[120px]">{t('farms.table.protectedArea')}</TableHead>
                <TableHead className="w-[110px]">{t('farms.table.overlap')}</TableHead>
                <TableHead className="w-[80px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('tree_count')}
                    label={t('farms.table.trees')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('survival')}
                    label={t('farms.table.survival')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[90px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('area')}
                    label={t('farms.table.area')}
                    className="justify-end"
                  />
                </TableHead>
                <TableHead className="w-[130px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('planting_date')}
                    label={t('farms.table.plantingDate')}
                  />
                </TableHead>
                <TableHead className="w-[120px] p-0">
                  <ColumnSorter {...sorterPropsFor('created')} label={t('farms.table.added')} />
                </TableHead>
                <TableHead className="w-[130px] p-0">
                  <ColumnSorter
                    {...sorterPropsFor('corrective_actions')}
                    label={t('inspections.table.correctiveActions')}
                  />
                </TableHead>
                <TableHead className="w-[100px] p-0">
                  <ColumnSorter {...sorterPropsFor('status')} label={t('farms.table.status')} />
                </TableHead>
                <TableHead className="w-[120px] text-right">{t('farms.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody style={refetching ? { opacity: 0.85 } : undefined}>
              {initialLoading ? (
                <TableRow>
                  <TableCell colSpan={14} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="py-8 text-center text-muted-foreground">
                    {t('farms.table.noFarms')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((p) => {
                  const isDeleted = !!p.deletedAt;
                  const statusKey = isDeleted ? 'deleted' : p.parcelStatus;
                  const eudrKey = p.eudrStatus ?? 'unknown';
                  return (
                    // Row height — 25px content + 8px (py-2) top/bottom
                    // padding = 41px total. Matches the farmers list +
                    // Pencil compact spec the user reported.
                    <TableRow
                      key={p.id}
                      className={`group/row h-[41px] [&_td]:py-2 [&_td]:leading-[25px] text-[13px] hover:bg-muted ${isDeleted ? 'opacity-60' : ''}`}
                    >
                      {/* Parcel — sticky first column. `bg-card` +
                        `group-hover/row:bg-muted` keep the pinned cell
                        opaque and matched to the row on hover. */}
                      <TableCell className="sticky left-0 z-10 bg-card transition-colors group-hover/row:bg-muted">
                        <ParcelRefCell parcelName={p.parcelName} parcelId={p.id} />
                      </TableCell>
                      {/* Farmer — name on top, farmer-ID + link below. */}
                      <TableCell>
                        <FarmerRefCell farmerName={p.farmerFullName} farmerCode={p.farmerId} />
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={EUDR_TONE[eudrKey] ?? 'neutral'} dot>
                          {t(`farms.eudr.${eudrKey}`)}
                        </StatusTag>
                      </TableCell>
                      {/* Only the non-benign verdicts get a chip. A "Low"
                          chip on three quarters of the rows is noise, and an
                          empty cell reads as "nothing here" faster than a
                          green one does. */}
                      <TableCell>
                        <RiskChip
                          value={p.deforestationRisk}
                          benign="low"
                          label={t(`farms.risk.${p.deforestationRisk ?? 'low'}`)}
                          tooltip={t('farms.risk.deforestationTooltip')}
                          icon={<TreePine className="size-3" />}
                          tone={p.deforestationRisk === 'high' ? 'danger' : 'caution'}
                        />
                      </TableCell>
                      <TableCell>
                        <RiskChip
                          value={p.protectedAreaRisk}
                          benign="low"
                          label={t(`farms.risk.${p.protectedAreaRisk ?? 'low'}`)}
                          tooltip={t('farms.risk.protectedAreaTooltip')}
                          icon={<ShieldAlert className="size-3" />}
                          tone={p.protectedAreaRisk === 'high' ? 'danger' : 'caution'}
                        />
                      </TableCell>
                      <TableCell>
                        <RiskChip
                          value={p.overlap}
                          benign="none"
                          label={t(`farms.overlap.${p.overlap ?? 'none'}`)}
                          tooltip={t('farms.risk.overlapTooltip')}
                          icon={<Layers className="size-3" />}
                          tone={p.overlap === 'overlap' ? 'danger' : 'caution'}
                        />
                      </TableCell>
                      <TableCell className="text-right">{p.cocoaTreeCount ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <ShadeSurvivalBadge pct={p.shadeSurvivalPct} />
                      </TableCell>
                      <TableCell className="text-right">
                        {p.calculatedAreaHa != null ? p.calculatedAreaHa.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell>{p.plantingDate ? formatDate(p.plantingDate) : '—'}</TableCell>
                      <TableCell>
                        {p.createdAt ? (
                          <div className="flex flex-col leading-tight">
                            <span className="font-semibold text-foreground tabular-nums">
                              {formatCreatedTime(p.createdAt)}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {formatCreatedDate(p.createdAt)}
                            </span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {p.correctiveActions > 0 ? (
                          <StatusTag tone="caution">
                            <TriangleAlert className="size-3" />
                            {p.correctiveActions}
                          </StatusTag>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={STATUS_TONE[statusKey] ?? 'success'} dot>
                          {t(`farms.status.${statusKey}`)}
                        </StatusTag>
                      </TableCell>
                      {/* Actions — Pencil `r1actionsCell` style: plain
                        muted icons, justify-end inside the 120w cell,
                        gap 8, no button-style backgrounds. */}
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            title={t('farms.actions.view')}
                            onClick={() => navigate(`/farms/${encodeURIComponent(p.id)}`)}
                            disabled={isDeleted}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                          >
                            <Eye className="size-4" />
                          </button>
                          <PermissionGate codes={['parcel:update']}>
                            {!isDeleted && (
                              <button
                                type="button"
                                title={t('farms.actions.edit')}
                                onClick={() => setEditTarget(p)}
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                <Pencil className="size-4" />
                              </button>
                            )}
                          </PermissionGate>
                          <PermissionGate codes={['parcel:delete']}>
                            {isDeleted ? (
                              <button
                                type="button"
                                title={t('farms.actions.restore')}
                                onClick={() => setRestoreTarget(p)}
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                <RotateCcw className="size-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title={t('farms.actions.delete')}
                                onClick={() => setDeleteTarget(p)}
                                className="text-muted-foreground hover:text-destructive cursor-pointer"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </PermissionGate>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination — Pencil `ITN6B`: summary on left, pager on right
              in a single justify-between row. Stays visible at the bottom
              of the sticky wrapper. */}
        {total > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-3 pb-1">
            <span className="text-[13px] text-muted-foreground">
              {intl.formatMessage(
                { id: 'farms.table.showing' },
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
      {/* /sticky table+pager wrapper */}

      {/* Create dialog */}
      <FarmDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} />
      <GeoJsonImportModal open={geoJsonOpen} onOpenChange={setGeoJsonOpen} />
      <EudrCsvImportModal open={csvOpen} onOpenChange={setCsvOpen} />

      {/* Edit dialog */}
      <FarmDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        onSubmit={handleEdit}
        initialData={editTarget}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('farms.deleteDialog.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(
                { id: 'farms.deleteDialog.description' },
                { name: deleteTarget?.parcelName || deleteTarget?.id || '' },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('farms.deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('farms.deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm */}
      <Dialog open={!!restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <h2 className="text-lg font-semibold">{t('farms.restoreDialog.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(
                { id: 'farms.restoreDialog.description' },
                { name: restoreTarget?.parcelName || restoreTarget?.id || '' },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              {t('farms.restoreDialog.cancel')}
            </Button>
            <Button onClick={handleRestore}>{t('farms.restoreDialog.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
