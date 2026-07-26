/**
 * Session-based auth middleware. Validates the better-auth cookie/session and
 * attaches the matching `iam.users` row (+ computed permission set) to the
 * Hono context.
 *
 * Downstream handlers read:
 *   c.get('user')        — iam.users row (domain fields)
 *   c.get('permissions') — Set<string> of permission codes
 *   c.get('sessionId')   — better-auth session id (for audit)
 */

import { eq, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { auth } from '../auth';
import { db } from '../db/client';
import { permissions, rolePermissions, userRoles, users } from '../db/schema/iam';

export type AuthedUser = typeof users.$inferSelect;

export interface AuthedContext {
  Variables: {
    user: AuthedUser;
    permissions: Set<string>;
    sessionId: string;
  };
}

export const requireAuth: MiddlewareHandler<AuthedContext> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || user.deletedAt !== null || user.status !== 'active') {
    // 401 (not 403): the session is no longer valid — the user was
    // soft-deleted / deactivated while logged in and must re-authenticate.
    // 403 is reserved for permission-denied (authz) so the FE can safely
    // force a sign-out on ANY 401 without kicking out a user who merely
    // lacks a permission.
    return c.json({ error: 'session_invalid' }, 401);
  }

  // Resolve the user's permission set once per request via a single join.
  const rows = await db
    .select({ code: permissions.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, user.id));

  c.set('user', user);
  c.set('permissions', new Set(rows.map((r) => r.code)));
  c.set('sessionId', session.session.id);

  // Cheap last-login touch (fire-and-forget, non-blocking).
  // Drizzle builders are lazy — calling `.execute()` eagerly fires the
  // UPDATE. `void` alone without `.execute()` never runs the query.
  void db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).execute();

  await next();
  // Silence unused-import warning.
  void isNull;
};
