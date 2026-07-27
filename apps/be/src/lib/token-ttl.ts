/**
 * The two token lifetimes, in one place.
 *
 * Both are read per call rather than at module load: the blacklist sizes
 * its entries from the access TTL, tests tweak the env, and a stale
 * module-level constant would silently disagree with the token it is
 * supposed to describe.
 *
 * Lives apart from `access-token.ts` on purpose — `auth.ts` needs these
 * numbers while building its config, and `access-token.ts` imports `auth`.
 * Putting them here keeps that from becoming an import cycle.
 */

import { parseDurationSeconds } from './duration';

/** Access token = what `requireAuth` verifies on every request. */
export function accessTokenTtlSeconds(): number {
  return parseDurationSeconds(process.env.ACCESS_TOKEN_TTL, 30 * 60);
}

/**
 * Refresh token = the better-auth session cookie, which is what
 * `/api/auth/refresh` exchanges for a new access token.
 *
 * Falls back to `SESSION_EXPIRES_SECONDS`, the name this used to have, so
 * a deployed `.env` that hasn't been re-templated yet keeps its lifetime
 * instead of silently reverting to the 7-day default.
 */
export function refreshTokenTtlSeconds(): number {
  return parseDurationSeconds(
    process.env.REFRESH_TOKEN_TTL ?? process.env.SESSION_EXPIRES_SECONDS,
    7 * 24 * 60 * 60,
  );
}
