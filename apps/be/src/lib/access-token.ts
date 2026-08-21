/**
 * Access-token plumbing: mint, cookie, verify.
 *
 * Token model — the session cookie is the REFRESH credential, this is the
 * ACCESS credential:
 *
 *   sign-in        → better-auth writes its session cookie (httpOnly, DB
 *                    backed, revocable) AND we mint + set an access token
 *   every request  → `requireAuth` verifies the access token's SIGNATURE
 *                    and claims, no database round trip
 *   token expired  → 401 `token_expired` → client POSTs
 *                    `/api/auth/refresh` → session is checked against the
 *                    DB, a fresh token is minted, the request is retried
 *   revoked        → `lib/token-revocation.ts` rejects tokens minted
 *                    before a permission / status change
 *
 * Verification is a real asymmetric signature check, not a decode. The
 * `jwt` plugin signs with the private half of a keypair in `iam.jwks`
 * (EdDSA by default) and publishes the public half as a JWKS; we verify
 * against that JWKS and additionally pin `iss`/`aud` to our own base URL,
 * so a token from another issuer — or one with a tampered payload,
 * including edited `perms` — fails closed.
 */

import { eq } from 'drizzle-orm';
import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';
import { auth } from '../auth';
import { db } from '../db/client';
import { users } from '../db/schema/iam';
import { clearRevocation } from './token-revocation';
import { accessTokenTtlSeconds } from './token-ttl';

/** Cookie carrying the access token. Shares better-auth's `cookiePrefix`
 *  (see `auth.ts`) so both halves of the pair are obviously ours in
 *  devtools — and, more importantly, so a different better-auth app on
 *  another `localhost` port cannot overwrite it: cookies are keyed by
 *  host, and the port is not part of the key. */
export const COOKIE_PREFIX = 'kuanadata';
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
export const ACCESS_COOKIE = `${COOKIE_PREFIX}.access_token`;

const isProd = process.env.NODE_ENV === 'production';

// Re-exported so the many call sites reading the access TTL alongside the
// cookie helpers don't each need a second import. The definition lives in
// `token-ttl.ts` — `auth.ts` needs it too and cannot import this module.
export { accessTokenTtlSeconds } from './token-ttl';

/** `Set-Cookie` value for the access token. httpOnly so no script can
 *  read it, `lax` so a top-level navigation still carries it (the FE and
 *  API share a site in every deployed environment). */
export function accessCookie(token: string): string {
  const parts = [
    `${ACCESS_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${accessTokenTtlSeconds()}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/** Expire the access cookie — paired with a sign-out. */
export function clearedAccessCookie(): string {
  const parts = [`${ACCESS_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Outcome of a mint attempt. Three cases, NOT two — collapsing them is what
 * logged users out on a transient blip:
 *
 *   ok         — token minted, attach it
 *   no_session — there is genuinely no live session (signed out, deleted,
 *                deactivated). The caller SHOULD treat this as a logout (401).
 *   error      — a session exists (or we couldn't even check) but the mint
 *                failed — a momentary DB / `iam.jwks` hiccup. This says
 *                NOTHING about whether the user is logged in, so the caller
 *                must NOT sign them out; surface a retryable error instead.
 */
export type MintResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'no_session' }
  | { ok: false; reason: 'error' };

/**
 * Mint an access token for whoever owns the session in `headers`.
 *
 * Never throws — a mint failure must not turn a successful sign-in into a
 * 500, and the refresh route needs to tell "logged out" apart from "try
 * again" so a transient failure can't masquerade as a dead session and kick
 * the user to /login (which, behind the Basic-auth gate, also re-pops the
 * browser credential dialog).
 */
export async function mintAccessToken(headers: Headers): Promise<MintResult> {
  try {
    const res = await auth.api.getToken({ headers });
    if (res?.token) {
      // The mint just re-read status + permissions from the database, so this
      // token supersedes anything the blacklist was holding against the user.
      const sub = decodeSubject(res.token);
      if (sub) {
        clearRevocation(sub);
        // Last-login stamp. The old per-request UPDATE lived in `requireAuth`
        // and went away when that stopped touching the database — leaving the
        // users list's "Last Login" column frozen. Minting is the better home:
        // it happens on sign-in and on refresh, so it means "last login", not
        // "last request", and costs one write per token instead of per call.
        void db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, sub))
          .catch((err) => console.error('[access-token] lastLoginAt update failed:', err));
      }
      return { ok: true, token: res.token };
    }
    // getToken produced no token. That is ambiguous — no session at all, or a
    // live session the plugin momentarily couldn't sign for. Fall through to
    // the session probe to tell the two apart.
  } catch {
    // getToken threw (DB / `iam.jwks` blip). Don't conclude "logged out";
    // probe the session below.
  }

  // Ask the session directly. A live session here means the mint failure was
  // transient (→ retryable `error`), NOT a logout.
  try {
    const session = await auth.api.getSession({ headers });
    return session ? { ok: false, reason: 'error' } : { ok: false, reason: 'no_session' };
  } catch {
    // Couldn't even read the session → infrastructure blip, not a logout.
    return { ok: false, reason: 'error' };
  }
}

/** Read `sub` WITHOUT verifying — only ever used on a token we just minted
 *  ourselves, to know whose blacklist entry to clear. Never use this to
 *  authorise anything; that path goes through `verifyAccessToken`. */
function decodeSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

// ── Verification ─────────────────────────────────────────────────────
// The JWKS changes only when a signing key is rotated, so it's cached.
// `createLocalJWKSet` keeps verification in-process (no HTTP fetch of our
// own /jwks endpoint).
let cachedKeySet: ReturnType<typeof createLocalJWKSet> | null = null;
let cachedAt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function keySet(): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (cachedKeySet && Date.now() - cachedAt < JWKS_TTL_MS) return cachedKeySet;
  const jwks = (await auth.api.getJwks()) as unknown as JSONWebKeySet;
  cachedKeySet = createLocalJWKSet(jwks);
  cachedAt = Date.now();
  return cachedKeySet;
}

/** Drop the cached JWKS — call after a key rotation so the next verify
 *  re-reads `iam.jwks` instead of failing on an unknown `kid`. */
export function resetKeySetCache(): void {
  cachedKeySet = null;
  cachedAt = 0;
}

export interface AccessClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string | null;
  status?: string;
  deleted?: boolean;
  isAllCooperative?: boolean;
  perms?: string[];
  iat: number;
}

export type VerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Verify signature + registered claims. `expired` is separated from
 * `invalid` because it is the ONLY outcome worth a refresh attempt — a bad
 * signature means forgery or a rotated key, and the client should
 * re-authenticate rather than retry.
 */
export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  const issuer = process.env.BETTER_AUTH_URL;
  try {
    const { payload } = await jwtVerify(token, await keySet(), {
      // Pinned so a token minted by any other issuer/audience is rejected
      // even if it happens to be signed by a key we know.
      ...(issuer ? { issuer, audience: issuer } : {}),
    });
    if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, claims: payload as AccessClaims };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    // An unknown `kid` usually means the key rotated under a cached JWKS —
    // drop the cache so the NEXT request can succeed instead of every
    // request failing until the TTL lapses.
    if (code === 'ERR_JWKS_NO_MATCHING_KEY') resetKeySetCache();
    return { ok: false, reason: 'invalid' };
  }
}
