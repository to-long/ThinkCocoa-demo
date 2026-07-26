/**
 * Access-token blacklist — the piece that makes stateless verification
 * safe.
 *
 * Access tokens carry the user's permission set and status as claims, so
 * `requireAuth` authorises without a database read. The cost is staleness:
 * deactivate a user, delete them, or strip a role, and their token keeps
 * working until it expires.
 *
 * This closes that window. A revocation marks a user id with the instant
 * it happened; any token minted BEFORE that instant is rejected, forcing
 * the client through `/api/auth/refresh`, which re-reads the database and
 * either mints a token with the new scope or fails because the session /
 * account is gone.
 *
 * Why in-memory and not a table:
 *   - a per-request table lookup would undo the whole point of putting
 *     claims in the token;
 *   - entries are only useful for one access-token lifetime — after that
 *     no pre-revocation token can still validate — so the set stays tiny
 *     and needs no durability.
 *
 * Cross-process propagation rides the EXISTING `perm_changed` Postgres
 * NOTIFY channel (see `lib/perm-signal.ts`), which every permission
 * mutation already fires and the SSE worker already listens on. That
 * matters in production: pm2 runs blue/green slots, so a revocation raised
 * in one process must reach the other. A dedicated LISTEN connection here
 * keeps that independent of whether any SSE client happens to be open.
 */

import { directPool } from '../db/client';

/** userId → epoch ms of the revocation. Tokens issued before are invalid. */
const revokedAt = new Map<string, number>();

/**
 * How long an entry is kept. Must exceed the access-token lifetime, or a
 * token minted just before a revocation could outlive its own blacklist
 * entry. 30 min covers the default 15m TTL with room to spare.
 */
const RETENTION_MS = 30 * 60 * 1000;

/**
 * No skew allowance on purpose. `iat` has second granularity, so padding
 * the comparison to catch tokens minted in the same second as the
 * revocation ALSO rejects the token a refresh mints in that same second —
 * the client then refreshes, gets rejected again, and lands on the login
 * screen. Trading a sub-second window where a just-issued token survives
 * for a refresh that always recovers is the right way round: the refresh
 * itself re-reads the database, so the new token is authoritative.
 */

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function prune(): void {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [userId, at] of revokedAt) {
    if (at < cutoff) revokedAt.delete(userId);
  }
}

/**
 * Mark every access token issued to `userId` so far as invalid. Call from
 * anything that changes what a token would say: role / permission grants,
 * cooperative assignment, status, soft-delete.
 *
 * Local-only — use `notifyPermChanged` (perm-signal) to reach other
 * processes; its listener calls back into here.
 */
export function revokeUserTokens(userId: string): void {
  revokedAt.set(userId, Date.now());
}

/**
 * True when `issuedAtSeconds` predates a revocation for this user, i.e.
 * the caller must refresh before being trusted again.
 */
export function isTokenRevoked(userId: string, issuedAtSeconds: number): boolean {
  const at = revokedAt.get(userId);
  if (at == null) return false;
  // Strictly older-than: see the note on the removed skew constant above.
  return issuedAtSeconds * 1000 < at;
}

/**
 * Forget a user's revocation. Called after a successful refresh: minting
 * re-reads status and permissions from the database, so the token that
 * comes out is by definition current and the blacklist entry has done its
 * job. Without this, a refresh landing in the same second as the
 * revocation would hand back a token the very next request rejects.
 */
export function clearRevocation(userId: string): void {
  revokedAt.delete(userId);
}

/** Test seam / diagnostics. */
export function revocationCount(): number {
  return revokedAt.size;
}

/**
 * Subscribe to `perm_changed` so revocations raised in any process (or by
 * a SQL-level `pg_notify`) land here too. Idempotent; safe to call at
 * boot. Failures are logged, not thrown — losing the listener degrades
 * revocation to "next token expiry", it must not stop the server booting.
 */
export async function startTokenRevocationListener(): Promise<void> {
  if (pruneTimer) return;
  pruneTimer = setInterval(prune, RETENTION_MS);
  // Node's timer keeps the event loop alive; the server is long-lived
  // anyway, but tests that import this module shouldn't hang on it.
  pruneTimer.unref?.();

  try {
    const client = await directPool.connect();
    client.on('notification', (msg) => {
      if (msg.channel === 'perm_changed' && msg.payload) {
        revokeUserTokens(msg.payload);
      }
    });
    client.on('error', (err) => {
      console.error('[token-revocation] listener connection error:', err);
    });
    await client.query('LISTEN perm_changed');
    console.log('[token-revocation] listening on perm_changed');
  } catch (err) {
    console.error('[token-revocation] failed to start listener:', err);
  }
}
