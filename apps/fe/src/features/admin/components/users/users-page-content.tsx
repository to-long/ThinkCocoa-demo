import {
  Building2,
  CircleDot,
  Eye,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ColumnSorter } from '@/components/ui/column-sorter';
import { CopyButton } from '@/components/ui/copy-button';
import { DataPagination } from '@/components/ui/data-pagination';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionGate } from '@/features/auth';
import {
  type ApiUser,
  createUser,
  deleteUser,
  restoreUser,
  updateUser,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useCooperativesList,
  useRolesList,
  useUsersList,
} from '@/shared/api';
import { ListSearch } from '@/shared/components/composed/list-search';
import { StackedDateTime } from '@/shared/components/composed/stacked-date-time';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import { useRoleLabel } from '../../lib/use-role-label';
import type { CreateUserPayload, UpdateUserPayload, UserStatus } from '../../types/users';
import { DeleteUserDialog } from './delete-user-dialog';
import { UserDialog } from './user-dialog';
import { UsersSlimStats } from './users-slim-stats';

/** Widened beyond `UserStatus` to include the virtual `"deleted"` key — the
 *  row may render as tombstoned even while `user.status` is still e.g.
 *  `"active"` underneath. The list cell decides which bucket to pick. */
type BadgeKey = UserStatus | 'deleted';

const STATUS_TONE: Record<BadgeKey, StatusTone> = {
  active: 'success',
  inactive: 'danger',
  blocked: 'caution',
  // Soft-deleted rows use a neutral palette — they're not "blocked" in a
  // product sense, they're tombstoned. Admin-only view triggered by the
  // "Deleted" option in the status filter.
  deleted: 'neutral',
};

// 10 to match every other admin list page (cooperatives, roles,
// permissions, audit logs). The previous 20 made `totalPages` collapse
// to 1 in the seeded dev DB, which silently hides the pager —
// `DataPagination` renders null when there's nothing to navigate.
const PAGE_LIMIT = 10;

// Visual rank for the Role column — `displayRoleOrder()` sorts a
// user's role codes so the "highest privilege" badge surfaces first
// (the row collapses to that one + a `+N` overflow pill). Codes
// outside this list get a high rank so they sort to the end without
// blowing up.
const ROLE_DISPLAY_RANK: Record<string, number> = {
  system_admin: 0,
  project_leader: 1,
  ims_manager: 2,
  field_officer: 3,
  cooperative_chair: 4,
  buyer: 5,
};

function displayRoleOrder(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => {
    const ra = ROLE_DISPLAY_RANK[a] ?? 100;
    const rb = ROLE_DISPLAY_RANK[b] ?? 100;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

// ── Mappers: API → UI shape ───────────────────────────────────────────────
// BE exposes `"active" | "inactive" | "locked"`; the UI uses "blocked"
// instead of "locked" (preserves the original badge palette).
function apiStatusToUi(s: 'active' | 'inactive' | 'locked'): UserStatus {
  return s === 'locked' ? 'blocked' : s;
}

export function UsersPageContent() {
  const intl = useIntl();
  const roleLabel = useRoleLabel();
  const navigate = useNavigate();
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const currentUser = { id: 'mock-user-id' };
  useBreadcrumb([
    {
      label: intl.formatMessage({ id: 'navigation.adminUsers' }),
      href: '/admin/users',
    },
  ]);

  // ── URL-backed state ──────────────────────────────────────────
  // Refresh / share-link / back-button all preserve the current view
  // (search, multi-select filters, sort, page). Single batched
  // `updateUrl` setter keeps react-router's stale-ref-at-call-time
  // behaviour from stomping back-to-back updates.
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get('q') ?? '';
  const roleFilter = searchParams.get('role') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  // Scope filter values: 'all' (org-wide), 'none' (stranded), or a coop UUID.
  const scopeFilter = searchParams.get('scope') ?? '';
  const includeDeleted = statusFilter === 'deleted';
  const pageRaw = searchParams.get('page');
  const pageParsed = pageRaw === null ? NaN : Number(pageRaw);
  const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

  // Multi-field sort spec. Supported columns: `name`, `email`,
  // `last_login`, `scope`. Scope is a derived rank computed on the
  // BE (org-wide → multi-coop → single-coop → none) so pagination
  // remains consistent — never sort it client-side, that re-orders
  // only the current page.  Unknown fields drop silently → BE
  // applies its desc(createdAt) default.
  const SORTABLE_FIELDS = ['name', 'email', 'last_login', 'scope', 'role'] as const;
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

  const setRoleFilter = (next: string) => updateUrl({ role: next || null, page: null });
  const setStatusFilter = (next: string) => updateUrl({ status: next || null, page: null });
  const setScopeFilter = (next: string) => updateUrl({ scope: next || null, page: null });
  const setPage = (next: number) => updateUrl({ page: next <= 1 ? null : next });

  /** Per-column sort cycle: null → desc → asc → null. Each header
   *  reads only its own entry — clicking column A while column B is
   *  already active appends A as a tiebreaker, preserving B's order. */
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
  const [editTarget, setEditTarget] = useState<ApiUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);
  // Restore is a state transition the admin should confirm explicitly — an
  // accidental click un-tombstones a row that was deliberately soft-deleted.
  const [restoreTarget, setRestoreTarget] = useState<ApiUser | null>(null);

  const {
    data: listResp,
    isLoading,
    error: listError,
  } = useUsersList({
    page,
    pageSize: PAGE_LIMIT,
    q: urlQ || undefined,
    includeDeleted: includeDeleted || undefined,
    roleCode: roleFilter || undefined,
    status: statusFilter || undefined,
    scope: scopeFilter || undefined,
    sort: sort ?? undefined,
  });

  // Roles for the filter dropdown + row-row badge label lookup. Cheap
  // SWR hit that the BE gates on `roles:read`; non-admins get a 403 and
  // the dropdown stays empty (they wouldn't reach this page anyway).
  //
  // The full user-create/edit catalog (roles WITH permissions, permission
  // groups, flat permissions) is NO LONGER loaded here — it moves inside
  // `UserDialog` via `useUserDialogCatalog(open)` so the fan-out only
  // runs when the admin actually opens the dialog.
  const { data: rolesPage } = useRolesList({ pageSize: 100 });
  // Coop catalog powers the Scope filter — each coop is a filter option,
  // plus a special "all" option for users with the org-wide flag.
  const { data: allCoops } = useCooperativesList(true);
  const roles = useMemo(
    () =>
      (rolesPage?.items ?? []).map((r) => ({
        // id === code — matches what the BE stores on the user row and
        // what the filter's any-of match compares against.
        id: r.code,
        name: r.name,
      })),
    [rolesPage],
  );

  const items = listResp?.items ?? [];
  const total = listResp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  // Filters (status / role / scope) are applied server-side — see the
  // `listUsers` query in apps/be/src/features/users/service.ts. The BE
  // returns items that already match every active filter, so the
  // pagination `total` reflects the filtered count out of the box.
  // Only tombstone-hiding remains here as a defence-in-depth guard:
  // when no `status` filter is set the BE still won't return deleted
  // rows (includeDeleted stays false), but the null-check keeps the
  // table robust if that ever changes.
  const filteredUsers = statusFilter ? items : items.filter((u) => !u.deletedAt);

  // Stats used to be derived from the current page's items (max 10
  // rows), which was misleading — "Total Users: 10" regardless of the
  // actual user base size. The slim `UsersSlimStats` component now
  // pulls authoritative counts from `/api/users/stats` (LRU-cached,
  // invalidated on every user mutation via `revalidateUsers`).

  const clearFilters = () => {
    // Wipe every URL param atomically so the page lands on the
    // canonical empty URL — calling each setter individually would
    // produce intermediate states (react-router reads searchParams
    // ref at call time, so back-to-back updates stomp each other).
    // `urlQ` empties as a side-effect; ListSearch's external-sync
    // effect pulls it back into its own local caret state.
    setSearchParams({}, { replace: true });
  };

  const handleCreateUser = async (data: CreateUserPayload | UpdateUserPayload) => {
    if (!('email' in data) || !data.email || !data.password) return;
    try {
      await createUser({
        email: data.email,
        password: data.password,
        name: data.name?.trim() || data.email,
        roleCodes: data.roleIds ?? [],
        cooperativeIds: data.cooperativeIds ?? [],
        isAllCooperative: data.isAllCooperative,
      });
      successToast({ id: 'users.toast.created', values: { email: data.email } });
      setCreateOpen(false);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleEditUser = async (data: CreateUserPayload | UpdateUserPayload) => {
    if (!editTarget) return;
    try {
      // Single PATCH carrying both name + roles — BE applies both in
      // one transaction with ONE audit row. The previous flow fired
      // PATCH (name) + PUT (roles) as two requests, producing two
      // audit entries for what's semantically a single edit.
      const patch: {
        fullName?: string;
        roleCodes?: string[];
        cooperativeIds?: string[];
        isAllCooperative?: boolean;
      } = {};
      if (data.name?.trim()) patch.fullName = data.name.trim();
      if (Array.isArray(data.roleIds)) patch.roleCodes = data.roleIds;
      if (Array.isArray(data.cooperativeIds)) patch.cooperativeIds = data.cooperativeIds;
      if (typeof data.isAllCooperative === 'boolean')
        patch.isAllCooperative = data.isAllCooperative;
      if (Object.keys(patch).length > 0) {
        await updateUser(editTarget.id, patch);
        successToast({
          id: 'users.toast.updated',
          values: { email: editTarget.email },
        });
      }
      setEditTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUser(deleteTarget.id);
      successToast({
        id: 'users.toast.deleted',
        values: { email: deleteTarget.email },
      });
      setDeleteTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const handleRestoreUser = async () => {
    if (!restoreTarget) return;
    try {
      await restoreUser(restoreTarget.id);
      successToast({
        id: 'users.toast.restored',
        values: { email: restoreTarget.email },
      });
      setRestoreTarget(null);
    } catch (err) {
      errorToast(err);
      throw err;
    }
  };

  const editDialogInitialData = useMemo(() => {
    if (!editTarget) return undefined;
    return {
      id: editTarget.id,
      name: editTarget.fullName,
      email: editTarget.email,
    };
  }, [editTarget]);

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Title + Add User */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-2xl text-foreground">
              {intl.formatMessage({ id: 'users.title' })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'users.subtitle' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PermissionGate codes={['user:notification']}>
              <Button variant="outline" asChild>
                <Link to="/notifications?entity=users">
                  <History className="size-4" />
                  {intl.formatMessage({ id: 'common.history' })}
                </Link>
              </Button>
            </PermissionGate>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {intl.formatMessage({ id: 'users.addUser' })}
            </Button>
          </div>
        </div>

        {listError && <ErrorBanner message={getErrorMessage(listError)} />}

        {/* Slim stats row — Pencil-matched (`0M9b6`): Total Users card +
            Status row + Roles chip row. Authoritative counts from
            `/api/users/stats`, refreshed on every user mutation. */}
        <UsersSlimStats filteredCount={total} />

        {/* Filter Bar */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 xs:grid-cols-2 lg:grid-cols-6">
            <ListSearch
              className="col-span-1 lg:col-span-3"
              value={urlQ}
              onValueChange={(next) => updateUrl({ q: next || null, page: null })}
              placeholder={intl.formatMessage({ id: 'users.filters.searchPlaceholder' })}
            />
            <Select value={scopeFilter || undefined} onValueChange={(v) => setScopeFilter(v)}>
              <SelectTrigger
                className="w-full"
                onClear={scopeFilter ? () => setScopeFilter('') : undefined}
              >
                <Building2 className="size-4 text-muted-foreground" />
                <SelectValue placeholder={intl.formatMessage({ id: 'users.filters.allScopes' })} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {intl.formatMessage({ id: 'users.stats.scope.all' })}
                </SelectItem>
                <SelectItem value="none">
                  {intl.formatMessage({ id: 'users.stats.scope.none' })}
                </SelectItem>
                {(allCoops ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={roleFilter || undefined} onValueChange={(v) => setRoleFilter(v)}>
              <SelectTrigger
                className="w-full"
                onClear={roleFilter ? () => setRoleFilter('') : undefined}
              >
                <Shield className="size-4 text-muted-foreground" />
                <SelectValue placeholder={intl.formatMessage({ id: 'users.filters.allRoles' })} />
              </SelectTrigger>
              <SelectContent>
                {[...roles]
                  .sort((a, b) => {
                    const ra = ROLE_DISPLAY_RANK[a.id] ?? 100;
                    const rb = ROLE_DISPLAY_RANK[b.id] ?? 100;
                    if (ra !== rb) return ra - rb;
                    return a.name.localeCompare(b.name);
                  })
                  .map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {roleLabel(role.id, role.name)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter || undefined} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger
                className="w-full"
                onClear={statusFilter ? () => setStatusFilter('') : undefined}
              >
                <CircleDot className="size-4 text-muted-foreground" />
                <SelectValue
                  placeholder={intl.formatMessage({ id: 'users.filters.allStatuses' })}
                />
              </SelectTrigger>
              <SelectContent>
                {/* Lifecycle is soft-delete only — a user is either live
                  (active) or soft-deleted. Inactive/Blocked were retired. */}
                <SelectItem value="active">
                  {intl.formatMessage({ id: 'users.status.active' })}
                </SelectItem>
                <SelectItem value="deleted">
                  {intl.formatMessage({ id: 'users.status.deleted' })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(urlQ || scopeFilter || roleFilter || statusFilter || sortRaw) && (
            <button
              type="button"
              onClick={clearFilters}
              className="shrink-0 text-muted-foreground text-sm hover:text-foreground"
            >
              {intl.formatMessage({ id: 'users.filters.reset' })}
            </button>
          )}
        </div>

        {/* Data Table + Pagination — pinned under the AppHeader (`top-12`)
            and viewport-tall so the table scrolls (both axes) inside, the
            header freezes at its top, and the pager stays at the bottom
            (matches the farmers list). */}
        <div className="sticky top-16 flex max-h-[calc(100vh-5rem)] flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-auto border-y border-border bg-card">
            {/* `table-fixed` enforces the per-column widths from the
                THEAD authoritatively. With the default `table-auto`,
                column widths are computed from intrinsic cell content
                so a long-text row could widen its column on sort/page
                reflow and shift every sibling cell. Fixed layout +
                truncate on the affected cells = stable column widths
                regardless of the data inside. */}
            <Table className="table-fixed" containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-20 [&_th]:bg-muted">
                <TableRow className="bg-muted">
                  {/* Sticky first column so the user's name (the row's
                      primary identifier) stays visible when the user
                      horizontally scrolls the rest of the row. Needs
                      a solid background — without `bg-muted` here the
                      scrolled content shows through. `z-20` sits above
                      body cells (which are z-10) so the header still
                      covers rows when vertical-scrolled. */}
                  {/* Sticky first column with click-to-sort header.
                      Picking a different sortable column appends as a
                      tiebreaker; each header reads only its own dir
                      via `sorterPropsFor`. */}
                  <TableHead className="sticky left-0 z-20 w-[200px] bg-muted p-0">
                    <ColumnSorter
                      {...sorterPropsFor('name')}
                      label={intl.formatMessage({ id: 'users.table.name' })}
                    />
                  </TableHead>
                  <TableHead className="w-[220px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('email')}
                      label={intl.formatMessage({ id: 'users.table.email' })}
                    />
                  </TableHead>
                  <TableHead className="w-[200px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('scope')}
                      label={intl.formatMessage({ id: 'users.table.scope' })}
                    />
                  </TableHead>
                  <TableHead className="w-[160px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('role')}
                      label={intl.formatMessage({ id: 'users.table.role' })}
                    />
                  </TableHead>
                  <TableHead className="w-[110px]">
                    {intl.formatMessage({ id: 'users.table.status' })}
                  </TableHead>
                  <TableHead className="w-[160px] p-0">
                    <ColumnSorter
                      {...sorterPropsFor('last_login')}
                      label={intl.formatMessage({
                        id: 'users.table.lastLogin',
                      })}
                    />
                  </TableHead>
                  <TableHead className="w-[100px]">
                    {intl.formatMessage({ id: 'users.table.actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {intl.formatMessage({ id: 'users.table.noUsers' })}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => {
                    const uiStatus = apiStatusToUi(user.status);
                    const isSelf = user.id === currentUser?.id;
                    const isDeleted = Boolean(user.deletedAt);
                    // Tombstone wins over the underlying status so admins
                    // don't see e.g. "Active" next to a row that's actually
                    // been soft-deleted.
                    const badgeKey: BadgeKey = isDeleted ? 'deleted' : uiStatus;
                    return (
                      // Tombstoned rows lose all interactive affordances
                      // (navigate/edit/delete) — only the Restore button
                      // remains in the actions cell. Muted text signals
                      // the state without yelling.
                      <TableRow
                        key={user.id}
                        className={
                          isDeleted
                            ? 'group/row opacity-60 hover:bg-muted'
                            : 'group/row hover:bg-muted'
                        }
                      >
                        <TableCell
                          // Sticky first col — solid hover (not /50)
                          // so the opaque cell matches the rest of
                          // the row. Click → user detail. Fixed
                          // `w-[200px]` + `truncate` matches the TH so
                          // long names ellipsis instead of widening
                          // the column.
                          className={
                            isDeleted
                              ? 'sticky left-0 z-10 w-[200px] truncate bg-card font-medium text-[13px] text-muted-foreground transition-colors group-hover/row:bg-muted'
                              : 'sticky left-0 z-10 w-[200px] cursor-pointer truncate bg-card font-medium text-[13px] text-foreground transition-colors hover:underline group-hover/row:bg-muted'
                          }
                          onClick={
                            isDeleted ? undefined : () => navigate(`/admin/users/${user.id}`)
                          }
                          title={user.fullName}
                        >
                          {user.fullName}
                        </TableCell>
                        {/* Email — width matches the header; CopyButton
                            sits at the row's right edge and only fades
                            in on cell hover so the value stays the
                            visual focus when idle. `group` here scopes
                            the hover to THIS cell so other rows'
                            buttons don't all light up at once. */}
                        <TableCell className="w-[220px] text-[13px] text-muted-foreground">
                          <div className="group/email flex min-w-0 items-center gap-1">
                            <a
                              // mailto: opens the OS default mail client
                              // pre-composed to this address. Underline
                              // on hover only — keeps the row visually
                              // calm when idle. `stopPropagation` so
                              // clicking the email doesn't also fire
                              // the row's name-cell navigate handler.
                              // `min-w-0 flex-1` lets the truncate work
                              // inside the flex parent — without it the
                              // anchor would push past the cell width.
                              href={`mailto:${user.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="min-w-0 flex-1 truncate hover:text-foreground hover:underline"
                              title={user.email}
                            >
                              {user.email}
                            </a>
                            <CopyButton
                              value={user.email}
                              className="opacity-0 transition-opacity group-hover/email:opacity-100"
                              label={intl.formatMessage({
                                id: 'users.table.copyEmail',
                                defaultMessage: 'Copy email',
                              })}
                            />
                          </div>
                        </TableCell>
                        {/* Scope — collapses to a single "All cooperatives"
                            tag when the user holds an org-wide role
                            (system_admin / project_leader / buyer),
                            otherwise one tag per assigned cooperative.
                            Tag styling intentionally mirrors the Role
                            column to its right so the two read as the
                            same kind of badge. */}
                        <TableCell className="w-[200px] text-[13px]">
                          {user.isAllCooperative ? (
                            // Org-wide: just the "All cooperatives" pill.
                            // Listing every coop here was visually noisy
                            // and crowded the table — the badge alone
                            // tells the admin everything they need.
                            <StatusTag tone="caution">
                              {intl.formatMessage({ id: 'users.table.scopeAll' })}
                            </StatusTag>
                          ) : user.cooperativeAssignments &&
                            user.cooperativeAssignments.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {user.cooperativeAssignments.map((a) => (
                                <StatusTag key={a.cooperativeId} tone="neutral">
                                  {a.cooperativeName}
                                </StatusTag>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {/* Role — collapses multi-role users to
                            `[strongest_role] +N`. Sort by rank so
                            "highest privilege" surfaces first; the
                            overflow pill on hover lists the rest. */}
                        <TableCell className="w-[160px] text-[13px]">
                          {(() => {
                            const sorted = displayRoleOrder(user.roles ?? []);
                            if (sorted.length === 0) {
                              return <span className="text-muted-foreground">—</span>;
                            }
                            const [first, ...rest] = sorted;
                            const firstLabel = roleLabel(first, first);
                            return (
                              // `min-w-0` so the pill below can shrink
                              // inside this flex row (cell is 160px and
                              // a long role code would otherwise push
                              // past it). Pill clamps via `max-w-full`
                              // + inner truncate; full label in title
                              // for hover.
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="inline-flex min-w-0 max-w-full" title={firstLabel}>
                                  <StatusTag tone="info2" className="max-w-full">
                                    <span className="min-w-0 truncate">{firstLabel}</span>
                                  </StatusTag>
                                </span>
                                {rest.length > 0 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex">
                                        <StatusTag tone="neutral">+{rest.length}</StatusTag>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="flex flex-col gap-0.5">
                                      {rest.map((c) => (
                                        <span key={c}>{roleLabel(c, c)}</span>
                                      ))}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="w-[110px]">
                          <StatusTag tone={STATUS_TONE[badgeKey]} dot>
                            {intl.formatMessage({ id: `users.status.${badgeKey}` })}
                          </StatusTag>
                        </TableCell>
                        <TableCell className="w-[160px] whitespace-nowrap">
                          <StackedDateTime value={user.lastLoginAt} />
                        </TableCell>
                        <TableCell className="w-[100px]">
                          {/* Icon-only action buttons, `cursor-pointer` on
                              hover to match native link affordance. Deleted
                              rows collapse to just Restore — Eye/Edit/Delete
                              don't apply to a tombstone. */}
                          {user.deletedAt ? (
                            <button
                              type="button"
                              aria-label={intl.formatMessage({
                                id: 'users.actions.restore',
                              })}
                              className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={() => setRestoreTarget(user)}
                            >
                              <RotateCcw className="size-4" />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => navigate(`/admin/users/${user.id}`)}
                              >
                                <Eye className="size-4" />
                              </button>
                              <button
                                type="button"
                                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => setEditTarget(user)}
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                type="button"
                                disabled={isSelf}
                                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-30"
                                onClick={() => setDeleteTarget(user)}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {!isLoading && (
            // Pencil pager — "Showing X-Y of Z results" left, numbered
            // pager right. Counter renders even when there's only one
            // page so admins can see the dataset size at a glance.
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

      {/* Create User */}
      <UserDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={handleCreateUser} />

      {/* Edit User */}
      <UserDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        onSubmit={handleEditUser}
        initialData={editDialogInitialData}
      />

      <DeleteUserDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        userEmail={deleteTarget?.email ?? ''}
        onConfirm={handleDeleteUser}
      />

      {/* Restore confirm — mirrors the Delete flow so every tombstone
          state-change is an explicit admin action, never a stray click. */}
      <Dialog
        open={!!restoreTarget}
        onOpenChange={(v) => {
          if (!v) setRestoreTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="font-semibold text-lg">
              {intl.formatMessage({ id: 'users.restoreDialog.title' })}
            </h3>
            <p className="text-muted-foreground text-sm">
              {intl.formatMessage(
                { id: 'users.restoreDialog.description' },
                { email: restoreTarget?.email ?? '' },
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              {intl.formatMessage({ id: 'users.deleteDialog.cancel' })}
            </Button>
            <Button onClick={handleRestoreUser}>
              {intl.formatMessage({ id: 'users.restoreDialog.confirm' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
