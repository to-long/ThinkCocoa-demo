/**
 * Signal that a user's effective permission set (or account state) has
 * changed. Two consumers:
 *
 *   1. Access-token blacklist (`lib/token-revocation.ts`) — tokens carry
 *      the permission set as claims, so a change must invalidate the ones
 *      already issued. Revoked locally AND over NOTIFY, because in
 *      production pm2 runs two slots and only one of them handled the
 *      mutation.
 *   2. Open SSE connections, which refresh their cached scope. Each
 * notification SSE worker LISTENs on `perm_changed` and force-
 * disconnects connections whose userId matches the payload — the
 * EventSource auto-reconnects, `requireAuth` re-pulls perms, and the
 * subscribed-resource set is rebuilt from the fresh perm list.
 *
 * Fire from every place that mutates perms transitively:
 *   - `setUserRoles` / `replaceUserRoles`        — direct user binding
 *   - `setRolePermissions`                       — broadcast to all
 *                                                  users holding the role
 *   - cooperative assignment changes             — affects coop scope
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { userRoles } from '../db/schema/iam';
import { revokeUserTokens } from './token-revocation';

/** Fire `pg_notify('perm_changed', userId)` so the user's open SSE
 *  connections drop and reconnect. Best-effort: errors are swallowed
 *  so a NOTIFY hiccup never breaks the underlying mutation. */
export async function notifyPermChanged(userId: string): Promise<void> {
  // Local first: the listener will also deliver our own NOTIFY, but that
  // round trip is async — doing it here makes the revocation take effect
  // before the mutation's response is written.
  revokeUserTokens(userId);
  try {
    await db.execute(sql`SELECT pg_notify('perm_changed', ${userId})`);
  } catch (err) {
    console.error('[perm-signal] notifyPermChanged failed:', err);
  }
}

/** Same as `notifyPermChanged` but resolves all users holding the
 *  given role first — used when a role's permission grants change,
 *  which ripples to every user with that role. */
export async function notifyPermChangedForRole(roleId: string): Promise<void> {
  try {
    const rows = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    for (const r of rows) {
      revokeUserTokens(r.userId);
      await db.execute(sql`SELECT pg_notify('perm_changed', ${r.userId})`);
    }
  } catch (err) {
    console.error('[perm-signal] notifyPermChangedForRole failed:', err);
  }
}

/**
 * SSE-only variant on its own channel: drop the user's open notification
 * stream so it rebuilds its cached resource set, WITHOUT invalidating
 * their access token.
 *
 * Notification preferences are not part of the token — `perms` carries
 * permission codes, and prefs live in `iam.user_notification_pref`. Firing
 * `perm_changed` for them would blacklist a perfectly current token and
 * cost every preference toggle a refresh round trip (and, in a raw HTTP
 * client with no refresh logic, a 401).
 */
export async function notifySubscriptionChanged(userId: string): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_notify('subscription_changed', ${userId})`);
  } catch (err) {
    console.error('[perm-signal] notifySubscriptionChanged failed:', err);
  }
}
