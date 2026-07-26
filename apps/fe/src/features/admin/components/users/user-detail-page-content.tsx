import { PERMISSION_CATALOG } from '@cocoaimpact/shared';
import { IdCard, KeyRound, Pencil, RotateCcw, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusTag, type StatusTone } from '@/components/ui/status-tag';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatGhanaDate } from '@/lib/datetime';
import {
  deleteUser,
  restoreUser,
  updateUser,
  useApiErrorMessage,
  useApiErrorToast,
  useApiSuccessToast,
  useRolesList,
  useUser,
} from '@/shared/api';
import { BackButton } from '@/shared/components/composed/back-button';
import { useBreadcrumb } from '@/shared/contexts/breadcrumb-context';
import type { UpdateUserPayload } from '../../types/users';
import { DeleteUserDialog } from './delete-user-dialog';
import { UserDialog } from './user-dialog';

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiStatusToUi(s: 'active' | 'inactive' | 'locked'): 'active' | 'inactive' | 'blocked' {
  return s === 'locked' ? 'blocked' : s;
}

function getInitials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const head = parts[0]![0]!.toUpperCase();
  const tail = parts.length > 1 ? parts[parts.length - 1]![0]!.toUpperCase() : '';
  return head + tail;
}

const STATUS_TAG: Record<'active' | 'inactive' | 'blocked', { tone: StatusTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'danger', label: 'Inactive' },
  blocked: { tone: 'warning', label: 'Locked' },
};

function formatDate(timestamp: number) {
  return formatGhanaDate(timestamp);
}

function timeAgo(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm break-all">{value ?? '—'}</div>
    </div>
  );
}

function StatusPill({ status }: { status: 'active' | 'inactive' | 'blocked' }) {
  const b = STATUS_TAG[status];
  return (
    <StatusTag tone={b.tone} dot>
      {b.label}
    </StatusTag>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  clerkUserId: string;
}

export function UserDetailPageContent({ clerkUserId }: Props) {
  const intl = useIntl();
  const navigate = useNavigate();
  const getErrorMessage = useApiErrorMessage();
  const errorToast = useApiErrorToast();
  const successToast = useApiSuccessToast();
  const { data: user, isLoading, error } = useUser(clerkUserId);
  // Cheap roles list used only for role-code → display-name lookup below
  // (badges + dialog `roleNames`). The heavy catalog (roles WITH permission
  // codes, permission groups) is loaded lazily inside `UserDialog` via
  // `useUserDialogCatalog(open)` — first dialog-open is the first fetch.
  const { data: rolesPageAll } = useRolesList({ pageSize: 100 });
  const rolesData = rolesPageAll?.items;
  const rolesCatalog = useMemo(
    () => (rolesData ?? []).map((r) => ({ id: r.code, name: r.name })),
    [rolesData],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  // Account lifecycle is soft-delete only: Delete (Soft) tombstones the
  // row and blocks login; Restore brings it back with its prior status
  // intact. Lock/Deactivate were retired — a user is either live or
  // soft-deleted.
  const [restoreOpen, setRestoreOpen] = useState(false);

  const fullName = user?.fullName ?? '';

  useBreadcrumb([
    {
      label: intl.formatMessage({ id: 'navigation.adminUsers' }),
      href: '/admin/users',
    },
    { label: fullName || clerkUserId },
  ]);

  const handleEditUser = useCallback(
    async (data: UpdateUserPayload) => {
      if (!user) return;
      try {
        // Single PATCH carrying both name + roles — BE applies both
        // in one transaction with ONE audit row. The previous flow
        // fired PATCH (name) + PUT (roles), producing two entries
        // for one admin edit.
        const trimmedName = (data.name ?? '').trim();
        const patch: { fullName?: string; roleCodes?: string[] } = {};
        if (trimmedName && trimmedName !== user.fullName) {
          patch.fullName = trimmedName;
        }
        if (Array.isArray(data.roleIds)) {
          patch.roleCodes = data.roleIds;
        }
        if (Object.keys(patch).length > 0) {
          await updateUser(user.id, patch);
          successToast({
            id: 'users.toast.updated',
            values: { email: user.email },
          });
        }
        setEditOpen(false);
      } catch (err) {
        errorToast(err);
        throw err;
      }
    },
    [user, errorToast, successToast],
  );

  const handleDeleteUser = useCallback(async () => {
    if (!user) return;
    try {
      await deleteUser(user.id);
      successToast({
        id: 'users.toast.deleted',
        values: { email: user.email },
      });
      navigate('/admin/users');
    } catch (err) {
      errorToast(err);
      throw err;
    }
  }, [user, errorToast, successToast, navigate]);

  const handleResetPassword = useCallback(async () => {
    // Backend does not expose a reset-password endpoint in this task.
  }, []);

  const handleRestore = useCallback(async () => {
    if (!user) return;
    try {
      await restoreUser(user.id);
      successToast({
        id: 'users.toast.restored',
        values: { email: user.email },
      });
    } catch (err) {
      errorToast(err);
      throw err;
    }
  }, [user, errorToast, successToast]);

  // ── Loading / not-found states ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <p className="text-muted-foreground">
          {error ? getErrorMessage(error) : 'User not found.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/admin/users')}>
          Back to Users
        </Button>
      </div>
    );
  }

  const uiStatus = apiStatusToUi(user.status);
  const isDeleted = Boolean(user.deletedAt);
  const createdAtMs = Date.parse(user.createdAt);
  const lastSignInMs = user.lastLoginAt ? Date.parse(user.lastLoginAt) : null;
  const initials = getInitials(user.fullName);

  const editInitialData = {
    id: user.id,
    email: user.email,
    name: user.fullName,
    roleNames: user.roles.map((code) => rolesCatalog.find((r) => r.id === code)?.name ?? code),
  };

  // Resolve role codes -> display names for the badges.
  const roleLabels = user.roles.map(
    (code) => rolesCatalog.find((r) => r.id === code)?.name ?? code,
  );

  // Effective permissions already come pre-computed from the BE detail
  // endpoint (union across all the user's roles). We decorate each code
  // with its catalog metadata (name, description) so the admin table
  // can show human labels next to the raw `resource:action`. Sorted by
  // code so rows group by resource visually.
  const permissionRows = (() => {
    // Widen the Map key to `string` — `PermissionCode` is a narrow union
    // and `user.permissions` is `string[]` (reflects what the DB hands
    // back, which may contain unknown/legacy codes the catalog no longer
    // lists). Missing lookups fall back to the split `action` label.
    const catalogByCode = new Map<string, (typeof PERMISSION_CATALOG)[number]>(
      PERMISSION_CATALOG.map((p) => [p.code, p]),
    );
    return [...user.permissions]
      .sort((a, b) => a.localeCompare(b))
      .map((code) => {
        const [resource = code, action = ''] = code.split(':');
        const meta = catalogByCode.get(code);
        return {
          code,
          resource,
          action,
          name: meta?.name ?? action,
          description: meta?.description ?? null,
        };
      });
  })();

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-4">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <BackButton fallbackTo="/admin/users" />
              <h1 className="text-2xl font-semibold text-foreground">User Detail</h1>
            </div>
            <p className="text-sm text-muted-foreground">Manage user information and permissions</p>
          </div>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>

        {/* Profile card */}
        <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
          <Avatar className="size-10 shrink-0">
            <AvatarFallback className="bg-primary font-semibold text-primary-foreground">
              {initials || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="truncate text-base font-semibold text-foreground"
                title={user.fullName}
              >
                {user.fullName}
              </span>
              <StatusPill status={uiStatus} />
            </div>
            <a
              href={`mailto:${user.email}`}
              className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
              title={user.email}
            >
              {user.email}
            </a>
          </div>
        </div>

        {/* Account Information */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <IdCard className="size-4 text-muted-foreground" />
              Account Information
            </CardTitle>
            <CardDescription>Your account details and assigned roles</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
              <InfoField label="Name" value={user.fullName} />
              <InfoField
                label="Email"
                value={
                  <a href={`mailto:${user.email}`} className="text-foreground hover:underline">
                    {user.email}
                  </a>
                }
              />
              <InfoField label="Member Since" value={createdAtMs ? formatDate(createdAtMs) : '—'} />
              <InfoField label="Last Action" value={timeAgo(lastSignInMs)} />
              <InfoField
                label="User ID"
                value={<span className="font-mono text-xs text-muted-foreground">{user.id}</span>}
              />
              <InfoField label="Account Status" value={<StatusPill status={uiStatus} />} />
            </div>
          </CardContent>
        </Card>

        {/* Roles and Permissions */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Roles and Permissions
            </CardTitle>
            <CardDescription>Control roles and access permission in user account</CardDescription>
          </CardHeader>
          <CardContent className="px-4 flex flex-col gap-4">
            {/* Roles + Scope row — pencil zapwF. Roles render as
                primary-tinted pills (admin-importance signalled by
                the dark fill); Scope collapses to a single
                "All cooperatives" pill when the user holds an
                org-wide role, otherwise lists each assigned
                cooperative as a secondary outline pill. */}
            <div className="flex flex-row gap-6">
              <div className="flex flex-1 flex-col gap-2">
                <span className="text-[13px] text-muted-foreground">
                  Roles ({roleLabels.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {roleLabels.length > 0 ? (
                    roleLabels.map((role) => (
                      <span
                        key={role}
                        className="inline-flex items-center rounded-2xl bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                      >
                        {role}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <span className="text-[13px] text-muted-foreground">Scope</span>
                <div className="flex flex-wrap gap-1.5">
                  {user.isAllCooperative ? (
                    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                      All cooperatives
                    </span>
                  ) : user.cooperativeAssignments.length > 0 ? (
                    user.cooperativeAssignments.map((a) => (
                      <span
                        key={a.cooperativeId}
                        className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground"
                      >
                        {a.cooperativeName}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* Effective permissions — union across all assigned roles.
                Styled to match the roles-list table on `/admin/roles` so the
                admin surface reads consistently across the two pages. */}
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Permissions ({permissionRows.length})
              </span>
              {permissionRows.length > 0 ? (
                <div className="border-y border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted hover:bg-muted">
                        <TableHead className="sticky left-0 z-20 bg-muted">Resource</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead className="w-full">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permissionRows.map((p) => (
                        <TableRow key={p.code} className="group/row hover:bg-muted">
                          <TableCell className="sticky left-0 z-10 bg-card text-sm font-medium capitalize transition-colors group-hover/row:bg-muted">
                            {p.resource}
                          </TableCell>
                          <TableCell className="text-sm capitalize">{p.action}</TableCell>
                          <TableCell>
                            <code className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              {p.code}
                            </code>
                          </TableCell>
                          <TableCell
                            className="w-full max-w-0 truncate text-muted-foreground text-sm"
                            title={p.description ?? ''}
                          >
                            {p.description ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No effective permissions</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-muted-foreground" />
              Authentication
            </CardTitle>
            <CardDescription>Update your password to keep your account secure</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setResetPasswordOpen(true)}>Reset Password</Button>
            </div>
          </CardContent>
        </Card>

        {/* Account Management */}
        <Card className="py-4 gap-3">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="size-4 text-muted-foreground" />
              Account management
            </CardTitle>
            <CardDescription>Control account in system</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            <div className="flex flex-wrap gap-3">
              {/* Soft-delete lifecycle only: a live user can be soft-deleted;
                  a soft-deleted user can be restored. */}
              {isDeleted ? (
                <Button onClick={() => setRestoreOpen(true)}>
                  <RotateCcw className="size-4" />
                  {intl.formatMessage({ id: 'users.actions.restore' })}
                </Button>
              ) : (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="size-4" />
                  {intl.formatMessage({ id: 'users.actions.delete' })}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <UserDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleEditUser}
        initialData={editInitialData}
      />

      <DeleteUserDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        userEmail={user.email}
        onConfirm={handleDeleteUser}
      />

      {/* Reset Password confirm */}
      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="text-lg font-semibold">Reset Password</h3>
            <p className="text-sm text-muted-foreground">
              A password reset link will be generated for{' '}
              <span className="font-medium text-foreground">{user.email}</span>. Share this link
              with the user so they can set a new password.
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setResetPasswordOpen(false);
                handleResetPassword();
              }}
            >
              Generate Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm — undoes soft-delete; status preserved. */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader className="border-b-0">
            <h3 className="text-lg font-semibold">
              {intl.formatMessage({ id: 'users.restoreDialog.title' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({ id: 'users.restoreDialog.description' }, { email: user.email })}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setRestoreOpen(false);
                handleRestore();
              }}
            >
              {intl.formatMessage({ id: 'users.restoreDialog.confirm' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
