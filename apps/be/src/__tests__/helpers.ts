/**
 * Shared helpers for the system E2E tests. Tests issue requests
 * directly through `app.fetch()` so we never have to bind a TCP port —
 * the entire suite runs inside one process against the dev Postgres.
 *
 * `signInAs(email, password)` returns a `Cookie` header value with the
 * better-auth session cookie set. Subsequent requests include it via
 * `withSession(cookie, init)`.
 */

import { app } from '../app';

const SYSTEM_ADMIN = {
  email: 'system.admin@thinkdata.com',
  password: 'ThinkData2026!',
};

export interface AuthSession {
  cookie: string;
  userId: string;
  email: string;
}

/** Sign in via better-auth's `/api/auth/sign-in/email` endpoint and
 *  return the session cookie. Throws on failure so the calling test
 *  fails loudly. */
export async function signInAs(
  email: string = SYSTEM_ADMIN.email,
  password: string = SYSTEM_ADMIN.password,
): Promise<AuthSession> {
  const res = await app.fetch(
    new Request('http://test.local/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (!res.ok) {
    throw new Error(`Sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  }
  // better-auth uses `Set-Cookie` to install `better-auth.session_token=...`.
  // We accumulate every Set-Cookie header into one Cookie value.
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) {
    throw new Error('Sign-in succeeded but no session cookie was set');
  }
  const body = (await res.json()) as { user: { id: string; email: string } };
  return { cookie, userId: body.user.id, email: body.user.email };
}

/** Wrap fetch options with the session cookie. */
export function withSession(session: AuthSession, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set('Cookie', session.cookie);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return { ...init, headers };
}

/** Convenience — issue a JSON request via `app.fetch` with auth. */
export async function api<T = unknown>(
  session: AuthSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: Response }> {
  const init = withSession(session, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await app.fetch(new Request(`http://test.local${path}`, init));
  let data: T | null = null;
  if (res.status !== 204) {
    const text = await res.text();
    data = text ? (JSON.parse(text) as T) : null;
  }
  return { status: res.status, data, raw: res };
}

/**
 * Random suffix safe for any of our identifier conventions:
 *   - role.code regex `^[a-z_]+$`
 *   - farmer.farmerCode (free-form, but we want lowercase here too)
 *   - cooperative.code (uppercased at the call site)
 *
 * Returns 8 lowercase letters drawn from the bottom 26 of base-36 only.
 */
export function uniqueSuffix(): string {
  const out: string[] = [];
  while (out.length < 8) {
    const ch = Math.random().toString(36).slice(2);
    for (const c of ch) {
      if (c >= 'a' && c <= 'z') out.push(c);
      if (out.length === 8) break;
    }
  }
  return out.join('');
}

export const TEST_USERS = {
  systemAdmin: {
    email: 'system.admin@thinkdata.com',
    password: 'ThinkData2026!',
  },
  imsManager: {
    // Per-coop split — use the Sankofa IMS manager since the test
    // suite already homes data fixtures to that coop.
    email: 'ims.manager.sankofa@thinkdata.com',
    password: 'ThinkData2026!',
  },
} as const;
