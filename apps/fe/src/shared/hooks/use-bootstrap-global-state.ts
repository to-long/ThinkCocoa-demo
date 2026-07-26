/**
 * Runs once after the user is authenticated: fetches the signed-in user's
 * full profile (which now carries their effective `permissions: string[]`)
 * and hydrates `useGlobalState` in a single transaction.
 *
 * Kicked off from inside `ProtectedRoute` so we never fetch pre-login.
 * Safe against re-mounts — the store's `bootstrapped` flag short-circuits
 * duplicate runs. Call `resetGlobalState()` on sign-out so the next login
 * re-bootstraps.
 *
 * System catalogs (all roles / all permissions) are NOT fetched here — that
 * would leak admin-only data to every authenticated user. Admin screens
 * that need them load them into feature-local stores on mount.
 */

import { getApiUsersMe } from '@thinkcocoa/shared/think-cocoa-client';
import { useEffect } from 'react';
import { unwrap } from '@/shared/api/fetcher';
import type { ApiUserDetail } from '@/shared/api/types';
import {
  setBootstrapError,
  setBootstrapLoading,
  setBootstrapSuccess,
  useGlobalState,
} from '@/shared/store/useGlobalState';

/**
 * Caller passes the session user id — ProtectedRoute already owns
 * `authClient.useSession()`. Taking the id as a prop keeps this hook's
 * hook-count stable across renders and avoids the "more hooks than
 * the previous render" error that came from subscribing to the session
 * store twice on the render path.
 */
export function useBootstrapGlobalState(sessionUserId: string | undefined): void {
  const bootstrapped = useGlobalState((s) => s.bootstrapped);

  useEffect(() => {
    if (bootstrapped) return;
    if (!sessionUserId) return; // no session → ProtectedRoute will redirect
    let cancelled = false;

    setBootstrapLoading();
    (async () => {
      try {
        // `/api/users/me` is the self-profile endpoint — gated only by
        // `requireAuth`, so field-tier roles without `user:read` can still
        // bootstrap the shell. `GET /api/users/:id` remains the admin path.
        const userRes = await getApiUsersMe();
        const currentUser = unwrap(userRes) as ApiUserDetail;

        if (cancelled) return;
        setBootstrapSuccess({
          currentUser,
          currentUserPermissions: currentUser.permissions ?? [],
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setBootstrapError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, sessionUserId]);
}
