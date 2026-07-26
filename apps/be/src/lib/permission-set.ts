/**
 * Resolve a user's effective permission codes.
 *
 * Single source of truth for the role → role_permissions → permissions
 * join, used from two places that must never disagree:
 *
 *   - `auth.ts` `definePayload` — bakes the codes into the access token so
 *     `requireAuth` can authorise without touching the database.
 *   - the token-refresh path — re-reads them so a permission change lands
 *     on the next mint.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { permissions, rolePermissions, userRoles } from '../db/schema/iam';

export async function resolvePermissionCodes(userId: string): Promise<string[]> {
  const rows = await db
    .select({ code: permissions.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  // De-duplicated: a user holding two roles that share a permission would
  // otherwise carry it twice into the token payload.
  return [...new Set(rows.map((r) => r.code))];
}
