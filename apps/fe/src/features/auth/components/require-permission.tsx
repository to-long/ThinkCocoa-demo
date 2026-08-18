/**
 * Route guard: renders the child `<Outlet />` only if the signed-in user
 * has at least one matching permission. Otherwise a `<Forbidden />` page
 * is rendered inside the same layout so the sidebar + header stay
 * visible and the user isn't punted out of the shell.
 *
 * Two matching modes:
 *   - `codes`  — explicit any-of list of permission codes.
 *   - `suffix` — any permission whose code ends with the suffix (e.g.
 *                `:notification` to gate the notifications page on
 *                ANY notification eligibility, regardless of resource).
 *
 * Pass exactly one of the two; passing both treats the union as the
 * matcher (rare, but valid).
 *
 * Depends on the bootstrap completing first — `ProtectedRoute` holds on
 * a spinner until `currentUserPermissions` is populated, so by the time
 * this guard renders we can assume the permission set is trustworthy.
 *
 * Usage (inside the protected layout route tree):
 *   <Route element={<RequirePermission codes={["user:read"]} />}>
 *     <Route path="users" element={<AdminUsersPage />} />
 *   </Route>
 *   <Route element={<RequirePermission suffix=":notification" />}>
 *     <Route path="notifications" element={<NotificationsPage />} />
 *   </Route>
 */

import type { PermissionCode } from '@kuanadata/shared';
import { Outlet } from 'react-router-dom';
import { Forbidden } from '@/shared/components/composed/forbidden';
import { selectCurrentUserPermissions, useGlobalState } from '@/shared/store/useGlobalState';

interface RequirePermissionProps {
  /** Any-of semantics — the user passes if they hold at least one code. */
  codes?: readonly PermissionCode[];
  /** Any-of suffix match — passes if any held perm ends with this string. */
  suffix?: string;
}

export function RequirePermission({ codes, suffix }: RequirePermissionProps) {
  const perms = useGlobalState(selectCurrentUserPermissions);
  // `perms === null` means bootstrap hasn't finished, but `ProtectedRoute`
  // already gates on that — this is a defensive fallback.
  const matchesCodes = !!codes && !!perms && codes.some((c) => perms.includes(c));
  const matchesSuffix = !!suffix && !!perms && perms.some((p) => p.endsWith(suffix));
  const allowed = matchesCodes || matchesSuffix;

  if (!allowed) return <Forbidden requiredCodes={codes ?? []} />;
  return <Outlet />;
}
