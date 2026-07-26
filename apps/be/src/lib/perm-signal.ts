/**
 * Signal that a user's effective permission set has changed so any
 * open SSE connection for them refreshes its cached scope. Each
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

/** Fire `pg_notify('perm_changed', userId)` so the user's open SSE
 *  connections drop and reconnect. Best-effort: errors are swallowed
 *  so a NOTIFY hiccup never breaks the underlying mutation. */
export async function notifyPermChanged(userId: string): Promise<void> {
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
      await db.execute(sql`SELECT pg_notify('perm_changed', ${r.userId})`);
    }
  } catch (err) {
    console.error('[perm-signal] notifyPermChangedForRole failed:', err);
  }
}
