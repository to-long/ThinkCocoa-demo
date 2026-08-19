/**
 * Shared ApiError + helper used by every SWR hook in this folder.
 *
 * The HTTP layer is the generated `kuana-data-client` SDK (hey-api). Its
 * calls resolve to `{ data, error, response }` — this module provides
 * `unwrap()` which turns that shape into either a resolved value or an
 * `ApiError` throw. That keeps `useApiErrorMessage` — and every caller that
 * already catches `ApiError` — working unchanged.
 */

import type { ValidationErrorBody } from '@kuanadata/shared';
import { type Arguments, mutate as globalMutate } from 'swr';
import { authClient } from '@/lib/auth-client';

// `PUBLIC_API_URL` is baked at build time from apps/fe/.env. In dev
// mode (MODE === 'development') we leave it empty so requests stay
// same-origin and the rsbuild dev server proxies them to the BE.
// In any other build, an empty/missing var means the deploy was
// misconfigured — throw rather than silently pointing at localhost.
const isDev = import.meta.env.MODE === 'development';
const publicApiUrl = import.meta.env.PUBLIC_API_URL as string | undefined;

export const API_BASE = isDev
  ? ''
  : (publicApiUrl ??
    (() => {
      throw new Error('PUBLIC_API_URL is required in apps/fe/.env for production builds.');
    })());

/**
 * Thrown for any non-2xx response. Callers can inspect `status`, and when the
 * BE returns the structured `{ error: 'validation_failed', issues: [...] }`
 * shape, `validation.issues` will be populated.
 */
export class ApiError extends Error {
  status: number;
  validation?: ValidationErrorBody;
  body?: unknown;

  constructor(
    status: number,
    message: string,
    opts: { validation?: ValidationErrorBody; body?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.validation = opts.validation;
    this.body = opts.body;
  }

  /** First validation issue, if any. Convenience for the UI. */
  get firstIssue() {
    return this.validation?.issues?.[0];
  }
}

// Any 401 means the session is no longer valid — either it expired, was
// revoked (the user got soft-deleted mid-session, which drops their
// session rows), or the account was deactivated (`requireAuth` now
// returns 401 `{ error: 'session_invalid' }` for that, NOT 403). Force a
// sign-out to clear the stale better-auth cookie, then hard-redirect to
// /login (a full reload drops all in-memory Zustand + SWR state, so the
// next user starts clean). 403 is deliberately NOT handled here — it means
// permission-denied (authz), and a user merely lacking a permission must
// stay logged in. The module-level guard collapses the burst of concurrent
// 401s a dashboard fires into a single sign-out + redirect.
// Public/guest routes — a visitor here has no session to invalidate, so a
// 401 from a stray background request (e.g. an SWR focus-revalidation when
// the user tabs back to /login) must NOT trigger the sign-out + hard
// redirect: that would full-reload the page for no reason. Mirrors the
// `=== '/403'` guard on the 403 handler below.
const GUEST_PATHS = ['/login', '/forgot-password', '/reset-password', '/magic-link'];

let handlingInvalidSession = false;
function maybeForceSignOut(status: number): void {
  if (status !== 401 || handlingInvalidSession) return;
  if (typeof window === 'undefined') return;
  if (GUEST_PATHS.includes(window.location.pathname)) return;
  handlingInvalidSession = true;
  void authClient.signOut().finally(() => {
    window.location.assign('/login');
  });
}

// 403 = permission-denied (authz): the session is fine, the user just
// isn't allowed to touch THIS resource. We deliberately do NOT navigate on
// a 403 — page-level authorization is the router's job (`RequirePermission`
// renders <Forbidden/> inline from the user's cached permission set, no API
// call needed). A 403 here therefore only ever comes from a *data* call —
// often a secondary/background one on a page the user is legitimately
// allowed to view (a dashboard widget, a filter dropdown). Redirecting the
// whole app to /403 for such a call was the root cause of pages the user
// COULD see getting yanked to "Access denied". A 403 now just throws an
// ApiError the calling hook/component handles locally (usually: show empty).

function isValidationError(body: unknown): body is ValidationErrorBody {
  return (
    !!body &&
    typeof body === 'object' &&
    (body as { error?: string }).error === 'validation_failed' &&
    Array.isArray((body as { issues?: unknown }).issues)
  );
}

/**
 * Build an `ApiError` from an SDK failure envelope.
 *
 * The generated client returns `{ data?, error?, response? }` where:
 *  - `error` is the parsed JSON body for non-2xx responses (or a network
 *    error object if `response` is missing);
 *  - `response` is a `Response` when we actually hit the server.
 */
export function toApiError(error: unknown, response?: Response): ApiError {
  const status = response?.status ?? 0;
  // Side-effect: bounce to /login if the session went invalid (401). A 403
  // is intentionally NOT redirected — see the note above `toApiError`'s
  // helpers: authz is enforced at the route layer, and a data-call 403 must
  // fail locally instead of hijacking navigation.
  maybeForceSignOut(status);
  const validation = isValidationError(error) ? error : undefined;

  let message: string;
  if (validation) {
    message = `Validation failed: ${validation.issues[0]?.code ?? 'unknown'}`;
  } else if (error && typeof error === 'object' && 'error' in error) {
    const txt = (error as { error: unknown }).error;
    message =
      typeof txt === 'string' && txt.length > 0 ? txt : response?.statusText || `HTTP ${status}`;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = response?.statusText || `HTTP ${status}`;
  }

  return new ApiError(status, message, { validation, body: error });
}

/**
 * Unwrap an SDK call result. On success returns `data`; on failure throws an
 * `ApiError` so SWR / callers can handle it consistently.
 *
 * Usage:
 *   const res = await getApiUsers({ query: {...} });
 *   return unwrap(res);
 */
/**
 * Lightweight raw-fetch helper for endpoints not yet covered by the
 * generated SDK (or where we don't want to regenerate just for one
 * call). Mirrors `unwrap` semantics: throws `ApiError` on non-2xx,
 * returns parsed JSON on success, returns `undefined` for 204.
 *
 * Always sends `credentials: 'include'` so the better-auth cookie + the
 * `active-coop-id` cookie travel with the request.
 */
// ── Access-token refresh ─────────────────────────────────────────────
// Auth is an access token (short-lived, signed, httpOnly cookie) plus the
// session cookie acting as the refresh credential. A 401 carrying one of
// these codes means "the access token is stale, not the login" — so try a
// single refresh and replay the request instead of bouncing to /login.
//
// One shared in-flight promise: a dashboard fires a dozen requests at once
// and they all fail together, so they must all await the SAME refresh
// rather than each minting a token and racing to overwrite the cookie.
// `token_invalid` is in here too, and deliberately so: an access token we
// cannot verify says nothing about the SESSION, which is the credential
// that decides whether the user is logged in. It shows up for a token left
// over from a rotated signing key — or, on a dev box, for a token another
// app dropped in the shared `localhost` cookie jar (see `auth.ts`'s
// cookiePrefix). Refreshing overwrites the bad token with a good one; only
// the refresh endpoint's own 401 ends the session.
const REFRESHABLE_CODES = new Set([
  'token_expired',
  'token_revoked',
  'token_invalid',
  'no_access_token',
]);

/**
 * Three outcomes, NOT two. Collapsing them into a boolean is what made a
 * backend restart look identical to an expired session: the refresh `fetch`
 * threw, the caller read `false` as "you are logged out", and the tab was
 * kicked to /login while its 7-day session sat perfectly valid in the
 * database.
 *
 *   ok          — new token issued, replay the request
 *   rejected    — the server said no (401/403): the session really is gone,
 *                 so the caller falls through to the shared sign-out
 *   unavailable — we never got an answer (server restarting, connection
 *                 dropped, 5xx). Says nothing about the session, so the
 *                 caller must surface a plain error and leave the user
 *                 signed in.
 */
type RefreshOutcome = 'ok' | 'rejected' | 'unavailable';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export function isRefreshable(body: unknown): boolean {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && REFRESHABLE_CODES.has(code);
}

async function attemptRefresh(): Promise<RefreshOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) return 'ok';
    // Only the refresh endpoint's own rejection proves the credential is
    // dead. A 500 or a proxy error does not.
    return res.status === 401 || res.status === 403 ? 'rejected' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function refreshAccessToken(): Promise<RefreshOutcome> {
  // One shared attempt: a dashboard fires a dozen requests that all expire
  // together, and they must await the SAME refresh rather than racing to
  // overwrite the cookie.
  refreshInFlight ??= (async () => {
    try {
      const first = await attemptRefresh();
      if (first !== 'unavailable') return first;
      // A dev-server restart takes about a second; one short retry swallows
      // it instead of bouncing the user to the login screen.
      await new Promise((r) => setTimeout(r, 500));
      return await attemptRefresh();
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<TData = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<TData> {
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      ...init,
    });

  let res = await send();

  if (res.status === 401) {
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      // non-JSON 401 — not refreshable, fall through to the throw below
    }
    if (isRefreshable(body)) {
      const outcome = await refreshAccessToken();
      if (outcome === 'ok') {
        // Retried exactly once: if the replay also 401s, `toApiError` runs
        // the shared sign-out, the correct end state for a dead credential.
        res = await send();
      } else if (outcome === 'unavailable') {
        // Deliberately NOT an ApiError: `toApiError` triggers the global
        // 401 → sign-out. The backend is unreachable, which says nothing
        // about whether the user is still logged in.
        throw new Error('Auth refresh unavailable — backend unreachable');
      }
      // 'rejected' falls through to the throw below, i.e. sign out.
    }
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // body might be empty or non-JSON
    }
    throw toApiError(body, res);
  }
  if (res.status === 204) return undefined as TData;
  return (await res.json()) as TData;
}

/**
 * Speculative fetch for PREFETCH only. Same wire call as `apiFetch` but it
 * deliberately does NOT run the shared 401→/login sign-out side-effect (it
 * throws a plain Error, never an ApiError): a speculative prefetch that gets
 * rejected — a forbidden endpoint, a transient blip on tab-resume — must
 * stay silent and never sign the user out. (A 403 never navigates from
 * `apiFetch` either, so there is nothing extra to suppress there.) Returns
 * parsed JSON on success so an SWR cache hit matches exactly what the page's
 * own `apiFetch` hook would have produced.
 */
export async function quietFetch<TData = unknown>(path: string): Promise<TData> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`prefetch failed: ${res.status}`);
  if (res.status === 204) return undefined as TData;
  return (await res.json()) as TData;
}

/**
 * Warm a key's SWR cache with `fetcher`'s result — the route-prefetch
 * primitive. Deliberately NOT SWR's `preload`: `preload` memoises the
 * in-flight promise per key and only releases it when a component consumes
 * it, so a route the user never visits keeps that promise indefinitely.
 * On a tenant (coop) switch we wipe the DATA cache but can't reach SWR's
 * preload map, so a re-warm would just replay the previous coop's promise
 * → stale rows on the next visit. Writing the resolved value straight into
 * the cache via `mutate` sidesteps that: the wipe clears it and a re-warm
 * overwrites it with the new coop's data. A rejected speculative fetch
 * (forbidden endpoint, tab-resume blip) is swallowed and never written, so
 * it can't poison a key with an error state.
 */
// Monotonic tenant generation. `setActiveCoop` bumps it on every coop
// switch so an in-flight `warm()` that STARTED under the previous coop
// can't write its (now stale) result into the freshly-wiped cache.
let coopEpoch = 0;
export function bumpCoopEpoch(): void {
  coopEpoch += 1;
}

export function warm<TData>(key: Arguments, fetcher: () => Promise<TData>): Promise<unknown> {
  // Returns an always-resolved promise so existing `.catch(() => {})` call
  // sites stay valid; the error is already swallowed here.
  const startedAt = coopEpoch;
  return fetcher().then(
    (data) => {
      // Drop the result if the tenant changed while this fetch was in flight.
      if (coopEpoch !== startedAt) return;
      return globalMutate(key, data, { revalidate: false });
    },
    () => {
      // speculative — a failed warm costs nothing and must stay silent
    },
  );
}

export function unwrap<TData>(result: {
  data?: TData;
  error?: unknown;
  response?: Response;
}): TData {
  if (result.error !== undefined && result.error !== null) {
    throw toApiError(result.error, result.response);
  }
  if (result.response && !result.response.ok) {
    // Defensive: some SDK edges resolve with empty error but a non-OK response.
    throw toApiError(undefined, result.response);
  }
  return result.data as TData;
}
