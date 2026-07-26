/**
 * Users — DB access + side-effect layer.
 *
 * Pure async functions taking typed inputs (`CreateUserInput`,
 * `UpdateUserInput`, …). No knowledge of Hono context — route handlers
 * extract request metadata into the `Actor` shape and pass it in. The
 * layer owns:
 *   • the better-auth sign-up call for create
 *   • slim-stats cache + invalidation
 *   • writeAudit calls (with no-op suppression handled by writeAudit
 *     itself when before/after are both supplied)
 *
 * Map nullable/throw return contracts to HTTP at the route layer
 * (404 / 409 / 400). Everything in here either returns a typed payload
 * or returns a discriminated result (`{ ok: false; reason: ... }`) so
 * routes can branch on a string instead of catching exceptions.
 */

import type {
  AssignCooperativeInput,
  AssignmentScope,
  CreateUserInput,
  ListUsersQuery,
  SetUserRolesInput,
  UpdateUserInput,
} from '@cocoaimpact/shared';
import { isOrgWideRole } from '@cocoaimpact/shared';
import { and, asc, desc, sql as dsql, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { auth } from '../../auth';
import { db } from '../../db/client';
import {
  cooperatives,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userCooperativeAssignments,
  userRoles,
  users,
} from '../../db/schema/iam';
import { writeAudit } from '../../lib/audit';
import { notifyPermChanged } from '../../lib/perm-signal';
import { parseBoolFlag } from '../../lib/query-flags';
import { toUserResponse, userAuditSnapshot } from './projection';
import type { UserStatsPayload } from './schemas';

/**
 * Request-derived actor metadata propagated from the route handler so
 * the service can call `writeAudit` without depending on hono itself.
 * `id` is the logged-in user; the rest is what `writeAudit` would
 * otherwise pull from `Context` directly.
 */
export interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

// ── Stats cache ──────────────────────────────────────────────
// Same LRU pattern as farmer stats: one cache, one `global` key,
// 60s TTL. Every user mutation calls `invalidateUserStatsCache()`
// so the dashboard reflects the write on the next fetch.
interface UserStatsCacheEntry {
  payload: UserStatsPayload;
  computedAt: number;
}
const userStatsCache = new LRUCache<string, UserStatsCacheEntry>({
  max: 4, // room for the global key + a few future per-scope variants
  ttl: 60_000,
});
const USER_STATS_CACHE_KEY = 'global';

function invalidateUserStatsCache(): void {
  userStatsCache.clear();
}

async function computeUserStats(): Promise<UserStatsPayload> {
  // One round-trip via three parallel queries:
  //   1. Headline status counters (single FILTERed scan).
  //   2. `all` bucket = users with the org-wide flag.
  //   3. Per-coop bucket = users who can access each coop = explicit
  //      assignment OR org-wide flag. The org-wide users add the SAME
  //      constant to every coop's count (they implicitly access all),
  //      so we count explicit assignees per coop and sum the org-wide
  //      total in afterwards. Coops with zero accessible users still
  //      surface (LEFT JOIN-style via the coop list driver).
  const LIVE = dsql`${users.deletedAt} IS NULL`;

  const [headlineRow, allCountResult, noneCountResult, perCoopResult] = await Promise.all([
    db
      .select({
        total: dsql<number>`CAST(count(*) FILTER (WHERE ${LIVE}) AS INT)`,
        active: dsql<number>`CAST(count(*) FILTER (WHERE ${LIVE} AND ${users.status} = 'active') AS INT)`,
        inactive: dsql<number>`CAST(count(*) FILTER (WHERE ${LIVE} AND ${users.status} = 'inactive') AS INT)`,
        blocked: dsql<number>`CAST(count(*) FILTER (WHERE ${LIVE} AND ${users.status} = 'locked') AS INT)`,
        deleted: dsql<number>`CAST(count(*) FILTER (WHERE ${users.deletedAt} IS NOT NULL) AS INT)`,
      })
      .from(users),

    db.execute<{ count: number }>(dsql`
        SELECT COUNT(*)::INT AS count
          FROM iam.users
         WHERE is_all_cooperative = true
           AND deleted_at IS NULL
      `),

    // Users with NO coop access — neither org-wide nor any explicit
    // assignment. These users are stranded scope-wise; surfacing the
    // count lets admins notice the gap and assign them somewhere.
    db.execute<{ count: number }>(dsql`
        SELECT COUNT(*)::INT AS count
          FROM iam.users u
         WHERE u.deleted_at IS NULL
           AND u.is_all_cooperative = false
           AND NOT EXISTS (
             SELECT 1 FROM iam.user_cooperative_assignments uca
              WHERE uca.user_id = u.id
           )
      `),

    db.execute<{
      cooperative_id: string;
      cooperative_name: string;
      assigned_count: number;
    }>(dsql`
        SELECT c.id AS cooperative_id,
               c.name AS cooperative_name,
               COALESCE((
                 SELECT COUNT(DISTINCT uca.user_id)::INT
                   FROM iam.user_cooperative_assignments uca
                  INNER JOIN iam.users u ON u.id = uca.user_id
                  WHERE uca.cooperative_id = c.id
                    AND u.deleted_at IS NULL
                    AND u.is_all_cooperative = false
               ), 0) AS assigned_count
          FROM iam.cooperatives c
         WHERE c.deleted_at IS NULL
         ORDER BY c.name
      `),
  ]);

  const allRows = allCountResult.rows as Array<{ count: number }>;
  const allCount = Number(allRows[0]?.count ?? 0);
  const noneRows = noneCountResult.rows as Array<{ count: number }>;
  const noneCount = Number(noneRows[0]?.count ?? 0);
  const coopRows = perCoopResult.rows as Array<{
    cooperative_id: string;
    cooperative_name: string;
    assigned_count: number;
  }>;
  const byCooperative = coopRows.map((r) => ({
    cooperativeId: r.cooperative_id,
    cooperativeName: r.cooperative_name,
    // Users who can access this coop = explicit assignees + org-wide.
    count: Number(r.assigned_count) + allCount,
  }));

  return {
    total: Number(headlineRow[0].total),
    active: Number(headlineRow[0].active),
    inactive: Number(headlineRow[0].inactive),
    blocked: Number(headlineRow[0].blocked),
    deleted: Number(headlineRow[0].deleted),
    byScope: { all: allCount, none: noneCount, byCooperative },
  };
}

/**
 * Get-or-compute stats. Returns `{ payload, cacheHit }` so the route
 * handler can set the `X-Cache: HIT|MISS` header for DevTools.
 */
export async function getUserStats(): Promise<{
  payload: UserStatsPayload;
  cacheHit: boolean;
}> {
  const hit = userStatsCache.get(USER_STATS_CACHE_KEY);
  if (hit) return { payload: hit.payload, cacheHit: true };
  const payload = await computeUserStats();
  userStatsCache.set(USER_STATS_CACHE_KEY, {
    payload,
    computedAt: Date.now(),
  });
  return { payload, cacheHit: false };
}

// ── LIST ─────────────────────────────────────────────────────
export interface ListUsersResult {
  items: ReturnType<typeof toUserResponse>[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listUsers(query: ListUsersQuery): Promise<ListUsersResult> {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const offset = (page - 1) * pageSize;

  const whereClauses = [];
  // `status=deleted` implies include-deleted regardless of the flag —
  // that filter's whole purpose is to surface tombstones, so treat the
  // flag as true when the caller asks for it.
  const wantDeleted = query.status === 'deleted';
  if (!parseBoolFlag(query.includeDeleted) && !wantDeleted) {
    whereClauses.push(isNull(users.deletedAt));
  }
  if (query.q) {
    whereClauses.push(or(ilike(users.email, `%${query.q}%`), ilike(users.name, `%${query.q}%`))!);
  }
  // Optional role filter: only return users that hold the named role
  // code. Implemented as a correlated `EXISTS (...)` subquery so it
  // composes cleanly with the other where clauses + the count query
  // (Drizzle joins would force us to manage `select distinct`
  // explicitly). Used by the cooperative-chair selector — fetching
  // `?roleCode=cooperative_chair` returns only candidates eligible to
  // chair a cooperative, and by the admin users page role filter.
  if (query.roleCode) {
    whereClauses.push(
      dsql`EXISTS (
        SELECT 1 FROM iam.user_roles ur
        INNER JOIN iam.roles r ON r.id = ur.role_id
        WHERE ur.user_id = ${users.id} AND r.code = ${query.roleCode}
      )`,
    );
  }
  // UI status filter. `deleted` targets tombstoned rows; the other
  // three map 1:1 onto `users.status`. Anything else is ignored.
  if (query.status === 'deleted') {
    whereClauses.push(dsql`${users.deletedAt} IS NOT NULL`);
  } else if (
    query.status === 'active' ||
    query.status === 'inactive' ||
    query.status === 'blocked'
  ) {
    whereClauses.push(eq(users.status, query.status));
  }
  // Access-scope filter — see validator for the value semantics.
  if (query.scope === 'all') {
    whereClauses.push(eq(users.isAllCooperative, true));
  } else if (query.scope === 'none') {
    whereClauses.push(
      and(
        eq(users.isAllCooperative, false),
        dsql`NOT EXISTS (
          SELECT 1 FROM iam.user_cooperative_assignments a
          WHERE a.user_id = ${users.id}
        )`,
      )!,
    );
  } else if (query.scope) {
    // Any other value is treated as a cooperative UUID. Org-wide
    // access subsumes any specific coop, so `is_all_cooperative` also
    // counts as a match.
    whereClauses.push(
      or(
        eq(users.isAllCooperative, true),
        dsql`EXISTS (
          SELECT 1 FROM iam.user_cooperative_assignments a
          WHERE a.user_id = ${users.id} AND a.cooperative_id = ${query.scope}::uuid
        )`,
      )!,
    );
  }
  const whereExpr = whereClauses.length > 0 ? and(...whereClauses) : undefined;

  // Parse JSON:API sort spec → drizzle order expressions in priority
  // order. Supported fields: `name`, `email`, `last_login` (column
  // sorts) and `scope` — a derived bucket that ranks users by access
  // breadth: org-wide (0) > 2+ coops (1) > 1 coop (2) > none (3).
  // Unknown fields are skipped silently. Empty / no valid fields →
  // fall back to the desc(createdAt) default so the admin sees the
  // most recently provisioned accounts on top.
  //
  // Scope rank is a CASE expression over `is_all_cooperative` plus a
  // correlated subquery counting the user's coop assignments — kept
  // as a subquery (not a LEFT JOIN + GROUP BY) so the existing
  // pagination / count queries don't need to deduplicate users with
  // multiple assignments.
  const scopeRankExpr = dsql`CASE
    WHEN ${users.isAllCooperative} = true THEN 0
    WHEN (SELECT COUNT(*) FROM iam.user_cooperative_assignments uca
          WHERE uca.user_id = ${users.id}) >= 2 THEN 1
    WHEN (SELECT COUNT(*) FROM iam.user_cooperative_assignments uca
          WHERE uca.user_id = ${users.id}) = 1 THEN 2
    ELSE 3
  END`;
  // Rank by highest-privilege role held (lowest number wins), mirroring
  // the FE `ROLE_DISPLAY_RANK` so the sorted order matches the badge the
  // row surfaces. Subquery (not a JOIN) keeps count/pagination simple;
  // roleless users sort last (NULL → NULLS LAST on asc).
  const roleRankExpr = dsql`(
    SELECT MIN(CASE r.code
      WHEN 'system_admin' THEN 0
      WHEN 'project_leader' THEN 1
      WHEN 'ims_manager' THEN 2
      WHEN 'field_officer' THEN 3
      WHEN 'cooperative_chair' THEN 4
      WHEN 'buyer' THEN 5
      ELSE 100 END)
    FROM iam.user_roles ur
    JOIN iam.roles r ON r.id = ur.role_id
    WHERE ur.user_id = ${users.id}
  )`;
  const orderExprs = (() => {
    const out: ReturnType<typeof asc>[] = [];
    const fields = (query.sort ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const raw of fields) {
      const isDesc = raw.startsWith('-');
      const field = isDesc ? raw.slice(1) : raw;
      const dir = isDesc ? <T>(c: T) => desc(c as never) : <T>(c: T) => asc(c as never);
      switch (field) {
        case 'name':
          out.push(dir(users.name));
          break;
        case 'email':
          out.push(dir(users.email));
          break;
        case 'last_login':
        case 'lastLogin':
        case 'lastLoginAt':
          out.push(dir(users.lastLoginAt));
          break;
        case 'scope':
          out.push(dir(scopeRankExpr));
          break;
        case 'role':
          out.push(dir(roleRankExpr));
          break;
      }
    }
    if (out.length === 0) out.push(desc(users.createdAt));
    // Stable tiebreaker — without it, Postgres returns rows in
    // arbitrary order within the same sort key (e.g. all org-wide
    // users have scope rank = 0; with no secondary key, the
    // displayed order shuffles between paginated requests). Name
    // first (human-meaningful), id last (guaranteed unique so
    // ORDER BY is fully deterministic).
    out.push(asc(users.name), asc(users.id));
    return out;
  })();

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(whereExpr)
      .orderBy(...orderExprs)
      .limit(pageSize)
      .offset(offset),
    db.select({ count: dsql<number>`CAST(count(*) AS INT)` }).from(users).where(whereExpr),
  ]);

  // One bulk join to avoid N+1: fetch every (userId, roleCode) pair for
  // the users we're returning, then group in JS.
  const userIds = rows.map((u) => u.id);
  const [rolePairs, coopRows] = userIds.length
    ? await Promise.all([
        db
          .select({ userId: userRoles.userId, code: roles.code })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(inArray(userRoles.userId, userIds)),
        db
          .select({
            userId: userCooperativeAssignments.userId,
            cooperativeId: userCooperativeAssignments.cooperativeId,
            cooperativeCode: cooperatives.code,
            cooperativeName: cooperatives.name,
            scope: userCooperativeAssignments.assignmentScope,
            isPrimary: userCooperativeAssignments.isPrimary,
          })
          .from(userCooperativeAssignments)
          .innerJoin(cooperatives, eq(cooperatives.id, userCooperativeAssignments.cooperativeId))
          .where(inArray(userCooperativeAssignments.userId, userIds)),
      ])
    : [[], []];
  const rolesByUserId = new Map<string, string[]>();
  for (const pair of rolePairs) {
    const list = rolesByUserId.get(pair.userId) ?? [];
    list.push(pair.code);
    rolesByUserId.set(pair.userId, list);
  }
  const coopsByUserId = new Map<string, ReturnType<typeof toAssignment>[]>();
  function toAssignment(r: (typeof coopRows)[number]) {
    return {
      cooperativeId: r.cooperativeId,
      cooperativeCode: r.cooperativeCode,
      cooperativeName: r.cooperativeName,
      scope: r.scope as 'district' | 'all_districts',
      isPrimary: r.isPrimary,
    };
  }
  for (const r of coopRows) {
    const list = coopsByUserId.get(r.userId) ?? [];
    list.push(toAssignment(r));
    coopsByUserId.set(r.userId, list);
  }

  return {
    items: rows.map((u) =>
      toUserResponse(u, (rolesByUserId.get(u.id) ?? []).sort(), coopsByUserId.get(u.id) ?? []),
    ),
    total: Number(countRows[0].count),
    page,
    pageSize,
  };
}

// ── DETAIL / PROFILE ─────────────────────────────────────────
// Shared query helper — the `me` and `:id` handlers both need the same
// profile shape (core user row + role codes + effective permission codes
// + cooperative assignments). Lifted into a function to avoid the two
// endpoints drifting apart.
export async function loadUserProfile(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || user.deletedAt) return null;

  const userRolesRows = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id))
    .orderBy(roles.code);

  // Effective permissions — union across every role assigned to the user.
  // Single join + selectDistinct on `code` drops duplicates from users who
  // share permissions across multiple roles.
  const permRows = await db
    .selectDistinct({ code: permissions.code })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, id))
    .orderBy(permissions.code);

  const assignments = await db
    .select({
      cooperativeId: userCooperativeAssignments.cooperativeId,
      cooperativeCode: cooperatives.code,
      cooperativeName: cooperatives.name,
      scope: userCooperativeAssignments.assignmentScope,
      isPrimary: userCooperativeAssignments.isPrimary,
    })
    .from(userCooperativeAssignments)
    .innerJoin(cooperatives, eq(cooperatives.id, userCooperativeAssignments.cooperativeId))
    .where(eq(userCooperativeAssignments.userId, id));

  // Resolved coop list for the FE header CoopSwitcher — saves a
  // second `/api/cooperatives` round-trip on bootstrap. For org-wide
  // admins this is the full live coop catalog; otherwise it mirrors
  // the explicit assignment list above. The shape stays {id, code,
  // name} either way so the switcher renders identically.
  const accessibleCooperatives = user.isAllCooperative
    ? await db
        .select({
          id: cooperatives.id,
          code: cooperatives.code,
          name: cooperatives.name,
        })
        .from(cooperatives)
        .where(isNull(cooperatives.deletedAt))
        .orderBy(cooperatives.name)
    : assignments.map((a) => ({
        id: a.cooperativeId,
        code: a.cooperativeCode,
        name: a.cooperativeName,
      }));

  return {
    ...toUserResponse(user),
    roles: userRolesRows.map((r) => r.code),
    permissions: permRows.map((p) => p.code),
    cooperativeAssignments: assignments.map((a) => ({
      cooperativeId: a.cooperativeId,
      cooperativeCode: a.cooperativeCode,
      cooperativeName: a.cooperativeName,
      scope: a.scope as 'district' | 'all_districts',
      isPrimary: a.isPrimary,
    })),
    accessibleCooperatives,
  };
}

// ── CREATE ───────────────────────────────────────────────────
export type CreateUserResult =
  | { ok: true; payload: NonNullable<Awaited<ReturnType<typeof loadUserProfile>>> }
  | { ok: false; reason: 'email-exists'; email: string }
  | { ok: false; reason: 'unknown-roles'; missing: string[] }
  | { ok: false; reason: 'sign-up-failed' };

export async function createUser(body: CreateUserInput, actor: Actor): Promise<CreateUserResult> {
  // Pre-check email to surface a 409 rather than a better-auth 500.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (existing) {
    return { ok: false, reason: 'email-exists', email: body.email };
  }

  // Pre-validate role codes.
  let roleRows: { id: string; code: string }[] = [];
  if (body.roleCodes?.length) {
    roleRows = await db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(inArray(roles.code, body.roleCodes));
    const found = new Set(roleRows.map((r) => r.code));
    const missing = body.roleCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: 'unknown-roles', missing };
    }
  }

  // better-auth sign-up hashes password + writes iam.users + iam.accounts.
  const result = await auth.api.signUpEmail({
    body: { email: body.email, password: body.password, name: body.name },
  });
  if (!result?.user?.id) return { ok: false, reason: 'sign-up-failed' };

  // Apply domain-side extras in one transaction. If anything in here
  // throws, roll back the better-auth-created user too — otherwise we
  // leave a half-baked account (no roles, no coop, possibly default
  // status) that's invisible to the admin who tried to create it.
  // `users.id` cascades to accounts/sessions/userRoles via FK so a
  // single delete cleans the whole subtree.
  try {
    await db.transaction(async (tx) => {
      // Field updates — `isAllCooperative` is independent of
      // `cooperativeIds`; the FE may flip the flag without touching
      // the assignment list (and vice versa).
      const userPatch: Partial<typeof users.$inferInsert> = {};
      if (body.status) userPatch.status = body.status;
      if (body.defaultCooperativeId) userPatch.defaultCooperativeId = body.defaultCooperativeId;
      if (body.isAllCooperative !== undefined) userPatch.isAllCooperative = body.isAllCooperative;
      if (Object.keys(userPatch).length > 0) {
        await tx.update(users).set(userPatch).where(eq(users.id, result.user.id));
      }
      if (roleRows.length > 0) {
        await tx
          .insert(userRoles)
          .values(roleRows.map((r) => ({ userId: result.user.id, roleId: r.id })));
      }
      if (body.cooperativeIds && body.cooperativeIds.length > 0) {
        const scope: AssignmentScope = roleRows.some((r) => isOrgWideRole(r.code))
          ? 'all_districts'
          : 'district';
        await tx.insert(userCooperativeAssignments).values(
          body.cooperativeIds.map((cid, idx) => ({
            userId: result.user.id,
            cooperativeId: cid,
            assignmentScope: scope,
            // First selection becomes primary so the header CoopSwitcher
            // has a sensible default; admins can swap later via the
            // assign-cooperative endpoint.
            isPrimary: idx === 0,
          })),
        );
      }
    });
  } catch (err) {
    // Best-effort cleanup. If THIS delete itself fails, surface the
    // original error — the orphaned user is recoverable manually but
    // hiding the underlying cause isn't.
    try {
      await db.delete(users).where(eq(users.id, result.user.id));
    } catch {
      // Swallow — the original error below is more useful.
    }
    throw err;
  }

  const [created] = await db.select().from(users).where(eq(users.id, result.user.id));

  // Compute permissions for the newly-assigned roles so the create response
  // matches the detail schema (includes `permissions: string[]`).
  const createdPerms = roleRows.length
    ? await db
        .selectDistinct({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(
          inArray(
            rolePermissions.roleId,
            roleRows.map((r) => r.id),
          ),
        )
        .orderBy(permissions.code)
    : [];

  // Echo back the cooperative assignments we just wrote so the FE list
  // can populate the Scope column tags optimistically (no extra fetch).
  const createdAssignments = body.cooperativeIds?.length
    ? await db
        .select({
          cooperativeId: userCooperativeAssignments.cooperativeId,
          cooperativeCode: cooperatives.code,
          cooperativeName: cooperatives.name,
          scope: userCooperativeAssignments.assignmentScope,
          isPrimary: userCooperativeAssignments.isPrimary,
        })
        .from(userCooperativeAssignments)
        .innerJoin(cooperatives, eq(cooperatives.id, userCooperativeAssignments.cooperativeId))
        .where(eq(userCooperativeAssignments.userId, result.user.id))
    : [];

  // Invalidate the slim-stats cache — a new user shifts `total`,
  // status counts, and every role they'll be initially assigned to.
  invalidateUserStatsCache();

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: created.id,
    action: 'create',
    after: {
      ...userAuditSnapshot(created),
      roles: roleRows.map((r) => r.code).sort(),
    },
    summary: `Created user ${created.email}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  return {
    ok: true,
    payload: {
      ...toUserResponse(created),
      roles: roleRows.map((r) => r.code).sort(),
      permissions: createdPerms.map((p) => p.code),
      cooperativeAssignments: createdAssignments.map((a) => ({
        cooperativeId: a.cooperativeId,
        cooperativeCode: a.cooperativeCode,
        cooperativeName: a.cooperativeName,
        scope: a.scope as 'district' | 'all_districts',
        isPrimary: a.isPrimary,
      })),
      // Mirror the loadUserProfile shape — for org-wide admins this
      // would be the full coop catalog, but a freshly-created user
      // can only have org-wide access if the create call set the flag
      // explicitly (already reflected in `created.isAllCooperative`).
      // Cheap to compute here from the data we already have.
      accessibleCooperatives: created.isAllCooperative
        ? await db
            .select({
              id: cooperatives.id,
              code: cooperatives.code,
              name: cooperatives.name,
            })
            .from(cooperatives)
            .where(isNull(cooperatives.deletedAt))
            .orderBy(cooperatives.name)
        : createdAssignments.map((a) => ({
            id: a.cooperativeId,
            code: a.cooperativeCode,
            name: a.cooperativeName,
          })),
    },
  };
}

// ── UPDATE ───────────────────────────────────────────────────
export type UpdateUserResult =
  | { ok: true; payload: ReturnType<typeof toUserResponse> }
  | { ok: false; reason: 'no-fields' }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'unknown-roles'; missing: string[] };

export async function updateUser(
  id: string,
  body: UpdateUserInput,
  actor: Actor,
): Promise<UpdateUserResult> {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (body.fullName !== undefined) patch.name = body.fullName;
  if (body.image !== undefined) patch.image = body.image;
  if (body.status !== undefined) patch.status = body.status;
  if (body.defaultCooperativeId !== undefined)
    patch.defaultCooperativeId = body.defaultCooperativeId;
  if (body.isAllCooperative !== undefined) patch.isAllCooperative = body.isAllCooperative;

  const wantsRoleUpdate = body.roleCodes !== undefined;
  const wantsCoopUpdate = body.cooperativeIds !== undefined;
  const hasFieldUpdate = Object.keys(patch).length > 0;

  if (!hasFieldUpdate && !wantsRoleUpdate && !wantsCoopUpdate) {
    return { ok: false, reason: 'no-fields' };
  }

  // Pre-validate role codes BEFORE any write so a typo doesn't leave
  // the field updates committed without the role change. Mirror the
  // create-user flow's pre-check.
  let roleRows: { id: string; code: string }[] = [];
  if (wantsRoleUpdate && body.roleCodes!.length > 0) {
    roleRows = await db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(inArray(roles.code, body.roleCodes!));
    const found = new Set(roleRows.map((r) => r.code));
    const missing = body.roleCodes!.filter((c) => !found.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: 'unknown-roles', missing };
    }
  }

  const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!before) return { ok: false, reason: 'not-found' };

  // Snapshot existing roles for the audit diff. Only loaded when we're
  // about to mutate them — saves a query on field-only updates.
  const beforeRoles = wantsRoleUpdate
    ? (
        await db
          .select({ code: roles.code })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(eq(userRoles.userId, id))
      )
        .map((r) => r.code)
        .sort()
    : null;

  // Apply field updates + role replacement in one transaction so a
  // crash mid-write can't leave the user with stale fields-but-new-
  // roles (or vice versa). The audit row at the end captures both
  // diffs together — replaces the FE's old "PATCH then PUT-roles"
  // path that produced two audit entries per edit.
  const updated = await db.transaction(async (tx) => {
    let row = before;
    if (hasFieldUpdate) {
      const [u] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
      if (!u) return null;
      row = u;
    }
    if (wantsRoleUpdate) {
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      if (roleRows.length > 0) {
        await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: id, roleId: r.id })));
      }
    }
    if (wantsCoopUpdate) {
      // Compute scope from the FINAL role set — if the patch swapped
      // roles, use those; otherwise read the existing role codes from
      // DB so the scope reflects what the user actually has.
      const finalRoleCodes = wantsRoleUpdate
        ? roleRows.map((r) => r.code)
        : (
            await tx
              .select({ code: roles.code })
              .from(userRoles)
              .innerJoin(roles, eq(roles.id, userRoles.roleId))
              .where(eq(userRoles.userId, id))
          ).map((r) => r.code);
      const scope: AssignmentScope = finalRoleCodes.some((c) => isOrgWideRole(c))
        ? 'all_districts'
        : 'district';
      await tx.delete(userCooperativeAssignments).where(eq(userCooperativeAssignments.userId, id));
      if (body.cooperativeIds!.length > 0) {
        await tx.insert(userCooperativeAssignments).values(
          body.cooperativeIds!.map((cid, idx) => ({
            userId: id,
            cooperativeId: cid,
            assignmentScope: scope,
            isPrimary: idx === 0,
          })),
        );
      }
    }
    return row;
  });
  if (!updated) return { ok: false, reason: 'not-found' };
  // Status changes + role reassignment both shift cache buckets.
  invalidateUserStatsCache();

  // Combined audit: profile fields + roles in ONE row. writeAudit's
  // no-op suppression handles the edge case where every field equals
  // its prior value AND roleCodes equals the prior set.
  const afterRoles = wantsRoleUpdate ? roleRows.map((r) => r.code).sort() : null;
  const auditBefore = {
    ...userAuditSnapshot(before),
    ...(beforeRoles ? { roles: beforeRoles } : {}),
  };
  const auditAfter = {
    ...userAuditSnapshot(updated),
    ...(afterRoles ? { roles: afterRoles } : {}),
  };

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: id,
    action: 'update',
    before: auditBefore,
    after: auditAfter,
    summary: `Updated user ${updated.email}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  // Claims in any access token this user already holds still say the
  // account is live with its old scope — invalidate them so the next
  // request is forced through a refresh (which re-reads the DB).
  await notifyPermChanged(id);

  return { ok: true, payload: toUserResponse(updated) };
}

// ── SOFT DELETE ──────────────────────────────────────────────
export type SoftDeleteResult =
  | { ok: true }
  | { ok: false; reason: 'self' }
  | { ok: false; reason: 'not-found' };

export async function softDeleteUser(id: string, actor: Actor): Promise<SoftDeleteResult> {
  if (actor.id === id) return { ok: false, reason: 'self' };

  // Soft-delete is orthogonal to `status`. `deletedAt` is the tombstone
  // flag (`requireAuth` already treats a deleted row as unreachable
  // regardless of `status`), while `status` stays as whatever it was —
  // so a later restore returns the user to the exact pre-delete state
  // (active/locked/inactive) instead of always flipping to active.
  const res = await db
    .update(users)
    .set({ deletedAt: new Date(), deletedBy: actor.id })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  if (res.length === 0) return { ok: false, reason: 'not-found' };

  // Revoke every live session for the deleted user. The FK to
  // `iam.users` is `ON DELETE cascade`, but soft-delete never removes
  // the user row, so we delete the session rows explicitly. This kicks
  // the user out immediately: `auth.api.getSession` finds no matching
  // session on their next request and returns 401 (rather than the 403
  // `requireAuth` would give while the session still existed) — and any
  // open SSE stream drops on the following request too.
  await db.delete(sessions).where(eq(sessions.userId, id));

  // Tombstoning shifts `total` down and `deleted` up.
  invalidateUserStatsCache();

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: id,
    action: 'soft-delete',
    summary: `Soft-deleted user ${res[0].email}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  // Claims in any access token this user already holds still say the
  // account is live with its old scope — invalidate them so the next
  // request is forced through a refresh (which re-reads the DB).
  await notifyPermChanged(id);

  return { ok: true };
}

// ── RESTORE ──────────────────────────────────────────────────
export type RestoreUserResult =
  | { ok: true; payload: NonNullable<Awaited<ReturnType<typeof loadUserProfile>>> }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'not-deleted' };

export async function restoreUser(id: string, actor: Actor): Promise<RestoreUserResult> {
  const [existing] = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!existing) return { ok: false, reason: 'not-found' };
  if (existing.deletedAt === null) {
    return { ok: false, reason: 'not-deleted' };
  }

  // Only clear the tombstone — `status` is preserved through the
  // delete/restore cycle so a locked or inactive user stays that way
  // after restore. Admin can explicitly Reactivate via PATCH afterwards
  // if they want the user live.
  await db.update(users).set({ deletedAt: null, deletedBy: null }).where(eq(users.id, id));
  // Restore shifts `deleted` down and moves the user back into its
  // pre-delete status bucket.
  invalidateUserStatsCache();

  const profile = await loadUserProfile(id);
  if (!profile) return { ok: false, reason: 'not-found' };

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: id,
    action: 'restore',
    summary: `Restored user ${profile.email}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  // Claims in any access token this user already holds still say the
  // account is live with its old scope — invalidate them so the next
  // request is forced through a refresh (which re-reads the DB).
  await notifyPermChanged(id);

  return { ok: true, payload: profile };
}

// ── REPLACE ROLES ────────────────────────────────────────────
export type SetUserRolesResult =
  | { ok: true; userId: string; roles: string[] }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'unknown-roles'; missing: string[] };

export async function setUserRoles(
  id: string,
  body: SetUserRolesInput,
  actor: Actor,
): Promise<SetUserRolesResult> {
  const { roleCodes } = body;

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return { ok: false, reason: 'not-found' };

  let roleRows: { id: string; code: string }[] = [];
  if (roleCodes.length > 0) {
    roleRows = await db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(inArray(roles.code, roleCodes));
    const found = new Set(roleRows.map((r) => r.code));
    const missing = roleCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: 'unknown-roles', missing };
    }
  }

  // Snapshot existing role assignment so the audit diff captures
  // both the removed and added codes.
  const beforeRoles = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id));

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    if (roleRows.length > 0) {
      await tx.insert(userRoles).values(roleRows.map((r) => ({ userId: id, roleId: r.id })));
    }
  });
  // Role reassignment shifts per-role counts — invalidate the cache.
  invalidateUserStatsCache();

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: id,
    action: 'assign-roles',
    before: { roles: beforeRoles.map((r) => r.code).sort() },
    after: { roles: roleRows.map((r) => r.code).sort() },
    summary: `Set roles for ${user.email}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  // Force any open SSE connections for this user to drop + reconnect
  // so the cached `subscribedResources` set rebuilds from the new
  // perm list. Without this signal the user keeps receiving (or
  // missing) notifications based on the OLD role set for the life
  // of the connection.
  await notifyPermChanged(id);

  return {
    ok: true,
    userId: id,
    roles: roleRows.map((r) => r.code).sort(),
  };
}

// ── ASSIGN COOPERATIVE ───────────────────────────────────────
export type AssignCooperativeResult =
  | {
      ok: true;
      userId: string;
      cooperativeId: string;
      scope: 'district' | 'all_districts';
      isPrimary: boolean;
    }
  | { ok: false; reason: 'user-not-found' }
  | { ok: false; reason: 'cooperative-not-found' };

export async function assignCooperative(
  id: string,
  body: AssignCooperativeInput,
  actor: Actor,
): Promise<AssignCooperativeResult> {
  const [[user], [coop]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1),
    db
      .select({ id: cooperatives.id })
      .from(cooperatives)
      .where(eq(cooperatives.id, body.cooperativeId))
      .limit(1),
  ]);
  if (!user) return { ok: false, reason: 'user-not-found' };
  if (!coop) return { ok: false, reason: 'cooperative-not-found' };

  await db
    .insert(userCooperativeAssignments)
    .values({
      userId: id,
      cooperativeId: body.cooperativeId,
      assignmentScope: body.scope,
      isPrimary: body.isPrimary ?? false,
    })
    .onConflictDoUpdate({
      target: [userCooperativeAssignments.userId, userCooperativeAssignments.cooperativeId],
      set: {
        assignmentScope: body.scope,
        isPrimary: body.isPrimary ?? false,
      },
    });

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'users',
    entityId: id,
    action: 'assign-cooperative',
    after: {
      cooperativeId: body.cooperativeId,
      scope: body.scope,
      isPrimary: body.isPrimary ?? false,
    },
    cooperativeId: body.cooperativeId,
    summary: `Assigned cooperative to user ${id}`,
    actor: {
      ip: actor.ip,
      userAgent: actor.userAgent,
      sessionId: actor.sessionId,
    },
  });

  return {
    ok: true,
    userId: id,
    cooperativeId: body.cooperativeId,
    scope: body.scope,
    isPrimary: body.isPrimary ?? false,
  };
}
