/**
 * Component-level permission gate — renders its children only when the
 * signed-in user satisfies the permission check, otherwise renders the
 * `fallback` (default `null`).
 *
 * Companion to the route-level `RequirePermission`:
 *   - `RequirePermission` is for routes (renders `<Outlet />` + a
 *     `<Forbidden />` page on miss). Use it when a whole page must be
 *     gated.
 *   - `PermissionGate` is for individual UI affordances — buttons,
 *     menu items, table actions, etc. — that should silently vanish
 *     when the user can't use them.
 *
 * Two matching modes (any-of; both can be combined — passing both ORs
 * them):
 *   - `codes`  — explicit any-of list. Single-code case is just a
 *                one-element array (`codes={['farmer:create']}`).
 *                Always plural so call sites don't have to remember
 *                which singular/plural form to use.
 *   - `suffix` — any held permission ending with this string (e.g.
 *                `:notification` to gate on ANY notification
 *                eligibility regardless of resource).
 *
 * Examples:
 *   <PermissionGate codes={['farmer:notification']}>
 *     <Button>History</Button>
 *   </PermissionGate>
 *
 *   <PermissionGate codes={['farmer:create', 'farmer:import']}>
 *     <NewFarmerMenu />
 *   </PermissionGate>
 *
 *   <PermissionGate suffix=":notification" fallback={<ReadOnlyHint />}>
 *     <SubscribeButton />
 *   </PermissionGate>
 *
 * Why a HOC instead of inline `usePermission(code) && <Btn/>`:
 *   - Keeps the gating logic in one place — when the global perm store
 *     shape evolves, only this file changes.
 *   - The component name itself documents the intent ("this part of
 *     the UI is permission-gated") so a reviewer scanning JSX doesn't
 *     have to spelunk into a `canX` boolean to figure out why a
 *     button might disappear.
 *   - Compose-friendly — nests cleanly with other JSX guards.
 */

import type { PermissionCode } from '@thinkcocoa/shared';
import type { ReactNode } from 'react';
import { selectCurrentUserPermissions, useGlobalState } from '@/shared/store/useGlobalState';

interface PermissionGateProps {
  /** Any-of list — passes if the user holds at least one code.
   *  Always plural; for a single code, pass a one-element array. */
  codes?: readonly PermissionCode[];
  /** Any-of suffix match — passes if any held perm ends with the suffix. */
  suffix?: string;
  /** Rendered when the check fails. Defaults to `null` (vanishes). */
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ codes, suffix, fallback = null, children }: PermissionGateProps) {
  const perms = useGlobalState(selectCurrentUserPermissions);
  // `perms === null` means bootstrap hasn't finished. ProtectedRoute
  // already gates the entire app on that; reaching here without a
  // permissions array would be a bug, but we still treat it as
  // "not yet allowed" to avoid flashing UI we don't have a verdict on.
  const matchesCodes = !!codes && !!perms && codes.some((c) => perms.includes(c));
  const matchesSuffix = !!suffix && !!perms && perms.some((p) => p.endsWith(suffix));
  const allowed = matchesCodes || matchesSuffix;
  return <>{allowed ? children : fallback}</>;
}
