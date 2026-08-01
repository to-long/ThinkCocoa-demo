/**
 * Shared sign-out routine.
 *
 * Extracted from the user menu so any surface that needs to log the user
 * out — the avatar menu, the no-access landing screen — runs the exact
 * same teardown instead of drifting copies. Clears the auth session, the
 * zustand identity/permission store, the active-coop selection, the
 * per-user notification cursor, and the whole SWR cache, then routes to
 * `/login`.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { mutate as globalSwrMutate } from 'swr';
import { authClient } from '@/lib/auth-client';
import { resetActiveCoop } from '@/shared/store/useActiveCoop';
import { resetGlobalState } from '@/shared/store/useGlobalState';

export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();

  return useCallback(async () => {
    await authClient.signOut();
    // Wipe cached state so the next user's session doesn't inherit any
    // admin catalogs or identity from this one:
    //   - Global zustand store = identity + effective permissions.
    //   - SWR cache = users/roles/permissions lists + dialog catalogs.
    resetGlobalState();
    resetActiveCoop();
    // Per-user notification cursor persists in localStorage across
    // sessions — drop it so user B logging in on the same browser doesn't
    // inherit user A's high-water mark and see 0 unread until new events
    // accrue past it.
    try {
      window.localStorage.removeItem('notif:lastSeenAuditId');
    } catch {
      /* localStorage may be disabled in some browser modes */
    }
    // `() => true` clears every SWR key; `revalidate: false` stops a
    // refetch with the now-expired cookie.
    await globalSwrMutate(() => true, undefined, { revalidate: false });
    navigate('/login');
  }, [navigate]);
}
