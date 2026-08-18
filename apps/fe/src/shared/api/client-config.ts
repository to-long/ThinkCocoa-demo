/**
 * One-shot configuration for the generated `kuana-data-client` SDK.
 *
 * Imported for side effect from `src/index.tsx` BEFORE any component is
 * rendered, so every SDK call goes out with the right `baseUrl` and
 * `credentials: 'include'` (better-auth cookie session).
 *
 * Resolution rules:
 *   - Dev (`MODE === 'development'`): empty `baseUrl` → SDK issues
 *     same-origin requests like `GET /api/users`, which the rsbuild
 *     dev server proxies to the BE. Avoids CORS entirely and keeps
 *     better-auth session cookies on the FE origin.
 *   - Anything else: `PUBLIC_API_URL` from the build env is REQUIRED.
 *     No code-level fallback — a missing var should fail the build
 *     loudly rather than silently target localhost in production.
 */

import { client } from '@kuanadata/shared/kuana-data-client';
import { isRefreshable, refreshAccessToken } from './fetcher';

const isDev = import.meta.env.MODE === 'development';
const publicApiUrl = import.meta.env.PUBLIC_API_URL as string | undefined;

const baseUrl = isDev
  ? ''
  : (publicApiUrl ??
    (() => {
      throw new Error('PUBLIC_API_URL is required in apps/fe/.env for production builds.');
    })());

/**
 * Access-token refresh for the generated SDK — the SAME single-flight
 * refresh the hand-written `apiFetch` uses (see `fetcher.ts`). Without
 * this, an SDK call is the one path that can NOT recover a stale access
 * token: the very first protected call after sign-in has no access-token
 * cookie yet (`no_access_token`), and the JWT cookie expires every 30 min
 * on the demo box. `unwrap` → `toApiError` turns any SDK 401 straight into
 * a global sign-out, so the fresh-login bootstrap (`getApiUsersMe`) kicked
 * the user back to /login instead of minting a token and retrying.
 *
 * We clone the Request BEFORE the first send so a rejected POST/PUT body
 * can be replayed. `unavailable` throws a plain Error (backend unreachable
 * says nothing about the session → no sign-out); `rejected` falls through
 * with the original 401 so `toApiError` runs the correct sign-out.
 */
const fetchWithRefresh: typeof fetch = async (input, init) => {
  // The SDK always calls with a built Request; normalize anyway so the
  // signature matches `typeof fetch` and a clone can be replayed.
  const request = input instanceof Request ? input : new Request(input, init);
  const res = await fetch(request.clone());
  if (res.status !== 401) return res;

  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    // non-JSON 401 — not refreshable, return as-is
  }
  if (!isRefreshable(body)) return res;

  const outcome = await refreshAccessToken();
  if (outcome === 'ok') return await fetch(request.clone());
  if (outcome === 'unavailable') {
    throw new Error('Auth refresh unavailable — backend unreachable');
  }
  return res; // 'rejected' — session really is gone; let toApiError sign out
};

client.setConfig({ baseUrl, credentials: 'include', fetch: fetchWithRefresh });

export { client };
