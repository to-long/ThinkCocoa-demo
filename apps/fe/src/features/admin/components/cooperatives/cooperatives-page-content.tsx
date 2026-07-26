/**
 * Cooperative list / management page — matches Pencil `CXn61`.
 *
 * Sections (top → bottom):
 *   1. Header              — title + subtitle + Add Cooperative button
 *   2. Slim stats row      — Total cooperatives card + Status / Total
 *                            Farmers breakdown card
 *   3. Filter bar          — search + district select + status select
 *                            + Reset link
 *   4. Table               — sticky-Name first column + Coop Chair
 *                            (name + email pill) + District + Farmers
 *                            + Certification (RA chip + %) + Fields
 *                            + Parcels + Area (Ha) + Status + Actions
 *                            (eye / pencil / trash)
 *   5. Pager footer        — "Showing X-Y of Z results" (no pagination
 *                            yet — dataset is single-digit rows)
 *
 * Stats are derived from the loaded list — no separate stats endpoint.
 */

import type { CreateCooperativeInput, UpdateCooperativeInput } from '@thinkcocoa/shared';
import {
  BadgeCheck,
  Building2,
  Eye,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StatusTag } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionGate } from '@/features/auth';
import {
  type ApiCooperative,
  createCooperative,
  deleteCooperative,
  restoreCooperative,
  updateCooperative,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useCooperativesAdminList,
} from '@/shared/api';
import { ListSearch } from '@/shared/components/composed/list-search';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useTableSort } from '@/shared/hooks/use-table-sort';
import { CooperativeDialog } from './cooperative-dialog';
import { CooperativesSlimStats } from './cooperatives-slim-stats';
import { DeleteCooperativeDialog } from './delete-cooperative-dialog';
import { RestoreCooperativeDialog } from './restore-cooperative-dialog';

type StatusBucket = 'active' | 'inactive' | 'deleted';

const STATUS_TONES: Record<StatusBucket, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-green-100', text: 'text-green-600', dot: 'bg-green-600' },
  inactive: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-600' },
  deleted: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-500' },
};

const PAGE_SIZE = 10;

function bucketOf(c: ApiCooperative): StatusBucket {
  if (c.deletedAt) return 'deleted';
  return c.isActive ? 'active' : 'inactive';
}

function certPct(c: ApiCooperative): string {
  if (c.farmerCount === 0) return '—';
  const pct = (c.certifiedFarmerCount / c.farmerCount) * 100;
  return `${pct.toFixed(0)}%`;
}

function totalAreaDisplay(c: ApiCooperative): string {
  if (!c.totalAreaHa) return '—';
  const num = Number.parseFloat(c.totalAreaHa);
  if (!Number.isFinite(num) || num === 0) return '—';
  return num.toFixed(1);
}

export function CooperativesPageContent() {
  const intl = useIntl();
  const navigate = useNavigate();
  const t = (k: string) => intl.formatMessage({ id: k });
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  useBreadcrumb([{ label: t('cooperatives.title') }]);

  // URL-back the search query so the page is shareable + survives a
  // refresh, matching every other admin list page (users / farmers /
  // roles / permissions / audit-logs).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const setUrlQ = (next: string) => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next) out.set('q', next);
        else out.delete('q');
        return out;
      },
      { replace: true },
    );
  };
  // Single-select filters — empty string means "no filter" (show all).
  const [districtFilter, setDistrictFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  // Cooperatives load in one shot from the BE (small dataset). Paging
  // is purely client-side — slice `sortedItems` by the current page.
  const [page, setPage] = useState(1);

  const {
    data: items = [],
    isLoading,
    error,
  } = useCooperativesAdminList({
    q: urlQ || undefined,
    includeDeleted: true,
  });

  // Permission gates are handled via <PermissionGate> in JSX below.
  // Server enforces too — gating is just to keep UI honest.

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCooperative | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiCooperative | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ApiCooperative | null>(null);

  // Filter pipeline runs after the BE search query — `q` already
  // narrowed by name/code/district; client-side these filters layer on
  // status + district selection. Empty array == "show all" for that
  // axis (no narrowing applied).
  const filteredItems = useMemo(() => {
    return items.filter((c) => {
      if (districtFilter && c.districtName !== districtFilter) return false;
      if (statusFilter && bucketOf(c) !== statusFilter) return false;
      return true;
    });
  }, [items, districtFilter, statusFilter]);

  // Client-side sort (dataset is single-digit rows, loaded in one shot).
  // The active column/direction is URL-backed via the shared sort hook so
  // it stays consistent with every other list screen.
  const { hasSort, sortSpec, sorterPropsFor } = useTableSort();
  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    if (sortSpec.length === 0) {
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    const certRatio = (c: ApiCooperative) =>
      c.farmerCount === 0 ? -1 : c.certifiedFarmerCount / c.farmerCount;
    const byField = (field: string, a: ApiCooperative, b: ApiCooperative): number => {
      switch (field) {
        case 'district':
          return (a.districtName ?? '').localeCompare(b.districtName ?? '');
        case 'farmers':
          return a.farmerCount - b.farmerCount;
        case 'users':
          return a.userCount - b.userCount;
        case 'certification':
          return certRatio(a) - certRatio(b);
        case 'fields':
          return a.fieldCount - b.fieldCount;
        case 'parcels':
          return a.parcelCount - b.parcelCount;
        case 'area':
          return (
            (Number.parseFloat(a.totalAreaHa ?? '') || 0) -
            (Number.parseFloat(b.totalAreaHa ?? '') || 0)
          );
        case 'status':
          return bucketOf(a).localeCompare(bucketOf(b));
        default:
          return a.name.localeCompare(b.name);
      }
    };
    // Apply each sort term in priority order; first non-zero wins.
    arr.sort((a, b) => {
      for (const { field, dir } of sortSpec) {
        const c = byField(field, a, b) * (dir === 'desc' ? -1 : 1);
        if (c !== 0) return c;
      }
      return 0;
    });
    return arr;
  }, [filteredItems, sortSpec]);

  const resetFilters = () => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete('q');
        out.delete('sort');
        return out;
      },
      { replace: true },
    );
    setDistrictFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const handleCreate = async (data: CreateCooperativeInput | UpdateCooperativeInput) => {
    try {
      const created = (await createCooperative(data as CreateCooperativeInput)) as
        | { name?: string }
        | undefined;
      successToast({
        id: 'cooperatives.toast.created',
        values: { name: created?.name ?? (data as CreateCooperativeInput).name },
      });
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleUpdate = async (data: CreateCooperativeInput | UpdateCooperativeInput) => {
    if (!editTarget) return;
    try {
      await updateCooperative(editTarget.id, data as UpdateCooperativeInput);
      successToast({
        id: 'cooperatives.toast.updated',
        values: { name: editTarget.name },
      });
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCooperative(deleteTarget.id);
      successToast({
        id: 'cooperatives.toast.deleted',
        values: { name: deleteTarget.name },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restoreCooperative(restoreTarget.id);
      successToast({ id: 'cooperatives.toast.restored', values: { name: restoreTarget.name } });
      setRestoreTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  const total = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamp the current page if a filter just shrank the dataset below
  // the active page (e.g. user is on page 3, then filters down to 5
  // rows → page 1).
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, safePage * PAGE_SIZE);
  const pagedItems = sortedItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl text-foreground">{t('cooperatives.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('cooperatives.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate codes={['cooperative:notification']}>
              <Button variant="outline" asChild>
                <Link to="/notifications?entity=cooperatives">
                  <History className="size-4" />
                  {t('common.history')}
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate codes={['cooperative:create']}>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t('cooperatives.addCooperative')}
              </Button>
            </PermissionGate>
          </div>
        </div>

        {error && <ErrorBanner message={getErrorMessage(error)} />}

        {/* Slim stats — built from the loaded list; mirrors farmers /
            users slim stats pattern. */}
        <CooperativesSlimStats cooperatives={items} filteredCount={total} />

        {/* Filter bar — search only. District + Status filters were
            removed per design (four coops total, hard to justify a
            2-way filter for that scale). Reset button lingers only when
            the search box has text. */}
        <div className="flex items-center gap-2">
          <ListSearch
            className="flex-1"
            value={urlQ}
            onValueChange={(next) => {
              setUrlQ(next);
              setPage(1);
            }}
            placeholder={t('cooperatives.searchPlaceholder')}
          />
          {(urlQ || hasSort) && (
            <button
              type="button"
              className="text-muted-foreground text-sm hover:text-foreground"
              onClick={resetFilters}
            >
              {t('cooperatives.filters.reset')}
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
          <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
            <Table className="table-fixed" containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
                <TableRow className="bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[200px] bg-muted p-0">
                    <ColumnSorter
                      {...sorterPropsFor('name')}
                      label={t('cooperatives.table.coopName')}
                    />
                  </TableHead>
                  <TableHead className="w-[140px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('district')}
                      label={t('cooperatives.table.district')}
                    />
                  </TableHead>
                  <TableHead className="w-[90px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('farmers')}
                      label={t('cooperatives.table.farmers')}
                      className="justify-end"
                    />
                  </TableHead>
                  <TableHead className="w-[80px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('users')}
                      label={t('cooperatives.table.users')}
                      className="justify-end"
                    />
                  </TableHead>
                  <TableHead className="w-[160px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('certification')}
                      label={t('cooperatives.table.certification')}
                    />
                  </TableHead>
                  <TableHead className="w-[80px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('fields')}
                      label={t('cooperatives.table.fields')}
                      className="justify-end"
                    />
                  </TableHead>
                  <TableHead className="w-[80px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('parcels')}
                      label={t('cooperatives.table.parcels')}
                      className="justify-end"
                    />
                  </TableHead>
                  <TableHead className="w-[100px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('area')}
                      label={t('cooperatives.table.area')}
                      className="justify-end"
                    />
                  </TableHead>
                  <TableHead className="w-[110px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('status')}
                      label={t('cooperatives.table.status')}
                    />
                  </TableHead>
                  <TableHead className="w-[120px] text-right">
                    {t('cooperatives.table.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : sortedItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      {t('cooperatives.table.noCooperatives')}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedItems.map((c) => {
                    const bucket = bucketOf(c);
                    const tone = STATUS_TONES[bucket];
                    const isDeleted = bucket === 'deleted';
                    return (
                      <TableRow
                        key={c.id}
                        className={
                          isDeleted
                            ? 'group/row opacity-60 hover:bg-muted'
                            : 'group/row hover:bg-muted'
                        }
                      >
                        {/* Sticky first col → coop detail (only when the
                          user has read permission, otherwise the
                          navigation would 403 on the detail page). */}
                        <PermissionGate
                          codes={['cooperative:read']}
                          fallback={
                            <TableCell
                              className="sticky left-0 z-10 w-[200px] truncate bg-card text-[13px] text-muted-foreground transition-colors group-hover/row:bg-muted"
                              title={c.name}
                            >
                              <StatusTag tone="info" className="max-w-full">
                                <Building2 className="size-3 shrink-0" />
                                <span className="min-w-0 truncate">{c.name}</span>
                              </StatusTag>
                            </TableCell>
                          }
                        >
                          <TableCell
                            className={
                              isDeleted
                                ? 'sticky left-0 z-10 w-[200px] truncate bg-card text-[13px] text-muted-foreground transition-colors group-hover/row:bg-muted'
                                : 'sticky left-0 z-10 w-[200px] cursor-pointer truncate bg-card text-[13px] transition-colors group-hover/row:bg-muted'
                            }
                            onClick={
                              isDeleted ? undefined : () => navigate(`/admin/cooperatives/${c.id}`)
                            }
                            title={c.name}
                          >
                            <StatusTag tone="info" className="max-w-[184px]">
                              <Building2 className="size-3 shrink-0" />
                              <span className="min-w-0 truncate">{c.name}</span>
                            </StatusTag>
                          </TableCell>
                        </PermissionGate>

                        {/* District */}
                        <TableCell
                          className="w-[140px] truncate text-[13px] text-foreground"
                          title={c.districtName ?? ''}
                        >
                          {c.districtName ?? '—'}
                        </TableCell>

                        {/* Farmers */}
                        <TableCell className="w-[90px] text-right text-[13px] tabular-nums font-semibold text-foreground">
                          {c.farmerCount}
                        </TableCell>

                        {/* Users with access (assigned + org-wide) */}
                        <TableCell className="w-[80px] text-right text-[13px] tabular-nums text-foreground">
                          {c.userCount}
                        </TableCell>

                        {/* Certification — RA chip + percent */}
                        <TableCell className="w-[160px] text-[13px] text-foreground">
                          <div className="flex items-center gap-2">
                            {c.certifiedFarmerCount > 0 ? (
                              <StatusTag tone="success">
                                <BadgeCheck className="size-3" />
                                {c.certifiedFarmerCount} RA
                              </StatusTag>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {c.farmerCount > 0 && (
                              <span className="text-[12px] text-muted-foreground">
                                {certPct(c)}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Fields */}
                        <TableCell className="w-[80px] text-right text-[13px] tabular-nums text-foreground">
                          {c.fieldCount}
                        </TableCell>

                        {/* Parcels */}
                        <TableCell className="w-[80px] text-right text-[13px] tabular-nums text-foreground">
                          {c.parcelCount}
                        </TableCell>

                        {/* Area (Ha) */}
                        <TableCell className="w-[100px] text-right text-[13px] tabular-nums text-foreground">
                          {totalAreaDisplay(c)}
                        </TableCell>

                        {/* Status pill */}
                        <TableCell className="w-[110px]">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] ${tone.bg} ${tone.text}`}
                          >
                            <span className={`size-2 rounded-full ${tone.dot}`} />
                            {t(`cooperatives.status.${bucket}`)}
                          </span>
                        </TableCell>

                        {/* Actions: View / Edit / Delete — each gated by
                          its own permission. */}
                        <TableCell className="w-[120px]">
                          <div className="flex items-center justify-end gap-1">
                            <PermissionGate codes={['cooperative:read']}>
                              <button
                                type="button"
                                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => navigate(`/admin/cooperatives/${c.id}`)}
                              >
                                <Eye className="size-4" />
                              </button>
                            </PermissionGate>
                            {!isDeleted && (
                              <>
                                <PermissionGate codes={['cooperative:update']}>
                                  <button
                                    type="button"
                                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                    onClick={() => setEditTarget(c)}
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                </PermissionGate>
                                <PermissionGate codes={['cooperative:delete']}>
                                  <button
                                    type="button"
                                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                                    onClick={() => setDeleteTarget(c)}
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </PermissionGate>
                              </>
                            )}
                            {isDeleted && (
                              <PermissionGate codes={['cooperative:delete']}>
                                <button
                                  type="button"
                                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                  onClick={() => setRestoreTarget(c)}
                                  title={t('cooperatives.actions.restore')}
                                >
                                  <RotateCcw className="size-4" />
                                </button>
                              </PermissionGate>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pager — "Showing X-Y of Z results" left, numbered pager
            right. With 4 fixed rows the pager renders nothing, but
            keeping the layout matches every other admin list page. */}
          {!isLoading && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {intl.formatMessage(
                  { id: 'common.pager.showing' },
                  {
                    from,
                    to,
                    total: total.toLocaleString(),
                  },
                )}
              </span>
              <DataPagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                className="mx-0 w-auto"
              />
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <CooperativeDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreate} />

      {/* Edit dialog */}
      <CooperativeDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        onSubmit={handleUpdate}
        initialData={editTarget ?? undefined}
      />

      {/* Delete confirm */}
      <DeleteCooperativeDialog
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {/* Restore confirm */}
      <RestoreCooperativeDialog
        target={restoreTarget}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
      />
    </>
  );
}
