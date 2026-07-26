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
 * Two layers, one lifetime:
 *
 *   - `LRUCache` is the READ path, so authorising a request never queries.
 *     TTL per entry = `ACCESS_TOKEN_TTL`, the exact bound that matters: the
 *     newest token a revocation can invalidate was issued at `revokedAt`,
 *     so by `revokedAt + TTL` nothing it could reject is still valid.
 *   - `iam.token_revocations` is the DURABLE copy. Without it a restart or
 *     a power cut forgot the blacklist while the tokens themselves stayed
 *     valid — a revoked user would silently regain their old scope for the
 *     rest of the token lifetime. Hydrated into the cache at boot.
 *
 * The two stay in step through the cache's own disposal hook: whenever an
 * entry leaves the cache — TTL expiry, LRU eviction, or an explicit clear
 * after a refresh — the row is deleted. So "cache is empty" and "table is
 * empty" mean the same thing, and the table needs no separate reaper.
 *
 * `LRUCache` is the cache this codebase already uses (rate-limit buckets,
 * farmer + user stats).
 *
 * Cross-process propagation rides the EXISTING `perm_changed` Postgres
 * NOTIFY channel (see `lib/perm-signal.ts`), which every permission
 * mutation already fires and the SSE worker already listens on. That
 * matters in production: pm2 runs blue/green slots, so a revocation raised
 * in one process must reach the other. A dedicated LISTEN connection here
 * keeps that independent of whether any SSE client happens to be open.
 */

import { and, gt, lte, sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { db, directPool } from '../db/client';
import { tokenRevocations } from '../db/schema/iam';
import { accessTokenTtlSeconds } from './access-token';

/**
 * userId → epoch ms of the revocation. Tokens issued before that instant
 * are invalid. Entries expire on their own after one access-token
 * lifetime (see the module docblock); `max` is the memory backstop for a
 * pathological burst of revocations.
 */
const revokedAt = new LRUCache<string, number>({
  max: 10_000,
  // Sweep expired entries in the background instead of only on access —
  // most entries are never read again (the user simply refreshed), so
  // lazy expiry alone would keep them resident until the next lookup.
  ttlAutopurge: true,
  // Runs AFTER the cache mutation completes, so the DB write never sits in
  // the middle of a `set`/`get`. `reason` matters: on 'set' the entry is
  // being replaced by a fresher revocation, and deleting the row would
  // throw away the record we just wrote.
  disposeAfter: (_value, userId, reason) => {
    if (reason === 'set') return;
    void deleteRevocationRow(userId);
  },
});

/** Fire-and-forget row delete — the cache is already authoritative for
 *  reads, so a failed cleanup only leaves a stale row that boot hydration
 *  filters out by `expires_at` anyway. */
async function deleteRevocationRow(userId: string): Promise<void> {
  try {
    await db.delete(tokenRevocations).where(sql`${tokenRevocations.userId} = ${userId}`);
  } catch (err) {
    console.error('[token-revocation] failed to delete row:', err);
  }
}

/**
 * No skew allowance on purpose. `iat` has second granularity, so padding
 * the comparison to catch tokens minted in the same second as the
 * revocation ALSO rejects the token a refresh mints in that same second —
 * the client then refreshes, gets rejected again, and lands on the login
 * screen. Trading a sub-second window where a just-issued token survives
 * for a refresh that always recovers is the right way round: the refresh
 * itself re-reads the database, so the new token is authoritative.
 */

let listening = false;

/**
 * Mark every access token issued to `userId` so far as invalid. Call from
 * anything that changes what a token would say: role / permission grants,
 * cooperative assignment, status, soft-delete.
 *
 * Local-only — use `notifyPermChanged` (perm-signal) to reach other
 * processes; its listener calls back into here.
 */
export function revokeUserTokens(userId: string): void {
  // TTL read per call, not at module load: `ACCESS_TOKEN_TTL` is env-driven
  // and this module is imported by `access-token` (which owns the parser),
  // so evaluating it lazily also keeps the two out of an init-order trap.
  const ttlMs = accessTokenTtlSeconds() * 1000;
  const now = Date.now();
  revokedAt.set(userId, now, { ttl: ttlMs });

  // Persist without blocking the caller: the cache already enforces the
  // revocation for this process, and the row only has to be there if we
  // restart. Upsert, because re-revoking must push `expires_at` out rather
  // than collide on the primary key.
  const expiresAt = new Date(now + ttlMs);
  void db
    .insert(tokenRevocations)
    .values({ userId, revokedAt: new Date(now), expiresAt })
    .onConflictDoUpdate({
      target: tokenRevocations.userId,
      set: { revokedAt: new Date(now), expiresAt },
    })
    .catch((err) => console.error('[token-revocation] failed to persist:', err));
}

/**
 * True when `issuedAtSeconds` predates a revocation for this user, i.e.
 * the caller must refresh before being trusted again.
 */
export function isTokenRevoked(userId: string, issuedAtSeconds: number): boolean {
  const at = revokedAt.get(userId);
  // Absent OR expired — an expired entry means every token it could have
  // invalidated is itself expired, so there is nothing left to reject.
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

/** Test seam / diagnostics — live (non-expired) entries. */
export function revocationCount(): number {
  return revokedAt.size;
}

/**
 * Subscribe to `perm_changed` so revocations raised in any process (or by
 * a SQL-level `pg_notify`) land here too. Idempotent; safe to call at
 * boot. Failures are logged, not thrown — losing the listener degrades
 * revocation to "next token expiry", it must not stop the server booting.
 */
/**
 * Reload live revocations from the table into the cache, and drop rows that
 * can no longer reject anything. Runs at boot, before the server accepts a
 * request — otherwise the window between listen and first request is
 * exactly the gap this table exists to close.
 *
 * Each entry keeps its REMAINING lifetime, not a fresh full TTL: a
 * revocation from 14 minutes ago has one minute left to matter.
 */
export async function hydrateRevocations(): Promise<void> {
  try {
    const now = new Date();
    const rows = await db
      .select({ userId: tokenRevocations.userId, expiresAt: tokenRevocations.expiresAt })
      .from(tokenRevocations)
      .where(and(gt(tokenRevocations.expiresAt, now)));
    for (const r of rows) {
      const remaining = r.expiresAt.getTime() - now.getTime();
      if (remaining <= 0) continue;
      // `noDisposeOnSet`-equivalent: a plain set here can't fire a delete
      // because the key isn't in the cache yet (reason would be 'set',
      // which the disposer ignores).
      revokedAt.set(r.userId, now.getTime(), { ttl: remaining });
    }
    // Backstop sweep for rows whose cache entry died in a process that
    // crashed before its disposer ran.
    await db.delete(tokenRevocations).where(lte(tokenRevocations.expiresAt, now));
    if (rows.length > 0) {
      console.log(`[token-revocation] hydrated ${rows.length} live revocation(s)`);
    }
  } catch (err) {
    console.error('[token-revocation] hydrate failed:', err);
  }
}

export async function startTokenRevocationListener(): Promise<void> {
  if (listening) return;
  listening = true;
  await hydrateRevocations();
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
