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

import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';
import { auth } from '../auth';
import { clearRevocation } from './token-revocation';

/** Cookie carrying the access token. Prefixed like better-auth's own so
 *  both are obviously one auth pair in devtools. */
export const ACCESS_COOKIE = 'better-auth.access_token';

const isProd = process.env.NODE_ENV === 'production';

/** Seconds — mirrors `ACCESS_TOKEN_TTL` (auth.ts) so the cookie and the
 *  token expire together. Parsed from the same `15m` style string. */
export function accessTokenTtlSeconds(): number {
  const raw = process.env.ACCESS_TOKEN_TTL ?? '15m';
  const m = /^(\d+)\s*([smhd])?$/.exec(raw.trim());
  if (!m) return 15 * 60;
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return n * mult;
}

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
 * Mint an access token for whoever owns the session in `headers`.
 * Returns null when there is no live session — the caller decides whether
 * that's a 401 (refresh) or simply "nothing to attach" (sign-out).
 */
export async function mintAccessToken(headers: Headers): Promise<string | null> {
  try {
    const res = await auth.api.getToken({ headers });
    if (!res?.token) return null;
    // The mint just re-read status + permissions from the database, so this
    // token supersedes anything the blacklist was holding against the user.
    const sub = decodeSubject(res.token);
    if (sub) clearRevocation(sub);
    return res.token;
  } catch {
    // No session, deleted user, or the plugin failed to reach `iam.jwks`.
    // Never throw from here: a mint failure must not turn a successful
    // sign-in into a 500 — the client can still refresh.
    return null;
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
