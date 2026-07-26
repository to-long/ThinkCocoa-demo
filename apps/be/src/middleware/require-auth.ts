/**
 * Access-token auth middleware.
 *
 * Verifies the SIGNATURE and claims of the access token in the
 * `better-auth.access_token` cookie and attaches the caller to the Hono
 * context. No database round trip on the happy path: identity, status,
 * coop scope and the permission set all travel as signed claims (see
 * `auth.ts` → `definePayload`), and an edited payload — including a
 * hand-added permission — fails signature verification.
 *
 * Downstream handlers read (unchanged contract):
 *   c.get('user')        — id / email / name / status / isAllCooperative
 *   c.get('permissions') — Set<string> of permission codes
 *   c.get('sessionId')   — token identity, for audit correlation
 *
 * Failure modes are distinct so the client knows what to do:
 *   401 `no_access_token` → try a refresh (the session cookie may be live)
 *   401 `token_expired`   → POST /api/auth/refresh, retry once
 *   401 `token_revoked`   → same; the refresh re-reads scope from the DB
 *   401 `token_invalid`   → bad signature / issuer: sign in again
 *   401 `session_invalid` → account deactivated or deleted
 *
 * Claim staleness is bounded by `lib/token-revocation.ts`: a permission,
 * status or deletion change blacklists tokens minted before it, so a
 * downgraded user is forced through a refresh on their next request
 * instead of keeping the old scope until expiry.
 */

import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/access-token';
import { isTokenRevoked } from '../lib/token-revocation';

/** Claim-derived caller. Structurally a subset of the old `iam.users` row
 *  covering every field handlers actually read, so call sites are
 *  unchanged. Anything added here must also be added to `definePayload`. */
export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  status: string;
  isAllCooperative: boolean;
}

export interface AuthedContext {
  Variables: {
    user: AuthedUser;
    permissions: Set<string>;
    sessionId: string;
  };
}

export const requireAuth: MiddlewareHandler<AuthedContext> = async (c, next) => {
  const token = getCookie(c, ACCESS_COOKIE);
  if (!token) {
    // Separate from `token_expired`: nothing to verify, but the refresh
    // credential may still be valid, so the client tries once before
    // treating it as signed-out.
    return c.json({ error: 'Unauthorized', code: 'no_access_token' }, 401);
  }

  const result = await verifyAccessToken(token);
  if (!result.ok) {
    return result.reason === 'expired'
      ? c.json({ error: 'Access token expired', code: 'token_expired' }, 401)
      : c.json({ error: 'Unauthorized', code: 'token_invalid' }, 401);
  }

  const { claims } = result;

  if (isTokenRevoked(claims.sub, claims.iat)) {
    return c.json({ error: 'Access token revoked', code: 'token_revoked' }, 401);
  }

  // 401 (not 403): the account is gone or disabled, so re-authentication is
  // the only way forward. 403 stays reserved for permission-denied, which
  // is what lets the FE force a sign-out on ANY 401 without kicking out a
  // user who merely lacks one permission.
  if (claims.deleted === true || (claims.status && claims.status !== 'active')) {
    return c.json({ error: 'session_invalid' }, 401);
  }

  c.set('user', {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : null,
    status: typeof claims.status === 'string' ? claims.status : 'active',
    isAllCooperative: claims.isAllCooperative === true,
  });
  c.set('permissions', new Set(Array.isArray(claims.perms) ? claims.perms : []));
  // `jti` when the signer emits one, else the issue instant — enough to tie
  // an audit trail to one credential without another lookup.
  c.set('sessionId', typeof claims.jti === 'string' ? claims.jti : `iat:${claims.iat}`);

  await next();
};
