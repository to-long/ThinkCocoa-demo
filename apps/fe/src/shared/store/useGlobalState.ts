/**
 * Global, cross-feature UI state — populated AFTER login only.
 *
 * Deliberately NARROW: holds identity data and the signed-in user's
 * effective permissions. System-wide catalogs (all roles, all permissions)
 * intentionally do NOT live here — they'd leak admin data to every
 * authenticated user and bloat the bootstrap. Feature screens that need
 * those catalogs (admin users list, admin roles list) load them into
 * feature-local stores on mount.
 *
 * Fields:
 *   - `currentUser` — the signed-in user's domain profile (UserDetail,
 *     includes their roles + cooperative assignments).
 *   - `currentUserPermissions` — `resource:action` codes effectively
 *     granted via the user's roles. Computed server-side on the detail
 *     endpoint, so we don't have to fan out per-role fetches here.
 *
 * All bootstrap is driven by `useBootstrapGlobalState()` under
 * `ProtectedRoute`. `resetGlobalState()` wipes the store on sign-out so
 * the next login re-bootstraps with fresh data.
 */

import type { PermissionCode } from '@thinkcocoa/shared';
import { createStore } from '@/lib/zustand/createStore';
import type { ApiUserDetail } from '@/shared/api/types';

interface GlobalState {
  // ── Identity ───────────────────────────────────────────────
  /** The signed-in user's full domain profile. `null` = not yet loaded. */
  currentUser: ApiUserDetail | null;
  /**
   * Effective permission codes ("resource:action") for the signed-in user.
   * `null` while bootstrapping. Read-only from the app's perspective —
   * populated alongside `currentUser` during bootstrap.
   */
  currentUserPermissions: string[] | null;

  // ── Bootstrap lifecycle ────────────────────────────────────
  bootstrapLoading: boolean;
  bootstrapError: string | null;
  /**
   * Set to true after the first successful bootstrap. Prevents duplicate
   * fetches when ProtectedRoute re-mounts (e.g. navigating between
   * admin pages).
   */
  bootstrapped: boolean;
}

const initialState: GlobalState = {
  currentUser: null,
  currentUserPermissions: null,
  bootstrapLoading: false,
  bootstrapError: null,
  bootstrapped: false,
};

// Action name labels surface in Redux DevTools action history.
const ACTIONS = {
  bootstrapStart: 'global/bootstrap:start',
  bootstrapSuccess: 'global/bootstrap:success',
  bootstrapError: 'global/bootstrap:error',
  setCurrentUser: 'global/currentUser:set',
  reset: 'global/reset',
} as const;

export const useGlobalState = createStore<GlobalState>(() => initialState, 'GlobalState');

// ── Actions (plain functions, not store methods, to keep the type narrow) ──

export function setBootstrapLoading(): void {
  useGlobalState.setState(
    { bootstrapLoading: true, bootstrapError: null },
    false,
    ACTIONS.bootstrapStart,
  );
}

export function setBootstrapSuccess(payload: {
  currentUser: ApiUserDetail;
  currentUserPermissions: string[];
}): void {
  useGlobalState.setState(
    {
      currentUser: payload.currentUser,
      currentUserPermissions: payload.currentUserPermissions,
      bootstrapLoading: false,
      bootstrapError: null,
      bootstrapped: true,
    },
    false,
    ACTIONS.bootstrapSuccess,
  );
}

export function setBootstrapError(message: string): void {
  useGlobalState.setState(
    { bootstrapLoading: false, bootstrapError: message },
    false,
    ACTIONS.bootstrapError,
  );
}

/**
 * Post-bootstrap setter — used after the user edits their own profile so
 * the header + permission checks stay in sync without a full reload.
 */
export function setCurrentUser(user: ApiUserDetail | null): void {
  useGlobalState.setState(
    {
      currentUser: user,
      currentUserPermissions: user?.permissions ?? null,
    },
    false,
    ACTIONS.setCurrentUser,
  );
}

export function resetGlobalState(): void {
  useGlobalState.setState(initialState, false, ACTIONS.reset);
}

// ── Selectors ────────────────────────────────────────────────

export const selectCurrentUser = (s: GlobalState): ApiUserDetail | null => s.currentUser;

export const selectCurrentUserPermissions = (s: GlobalState): string[] | null =>
  s.currentUserPermissions;

export const selectBootstrapped = (s: GlobalState): boolean => s.bootstrapped;

/**
 * Convenience predicate: does the signed-in user have a specific
 * `resource:action` permission? Returns `false` while bootstrapping so
 * callers can gate UI without flickering admin controls into visibility.
 *
 * Argument is narrowed to `PermissionCode` — the union is derived from
 * the shared `PERMISSION_CATALOG`, so typos become compile errors at
 * call sites like `hasPermission(state, 'usser:update')`.
 */
export function hasPermission(s: GlobalState, code: PermissionCode): boolean {
  if (!s.currentUserPermissions) return false;
  return s.currentUserPermissions.includes(code);
}

/**
 * Hook variant of `hasPermission` — subscribes the component to the
 * permissions slice so it re-renders if the user's grant set changes
 * (rare, but happens after a role-edit + bootstrap re-fetch). Use
 * this in feature components to gate Create / Edit / Delete buttons.
 */
export function usePermission(code: PermissionCode): boolean {
  return useGlobalState((s) => hasPermission(s, code));
}
