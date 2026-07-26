import { History, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { DataPagination } from '@/components/ui/data-pagination';
import { ErrorBanner } from '@/components/ui/error-banner';
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
  type ApiRole,
  createRole,
  deleteRole,
  setRolePermissions,
  updateRole,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useRole,
  useRolesList,
  useRolesStats,
} from '@/shared/api';
import { ListSearch } from '@/shared/components/composed/list-search';
import { StackedDateTime } from '@/shared/components/composed/stacked-date-time';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useRoleDescription, useRoleLabel } from '../../lib/use-role-label';
import { DeleteRoleDialog } from './delete-role-dialog';
import { RoleDialog } from './role-dialog';
import { RolesSlimStats } from './roles-slim-stats';

const PAGE_LIMIT = 10;

export function RolesPageContent() {
  const intl = useIntl();
  const roleLabel = useRoleLabel();
  const roleDescription = useRoleDescription();
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  useBreadcrumb([
    {
      label: intl.formatMessage({ id: 'navigation.adminRoles' }),
      href: '/admin/roles',
    },
  ]);

  // ── URL-backed state ──────────────────────────────────────────
  // Refresh / share-link / back-button all preserve search, sort,
  // and page. Single batched `updateUrl` keeps react-router's stale
  // searchParams ref from making back-to-back updates stomp.
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get('q') ?? '';
  const pageRaw = searchParams.get('page');
  const pageParsed = pageRaw === null ? NaN : Number(pageRaw);
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  // Multi-field sort spec. Supported columns: `name`, `updated_at`,
  // `permissions` (granted-permission count). Unknown fields drop
  // silently → BE applies its importance-rank default.
  const SORTABLE_FIELDS = ['name', 'updated_at', 'permissions'] as const;
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
  const [editTarget, setEditTarget] = useState<ApiRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiRole | null>(null);

  // Server-side pagination. The hook key encodes (page, pageSize, q) so each
  // combination caches separately and mutations revalidate all variants.
  const {
    data: rolesPage,
    isLoading,
    error: listError,
  } = useRolesList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ || undefined,
    sort: sort ?? undefined,
  });
  // Stats describe the WHOLE catalog — independent of pagination /
  // search. Revalidated automatically on every role mutation.
  const { data: stats } = useRolesStats();
  // The permissions catalog used to live here on-mount; now it's fetched
  // inside `RoleDialog` via `useRoleDialogCatalog(open)` so the roles list
  // page doesn't pay the cost unless the admin opens create/edit.
  //
  // Reset-on-search-change happens in the Input's onChange below — NOT in
  // an effect keyed on debouncedQuery. The effect fires on mount (when
  // debouncedQuery is the initial empty string), which would clobber any
  // `?page=N` the user navigated in with. Binding the reset to the typing
  // event instead preserves URL-driven deep links.

  const pagedRoles = rolesPage?.items ?? [];
  const total = rolesPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  // Fetch detail (for permission codes) only when editing — lazy and cheap.
  const { data: editDetail } = useRole(editTarget?.id ?? null);

  const handleCreateRole = async (data: {
    code?: string;
    name: string;
    description: string;
    permissions: string[];
  }) => {
    try {
      // `code` is now derived + validated inside RoleDialog (RHF + zod
      // share the BE schema). The dialog won't submit unless the code
      // matches `^[a-z_]+$` so we can pass it through verbatim.
      if (!data.code) {
        // Defence-in-depth: parent shouldn't ever see undefined code on
        // create, but bail loudly rather than send an invalid payload.
        throw new Error('Role code missing — dialog should have provided it');
      }
      await createRole({
        code: data.code,
        name: data.name,
        description: data.description || undefined,
        permissionCodes: data.permissions,
      });
      successToast({
        id: 'roles.toast.created',
        values: { name: data.name },
      });
      setCreateOpen(false);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleEditRole = async (data: {
    code?: string;
    name: string;
    description: string;
    permissions: string[];
  }) => {
    if (!editTarget) return;
    try {
      await updateRole(editTarget.id, {
        name: data.name,
        description: data.description,
      });
      // Always push the permissions — the picker returns the full selection.
      await setRolePermissions(editTarget.id, data.permissions);
      successToast({
        id: 'roles.toast.updated',
        values: { name: data.name },
      });
      setEditTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleDeleteRole = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRole(deleteTarget.id);
      successToast({
        id: 'roles.toast.deleted',
        values: { name: deleteTarget.name },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const editInitialData = useMemo(() => {
    if (!editTarget) return undefined;
    return {
      // Code is immutable on update — passed through so the dialog can
      // render it as a read-only field (admins still need to see it).
      code: editTarget.code,
      name: editTarget.name,
      description: editTarget.description ?? '',
      // Use detail (if loaded) to pre-select current permissions, else empty.
      permissions: editDetail?.permissions ?? [],
    };
  }, [editTarget, editDetail]);

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl text-foreground">
              {intl.formatMessage({ id: 'roles.title' })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'roles.subtitle' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate codes={['role:notification']}>
              <Button variant="outline" asChild>
                <Link to="/notifications?entity=roles">
                  <History className="size-4" />
                  {intl.formatMessage({ id: 'common.history' })}
                </Link>
              </Button>
            </PermissionGate>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {intl.formatMessage({ id: 'roles.addRole' })}
            </Button>
          </div>
        </div>

        {listError && <ErrorBanner message={getErrorMessage(listError)} />}

        {/* Slim stats — Pencil `uYlw1` */}
        <RolesSlimStats stats={stats} filteredCount={total} />

        {/* Search + reset */}
        <div className="flex items-center gap-2">
          <ListSearch
            className="flex-1"
            value={urlQ}
            onValueChange={(next) => updateUrl({ q: next || null, page: null })}
            placeholder={intl.formatMessage({ id: 'roles.searchPlaceholder' })}
          />
          {(urlQ || sortRaw) && (
            <button
              type="button"
              onClick={() => updateUrl({ q: null, sort: null, page: null })}
              className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
            >
              {intl.formatMessage({ id: 'roles.filters.reset' })}
            </button>
          )}
        </div>

        <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
            <Table className="min-w-[960px] table-fixed" containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
                <TableRow className="bg-muted">
                  <TableHead className="sticky left-0 z-20 w-[230px] bg-muted p-0 whitespace-nowrap">
                    <ColumnSorter
                      {...sorterPropsFor('name')}
                      label={intl.formatMessage({
                        id: 'roles.table.roleName',
                      })}
                    />
                  </TableHead>
                  {/*
                    Description fills the remaining width. `max-w-0` on the
                    TD lets the cell shrink below its intrinsic content
                    width, clipping with an ellipsis instead of pushing the
                    sibling columns.
                  */}
                  <TableHead>{intl.formatMessage({ id: 'roles.table.description' })}</TableHead>
                  <TableHead className="w-[160px] p-0 whitespace-nowrap">
                    <ColumnSorter
                      {...sorterPropsFor('permissions')}
                      label={intl.formatMessage({ id: 'roles.table.permissions' })}
                    />
                  </TableHead>
                  <TableHead className="w-[230px] p-0 whitespace-nowrap">
                    <ColumnSorter
                      {...sorterPropsFor('updated_at')}
                      label={intl.formatMessage({
                        id: 'roles.table.updated',
                      })}
                    />
                  </TableHead>
                  <TableHead className="w-[120px] whitespace-nowrap">
                    {intl.formatMessage({ id: 'roles.table.actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : pagedRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {intl.formatMessage({ id: 'roles.table.noRoles' })}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRoles.map((role) => {
                    const localizedName = roleLabel(role.code, role.name);
                    const localizedDesc = roleDescription(role.code, role.description ?? '');
                    return (
                      <TableRow key={role.id} className="group/row hover:bg-muted">
                        <TableCell
                          className="sticky left-0 z-10 w-[230px] cursor-pointer truncate bg-card font-medium text-foreground transition-colors group-hover/row:bg-muted hover:underline"
                          title={localizedName}
                          onClick={() => setEditTarget(role)}
                        >
                          {localizedName}
                        </TableCell>
                        <TableCell
                          className="max-w-0 truncate text-muted-foreground"
                          title={localizedDesc}
                        >
                          {localizedDesc}
                        </TableCell>
                        <TableCell className="w-[160px]">
                          {/* `All permissions` badge removed — detecting the
                              "all" case required fetching the full catalog
                              just to count it, which defeats the lazy-load
                              refactor. Plain grant count is informative
                              enough for the admin glance view. */}
                          <span className="text-muted-foreground text-sm">
                            {intl.formatMessage(
                              { id: 'roles.table.permissionCount' },
                              { count: role.grantCount },
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="w-[230px] whitespace-nowrap">
                          <StackedDateTime value={role.updatedAt} />
                        </TableCell>
                        <TableCell className="w-[120px]">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={() => setEditTarget(role)}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                              onClick={() => setDeleteTarget(role)}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
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

      {/* Create Role */}
      <RoleDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreateRole} />

      {/* Edit Role */}
      <RoleDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        onSubmit={handleEditRole}
        initialData={editInitialData}
      />

      <DeleteRoleDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        roleName={deleteTarget?.name ?? ''}
        onConfirm={handleDeleteRole}
      />
    </>
  );
}
