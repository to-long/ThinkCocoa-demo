/**
 * Active cooperative — the single tenant the signed-in user is
 * currently scoped into. Multi-tenant model: one signed-in user can
 * have access to multiple coops via `iam.user_cooperative_assignments`
 * (or to ALL of them via `users.is_all_cooperative`); the header
 * switcher picks ONE at a time.
 *
 * Persistence — TWO sinks kept in sync:
 *   1. localStorage (zustand persist) — survives page reload, lets
 *      the switcher render the right state on first paint.
 *   2. `active-coop-id` cookie — single coop UUID. Travels on every
 *      HTTP request so the BE can scope queries without each list
 *      page having to thread the id through query params.
 *
 * BE security: never trusts the cookie blindly. The auth middleware
 * verifies the id is in the user's allowed set so a tampered cookie
 * can't widen scope.
 *
 * Sign-out must call `resetActiveCoop()` to wipe both sinks so the
 * next user doesn't inherit a stale tenant choice.
 */

import { mutate as globalMutate } from 'swr';
import { createStore } from '@/lib/zustand/createStore';
import { bumpCoopEpoch } from '@/shared/api/fetcher';

export interface ActiveCoop {
  cooperativeId: string;
  cooperativeCode: string;
  cooperativeName: string;
}

interface ActiveCoopState {
  active: ActiveCoop | null;
}

const initialState: ActiveCoopState = {
  active: null,
};

const ACTIONS = {
  set: 'activeCoop/set',
  reset: 'activeCoop/reset',
} as const;

const COOKIE_NAME = 'active-coop-id';

function writeCookie(coop: ActiveCoop | null): void {
  if (typeof document === 'undefined') return;
  // 30-day max-age — same horizon as the better-auth session.
  // `SameSite=Lax` lets top-level navigations carry the cookie
  // (login redirects, magic links) without exposing it to
  // cross-site fetches. `path=/` so every API route sees it.
  if (!coop) {
    // biome-ignore lint/suspicious/noDocumentCookie: cookie-store not supported in all target browsers
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
    return;
  }
  // biome-ignore lint/suspicious/noDocumentCookie: cookie-store not supported in all target browsers
  document.cookie = `${COOKIE_NAME}=${coop.cooperativeId}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export const useActiveCoop = createStore<ActiveCoopState>(() => initialState, 'ActiveCoop', {
  persistKeys: ['active'],
});

export function setActiveCoop(coop: ActiveCoop): void {
  const prevId = useActiveCoop.getState().active?.cooperativeId ?? null;
  writeCookie(coop);
  useActiveCoop.setState({ active: coop }, false, ACTIONS.set);
  // When the tenant scope changes, every cached SWR response is now stale
  // (BE filters by the `active-coop-id` cookie we just rewrote). Wipe the
  // ENTIRE SWR cache to `undefined` and revalidate — nothing from the
  // previous coop must survive, including data that was speculatively
  // prefetched (route warm-up) but never displayed. Setting each key to
  // `undefined` clears it; `revalidate: true` refetches whatever is mounted.
  // Prefetch entries are refilled for the new coop by the warm-up re-run
  // keyed on the active coop id (see `App.tsx`); `warm()` writes straight to
  // the cache (not SWR `preload`, whose memoised promise would replay the
  // old coop), and its epoch guard drops any in-flight old-coop fetch.
  //
  // We deliberately do NOT exclude the cooperatives catalog anymore: a
  // redundant refetch of that coop-invariant list is cheaper than reasoning
  // about which keys are safe to keep, and guarantees a clean slate.
  if (prevId !== coop.cooperativeId) {
    // Bump the tenant generation FIRST so any warm/prefetch already in
    // flight for the previous coop is discarded on resolve instead of
    // repopulating the cache we're about to wipe.
    bumpCoopEpoch();
    void globalMutate(() => true, undefined, { revalidate: true });
  }
}

export function resetActiveCoop(): void {
  writeCookie(null);
  useActiveCoop.setState(initialState, false, ACTIONS.reset);
}

// ── Selectors ────────────────────────────────────────────────
// Defensive: an older version of this store kept `active` as an array;
// `Array.isArray` falls back to `null` so legacy localStorage payloads
// don't crash on `.cooperativeId` access.
export const selectActiveCoop = (s: ActiveCoopState): ActiveCoop | null => {
  if (Array.isArray(s.active)) return null;
  return s.active;
};

export const selectActiveCoopId = (s: ActiveCoopState): string | null =>
  selectActiveCoop(s)?.cooperativeId ?? null;
