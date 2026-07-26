/**
 * Shared ApiError + helper used by every SWR hook in this folder.
 *
 * The HTTP layer is the generated `impact-cocoa-client` SDK (hey-api). Its
 * calls resolve to `{ data, error, response }` — this module provides
 * `unwrap()` which turns that shape into either a resolved value or an
 * `ApiError` throw. That keeps `useApiErrorMessage` — and every caller that
 * already catches `ApiError` — working unchanged.
 */

import type { ValidationErrorBody } from '@cocoaimpact/shared';
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
// isn't allowed to touch this resource. Send them to the /403 landing
// (rendered inside the shell so the sidebar stays for navigation).
// Guarded so a burst of 403s redirects once, and skipped when already
// on /403 to avoid a reload loop.
let handlingForbidden = false;
function maybeRedirectForbidden(status: number): void {
  if (status !== 403 || handlingForbidden) return;
  if (typeof window === 'undefined' || window.location.pathname === '/403') return;
  handlingForbidden = true;
  window.location.assign('/403');
}

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
  // Side-effects: bounce to /login if the session went invalid (401),
  // or to /403 if it's a permission-denied (403).
  maybeForceSignOut(status);
  maybeRedirectForbidden(status);
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
const REFRESHABLE_CODES = new Set(['token_expired', 'token_revoked', 'no_access_token']);
let refreshInFlight: Promise<boolean> | null = null;

function isRefreshable(body: unknown): boolean {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && REFRESHABLE_CODES.has(code);
}

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared in `finally` so the NEXT expiry gets a fresh attempt
      // rather than reusing this resolved promise forever.
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
    // Retried exactly once: if the replay also 401s, `toApiError` runs the
    // shared sign-out path, which is the correct end state for a dead
    // refresh credential.
    if (isRefreshable(body) && (await refreshAccessToken())) {
      res = await send();
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
 * deliberately does NOT run the shared 401→/login and 403→/403 redirect
 * side-effects (it throws a plain Error, never an ApiError): a speculative
 * prefetch that gets rejected — a forbidden endpoint, a transient blip on
 * tab-resume — must stay silent and never navigate the app. Returns parsed
 * JSON on success so an SWR cache hit matches exactly what the page's own
 * `apiFetch` hook would have produced.
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
