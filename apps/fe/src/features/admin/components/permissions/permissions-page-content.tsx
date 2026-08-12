import { History, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
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
import { PermissionGate } from '@/features/auth';
import {
  createPermissionGroups,
  deletePermissionGroup,
  setPermissionGroupActions,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  usePermissionGroupsList,
  usePermissionsStats,
} from '@/shared/api';
import { ListSearch } from '@/shared/components/composed/list-search';
import { StackedDateTime } from '@/shared/components/composed/stacked-date-time';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import {
  actionIcon,
  actionLabel,
  actionSort,
  resourceIcon,
  resourceLabel,
  resourceSort,
} from '../../lib/permission-icons';
import type { PermissionAction, PermissionGroupRow } from '../../types/roles';
import { PermissionGroupDialog } from './add-permission-group-dialog';
import { DeletePermissionGroupDialog } from './delete-permission-group-dialog';
import { PermissionsSlimStats } from './permissions-slim-stats';

// The permission catalog is a small bounded set (one group per
// resource, ~17 today), so fetch them all on one page — lets us order
// them by the sidebar-menu rank client-side. Pagination auto-hides at
// a single page; the resource/updated_at sort headers still work.
const PAGE_LIMIT = 100;

function ResourceIcon({ resource }: { resource: string }) {
  const Icon = resourceIcon(resource);
  return <Icon className="size-4 text-muted-foreground" />;
}

/**
 * Read-only chip row with per-action icon. Replaces the previous
 * `<TagsInput readOnly />` display so each action carries its own icon
 * (eye for read, pencil for update, ...).
 */
const ACTION_TONE: Record<string, StatusTone> = {
  read: 'info',
  create: 'success',
  update: 'caution',
  delete: 'danger',
  export: 'info2',
  import: 'info2',
  run: 'success',
  run_all: 'danger',
  config: 'info2',
  trigger: 'info',
  notification: 'lime',
};

function ActionChips({ actions }: { actions: PermissionAction[] }) {
  const intl = useIntl();
  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((a) => {
        const Icon = actionIcon(a.action);
        return (
          <StatusTag
            key={a.action}
            tone={ACTION_TONE[a.action] ?? 'neutral'}
            className="leading-none"
          >
            <Icon className="size-3 shrink-0" />
            <span className="leading-none">{actionLabel(intl, a.action)}</span>
          </StatusTag>
        );
      })}
    </div>
  );
}

interface GroupedRow extends PermissionGroupRow {
  // Parallel arrays: for each entry in `actions`, `ids[i]` holds the BE id
  // of the corresponding Permission row. Used by edit + delete paths.
  ids: string[];
  /** Latest `updated_at` across the group's permission rows (ISO). */
  updatedAt: string;
}

export function PermissionsPageContent() {
  const intl = useIntl();
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  useBreadcrumb([
    {
      label: intl.formatMessage({ id: 'navigation.adminPermissions' }),
      href: '/admin/permissions',
    },
  ]);

  // ── URL-backed state ──────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get('q') ?? '';
  const pageRaw = searchParams.get('page');
  const pageParsed = pageRaw === null ? NaN : Number(pageRaw);
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  // Multi-field sort spec. Supported columns: `resource`, `updated_at`.
  const SORTABLE_FIELDS = ['resource', 'updated_at'] as const;
  type SortableField = (typeof SORTABLE_FIELDS)[number];
  const sortRaw = searchParams.get('sort') ?? '';
  const sortSpec: Array<{ field: SortableField; dir: 'asc' | 'desc' }> = sortRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const isDesc = raw.startsWith('-');
      const field = isDesc ? raw.slice(1) : raw;
      return { field, dir: isDesc ? 'desc' : 'asc' };
    })
    .filter((s): s is { field: SortableField; dir: 'asc' | 'desc' } =>
      (SORTABLE_FIELDS as readonly string[]).includes(s.field),
    );
  const sort: string | null =
    sortSpec.length > 0
      ? sortSpec.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',')
      : null;

  /** Apply a batch of `{key: value|null}` URL updates atomically. */
  const updateUrl = (updates: Record<string, string | number | null>) => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '' || v === undefined) {
            out.delete(k);
          } else {
            out.set(k, String(v));
          }
        }
        return out;
      },
      { replace: true },
    );
  };

  const setPage = (next: number) => updateUrl({ page: next <= 1 ? null : next });

  /** Per-column sort cycle: null → desc → asc → null. */
  const sorterPropsFor = (field: SortableField) => {
    const idx = sortSpec.findIndex((s) => s.field === field);
    const entry = idx >= 0 ? sortSpec[idx] : null;
    return {
      value: entry?.dir ?? null,
      onChange: (next: 'asc' | 'desc' | null) => {
        let nextSpec = [...sortSpec];
        if (next === null) {
          nextSpec = nextSpec.filter((s) => s.field !== field);
        } else if (idx >= 0) {
          nextSpec[idx] = { field, dir: next };
        } else {
          nextSpec.push({ field, dir: next });
        }
        const encoded = nextSpec.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',');
        updateUrl({ sort: encoded || null, page: null });
      },
    };
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GroupedRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupedRow | null>(null);

  // Server-side pagination. BE groups distinct resources, returns one page.
  const {
    data: groupsPage,
    isLoading,
    error: listError,
  } = usePermissionGroupsList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ || undefined,
    sort: sort ?? undefined,
  });

  // Stats are independent of the active page / search query — they
  // describe the WHOLE catalog, not the current view.
  const { data: stats } = usePermissionsStats();

  // Map BE response into the GroupedRow shape the UI already understands.
  const pagedGroups: GroupedRow[] = useMemo(() => {
    const mapped = (groupsPage?.items ?? []).map((g) => {
      // Sort actions in the canonical display order (read → notification
      // → create → update → delete → sync → …) regardless of how the
      // BE returned them. `ids` must stay parallel to `actions`, so
      // sort the pairs together, then split.
      const ordered = [...g.actions].sort((a, b) => actionSort(a.action, b.action));
      return {
        resource: g.resource,
        actions: ordered.map((a) => ({ id: a.id, action: a.action })),
        ids: ordered.map((a) => a.id),
        updatedAt: g.updatedAt,
      };
    });
    // Default order = sidebar-menu order (same icons + order as the nav).
    // A user-chosen column sort (`sort` set) takes precedence.
    if (!sort) mapped.sort((a, b) => resourceSort(a.resource, b.resource));
    return mapped;
  }, [groupsPage, sort]);
  const total = groupsPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const handleCreateGroup = async (name: string, actions: PermissionAction[]) => {
    try {
      // Single request — BE inserts resource:action rows idempotently.
      // BE returns 409 when the resource is a pure duplicate (every
      // action already exists), so the toast surfaces that case.
      await createPermissionGroups({ [name]: actions.map((a) => a.action) });
      successToast({
        id: 'permissions.toast.created',
        values: { name },
      });
      setCreateOpen(false);
    } catch (err) {
      errorToast(err);
      // Re-throw so the dialog's catch can keep itself open + map
      // server validation back onto the right field, instead of the
      // current "promise resolved, close" race.
      throw err;
    }
  };

  const handleEditGroup = async (name: string, actions: PermissionAction[]) => {
    if (!editTarget) return;
    try {
      // Single PUT — BE diffs `actions` against the current group
      // and applies adds + removes in one transaction with ONE audit
      // row. Replaces the previous "create-then-loop-delete" path
      // that produced N+1 audit entries per edit.
      await setPermissionGroupActions(
        name,
        actions.map((a) => a.action),
      );
      successToast({
        id: 'permissions.toast.updated',
        values: { name },
      });
      setEditTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  // Actual deletion runs only from the confirm dialog (see below).
  // One BE call → one audit row. The pre-refactor loop fired N
  // separate `DELETE /:id` requests, producing N audit entries for
  // what's semantically a single admin action.
  const handleConfirmDeleteGroup = async () => {
    if (!deleteTarget) return;
    try {
      await deletePermissionGroup(deleteTarget.resource);
      successToast({
        id: 'permissions.toast.deleted',
        values: { name: deleteTarget.resource },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl text-foreground">
              {intl.formatMessage({ id: 'permissions.title' })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'permissions.subtitle' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate codes={['permission:notification']}>
              <Button variant="outline" asChild>
                <Link to="/notifications?entity=permissions">
                  <History className="size-4" />
                  {intl.formatMessage({ id: 'common.history' })}
                </Link>
              </Button>
            </PermissionGate>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {intl.formatMessage({ id: 'permissions.addGroup' })}
            </Button>
          </div>
        </div>

        {listError && <ErrorBanner message={getErrorMessage(listError)} />}

        {/* Slim stats — Pencil `GYxeF` */}
        <PermissionsSlimStats stats={stats} filteredCount={total} />

        {/* Search + reset */}
        <div className="flex items-center gap-2">
          <ListSearch
            className="flex-1"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={intl.formatMessage({
              id: 'permissions.searchPlaceholder',
            })}
          />
          {(urlQ || sortRaw) && (
            <button
              type="button"
              onClick={() => updateUrl({ q: null, sort: null, page: null })}
              className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
            >
              {intl.formatMessage({ id: 'permissions.filters.reset' })}
            </button>
          )}
        </div>

        {/* Table + Pagination */}
        <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
            <Table className="table-fixed" containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
                <TableRow className="bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[220px] bg-muted p-0 whitespace-nowrap">
                    <ColumnSorter
                      {...sorterPropsFor('resource')}
                      label={intl.formatMessage({
                        id: 'permissions.table.permissionGroup',
                      })}
                    />
                  </TableHead>
                  <TableHead className="w-[360px] whitespace-nowrap">
                    {intl.formatMessage({
                      id: 'permissions.table.accessControl',
                    })}
                  </TableHead>
                  <TableHead className="w-[200px] p-0 whitespace-nowrap">
                    <ColumnSorter
                      {...sorterPropsFor('updated_at')}
                      label={intl.formatMessage({
                        id: 'permissions.table.updated',
                      })}
                    />
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">
                    {intl.formatMessage({ id: 'permissions.table.actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : pagedGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {intl.formatMessage({
                        id: 'permissions.table.noGroups',
                      })}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedGroups.map((group) => (
                    <TableRow key={group.resource} className="group/row hover:bg-muted">
                      <TableCell className="sticky left-0 z-10 w-[220px] truncate bg-card transition-colors group-hover/row:bg-muted">
                        <div className="flex items-center gap-2">
                          <ResourceIcon resource={group.resource} />
                          <span className="truncate font-medium text-sm text-foreground">
                            {resourceLabel(intl, group.resource)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="w-[360px]">
                        <ActionChips actions={group.actions} />
                      </TableCell>
                      <TableCell className="w-[200px] whitespace-nowrap">
                        <StackedDateTime value={group.updatedAt} />
                      </TableCell>
                      <TableCell className="w-[80px]">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            onClick={() => setEditTarget(group)}
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                            onClick={() => setDeleteTarget(group)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!isLoading && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">
                {intl.formatMessage(
                  { id: 'common.pager.showing' },
                  {
                    from: total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1,
                    to: Math.min(total, page * PAGE_LIMIT),
                    total: total.toLocaleString(),
                  },
                )}
              </span>
              <DataPagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                className="mx-0 w-auto"
              />
            </div>
          )}
        </div>
      </div>

      {/* Create */}
      <PermissionGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreateGroup}
      />

      {/* Edit */}
      <PermissionGroupDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        onSubmit={handleEditGroup}
        initialData={
          editTarget ? { name: editTarget.resource, actions: editTarget.actions } : undefined
        }
      />

      {/* Delete group — user must confirm since the action fans out to N
          individual permission deletes. */}
      <DeletePermissionGroupDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        resource={deleteTarget?.resource ?? ''}
        actionCount={deleteTarget?.actions.length ?? 0}
        onConfirm={handleConfirmDeleteGroup}
      />
    </>
  );
}
