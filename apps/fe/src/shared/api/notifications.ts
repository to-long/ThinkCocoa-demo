/**
 * Notifications hooks — bell badge count + SSE live stream.
 *
 * The badge number is the source of truth in `useUnreadNotificationCount`
 * (SWR key, scoped to `since` cursor). The stream pushes a `notification`
 * event per qualifying audit row; consumers wire this to optimistically
 * `mutate(count + 1)` so the badge updates without a refetch.
 *
 * Reconnect strategy: native EventSource auto-retries. On `open` the
 * caller should `mutate(unreadCountKey)` to reconcile any events
 * missed during the disconnect — DB is the single source of truth.
 */

import {
  getApiNotificationsPreferences,
  getApiNotificationsUnreadCount,
  putApiNotificationsPreferences,
} from '@cocoaimpact/shared/impact-cocoa-client';
import { useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ApiError, apiFetch, unwrap } from './fetcher';

export interface UnreadCountResponse {
  count: number;
  /** Highest audit id visible to the caller — the bell writes this back
   *  as its read cursor. Rows aren't in id order by time, so the max id
   *  of the loaded page would strand newer rows on later pages. */
  latestId?: number | null;
}

export function unreadCountKey(since: number | null) {
  return ['/api/notifications/unread-count', { since: since ?? null }] as const;
}

/**
 * Bell badge count. Pass `since` (highest audit id the user has
 * acknowledged — typically from localStorage). When null, the BE
 * counts the last 24h as a sane initial window.
 *
 * Cache strategy:
 *  - `dedupingInterval: 60_000` → within a 60 s window, repeat
 *    `mutate()` / re-mount calls don't trigger a fresh fetch.
 *  - `refreshInterval: 60_000`  → 60 s polling fallback in case the
 *    SSE stream drops without `EventSource` knowing (network
 *    transitions, server restart). Cheap query — single indexed
 *    `count(*)` per user.
 *  - SSE `notification` events still force an immediate revalidate
 *    (see `useNotificationStream` below) — the timer is only the
 *    floor, not the cadence.
 *  - `revalidateOnFocus: false` because focus + 60 s polling +
 *    SSE-driven invalidation already cover every interactive path.
 */
export function useUnreadNotificationCount(since: number | null = null) {
  return useSWR<UnreadCountResponse>(
    unreadCountKey(since),
    async () => {
      try {
        const res = await getApiNotificationsUnreadCount(
          since ? { query: { since: String(since) } } : undefined,
        );
        return unwrap(res) as UnreadCountResponse;
      } catch (err) {
        // No `:notification` perm → BE returns 403; treat as zero so
        // the badge silently stays empty for unauthorised users.
        if (err instanceof ApiError && err.status === 403) {
          return { count: 0, latestId: null };
        }
        throw err;
      }
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      refreshInterval: 60_000,
    },
  );
}

/**
 * Open the SSE stream and bump the unread count by 1 on each
 * incoming event. Reconnects re-fetch the count from the server to
 * reconcile.
 *
 * Pass the same `since` cursor the badge component uses so the SWR
 * key matches.
 *
 * `onEvent` is an optional callback that fires on every server
 * `notification` event AND on `open`. Consumers (e.g. the bell
 * dropdown using `useSWRInfinite`) hook it to their LOCAL `mutate`
 * to invalidate caches that the global predicate can't reach.
 * Why we need this: `useSWRInfinite` stores its cache under a
 * wrapped key (`$inf$…`), not a raw tuple — `mutate((k) => …)` from
 * `useSWRConfig` doesn't match it. Passing the local `mutatePages`
 * via this callback is the supported way to reach it.
 */
export function useNotificationStream(since: number | null = null, onEvent?: () => void) {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream', {
      withCredentials: true,
    });

    const onNotification = () => {
      // Optimistic +1 so the badge bumps instantly (good UX), AND
      // force a real revalidation so the cache stays accurate even
      // inside the 60 s dedup window. `revalidate: true` here
      // bypasses dedupingInterval — SWR re-runs the fetcher even if
      // the last fetch was <60 s ago, because the SSE event is the
      // authoritative "data changed" signal.
      mutate(
        unreadCountKey(since),
        (prev: UnreadCountResponse | undefined) => ({
          count: Math.min(999, (prev?.count ?? 0) + 1),
          latestId: prev?.latestId ?? null,
        }),
        { revalidate: true },
      );
      // Let consumers invalidate their own caches (e.g. the bell
      // dropdown list) — see docstring above for why we can't do
      // this via a global predicate.
      onEvent?.();
    };

    const onOpen = () => {
      // (Re)connection established — reconcile from server.
      mutate(unreadCountKey(since));
      onEvent?.();
    };

    es.addEventListener('notification', onNotification);
    es.addEventListener('open', onOpen);
    // `ping` events keep the connection alive but carry no payload —
    // ignore them.

    return () => {
      es.removeEventListener('notification', onNotification);
      es.removeEventListener('open', onOpen);
      es.close();
    };
  }, [since, mutate, onEvent]);
}

// ── Notification preferences (Profile Settings page) ──────────────

export interface NotificationPreferences {
  /** Resources granted via `:notification` perms — what the
   *  toggles render (one row per granted resource). */
  granted: string[];
  /** Granted resources NOT opted out — current bell-stream filter. */
  enabled: string[];
}

export const notificationPreferencesKey = () => ['/api/notifications/preferences'] as const;

export function useNotificationPreferences() {
  return useSWR<NotificationPreferences>(
    notificationPreferencesKey(),
    async () => {
      const res = await getApiNotificationsPreferences();
      return unwrap(res) as NotificationPreferences;
    },
    { revalidateOnFocus: false },
  );
}

/** Replace the user's enabled-resource set. Caller passes the
 *  full ON list; anything granted-but-missing is treated as off. */
export async function updateNotificationPreferences(
  enabled: string[],
): Promise<NotificationPreferences> {
  const res = await putApiNotificationsPreferences({ body: { enabled } });
  return unwrap(res) as NotificationPreferences;
}

/**
 * Persist the bell's read cursor. Server-side (`iam.user_notification_reads`)
 * so "seen" follows the account rather than one browser's localStorage.
 * Monotonic on the BE — an older id never rolls the cursor back.
 */
export async function markNotificationsRead(
  upToAuditId: number,
): Promise<{ lastReadAuditId: number }> {
  return apiFetch<{ lastReadAuditId: number }>('/api/notifications/mark-read', {
    method: 'POST',
    body: JSON.stringify({ upToAuditId }),
  });
}
