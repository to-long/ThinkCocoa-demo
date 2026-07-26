/**
 * Resolve the signed-in user's currently-active cooperative scope.
 *
 * Reads the `active-coop-id` cookie set by the FE `CoopSwitcher`,
 * intersects it with the user's allowed coop set, and stores the
 * validated UUID on `c.set('activeCoopId', ...)` for downstream
 * route handlers + services to use as a `WHERE cooperative_id = $1`
 * filter.
 *
 * Allowed coop set:
 *   - `users.is_all_cooperative = true` → every cooperative in DB.
 *   - Otherwise → the user's `iam.user_cooperative_assignments` rows.
 *
 * Cookie validation rules (defense in depth — the cookie is FE-set
 * and therefore untrusted):
 *   - Cookie present + value ∈ allowed → use it.
 *   - Cookie present + value ∉ allowed → silently fall back (don't
 *     leak which ids the user is missing).
 *   - Cookie absent / falsy → fall back to the primary assignment
 *     (or the first allowed id) so the request still has a scope to
 *     filter against. The CoopSwitcher bootstrap effect normally
 *     populates the cookie before any list page renders, but a
 *     missing cookie shouldn't 403.
 *
 * Returns 403 only when the user has zero allowed coops at all.
 */

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { db } from '../db/client';
import { cooperatives, userCooperativeAssignments } from '../db/schema/iam';
import type { AuthedContext } from './require-auth';

export interface ActiveCoopContext {
  Variables: AuthedContext['Variables'] & {
    activeCoopId: string;
  };
}

const COOKIE_NAME = 'active-coop-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireActiveCoop: MiddlewareHandler<ActiveCoopContext> = async (c, next) => {
  const user = c.get('user');

  // Resolve the user's allowed coop set in ONE query branch — full
  // catalog for org-wide admins, else just their assignment rows.
  // Soft-deleted cooperatives are excluded on BOTH branches: a deleted
  // tenant must never be a valid scope, so its data stays unreachable.
  const allowed: string[] = user.isAllCooperative
    ? (
        await db
          .select({ id: cooperatives.id })
          .from(cooperatives)
          .where(isNull(cooperatives.deletedAt))
      ).map((r) => r.id)
    : (
        await db
          .select({
            id: userCooperativeAssignments.cooperativeId,
            isPrimary: userCooperativeAssignments.isPrimary,
          })
          .from(userCooperativeAssignments)
          .innerJoin(cooperatives, eq(cooperatives.id, userCooperativeAssignments.cooperativeId))
          .where(
            and(eq(userCooperativeAssignments.userId, user.id), isNull(cooperatives.deletedAt)),
          )
      )
        // Sort primary first so "fallback to first allowed id" picks
        // the user's primary assignment, matching the FE bootstrap.
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map((r) => r.id);

  if (allowed.length === 0) {
    return c.json({ error: 'No cooperative scope available' }, 403);
  }

  const cookieRaw = getCookie(c, COOKIE_NAME);

  // Explicitly block a request whose active-coop cookie points at a
  // soft-deleted cooperative — reject the whole request rather than
  // silently switching scope, so nothing can read a deleted tenant.
  if (cookieRaw && UUID_RE.test(cookieRaw) && !allowed.includes(cookieRaw)) {
    const [deleted] = await db
      .select({ id: cooperatives.id })
      .from(cooperatives)
      .where(and(eq(cooperatives.id, cookieRaw), isNotNull(cooperatives.deletedAt)))
      .limit(1);
    if (deleted) {
      return c.json(
        { error: 'This cooperative has been deleted', code: 'COOPERATIVE_DELETED' },
        403,
      );
    }
  }

  let activeCoopId: string | null = null;
  if (cookieRaw && UUID_RE.test(cookieRaw) && allowed.includes(cookieRaw)) {
    activeCoopId = cookieRaw;
  } else {
    // Fall back to the user's primary assignment (or first allowed id).
    activeCoopId = allowed[0]!;
  }

  c.set('activeCoopId', activeCoopId);
  await next();
};
