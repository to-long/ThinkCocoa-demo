/**
 * Roles — DB access + audit-write side effects.
 *
 * Pure async functions that take typed inputs and return typed data.
 * No knowledge of Hono context, headers, or HTTP status codes — route
 * handlers translate the typed nullable returns into 404 / 409 / 400.
 *
 * Audit writes (`writeAudit`) live here because they are part of the
 * mutation's side effect, not HTTP wiring. The actor's IP / user-agent
 * / sessionId are extracted from the request in `routes.ts` and passed
 * through as a typed `actor` param so the service stays Hono-free.
 */

import type {
  CreateRoleInput,
  SetRolePermissionsInput,
  UpdateRoleInput,
} from '@thinkcocoa/shared';
import { asc, desc, sql as dsql, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { permissions, rolePermissions, roles, userRoles } from '../../db/schema/iam';
import { writeAudit } from '../../lib/audit';
import { notifyPermChangedForRole } from '../../lib/perm-signal';

/**
 * Identity of the user issuing a mutation. Routes extract this from
 * `c.get('user')` + request headers and hand it to the service so
 * service code never has to touch Hono `Context`.
 */
export interface Actor {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

// Build the `metadata` blob writeAudit normally pulls out of `ctx`.
// User-supplied metadata wins over writeAudit's ctx-derived defaults,
// so passing this in (with no ctx) yields the same audit row shape as
// the previous ctx-based call sites.
function actorMetadata(actor: Actor): Record<string, unknown> {
  return {
    ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    ...(actor.sessionId ? { sessionId: actor.sessionId } : {}),
  };
}

// ── Shared row shapers ───────────────────────────────────────
type RoleSelect = typeof roles.$inferSelect;

function toCoreResponse(r: RoleSelect, grantCount: number) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    grantCount,
  };
}

function toDetailResponse(r: RoleSelect, grantCount: number, permissionCodes: string[]) {
  return {
    ...toCoreResponse(r, grantCount),
    permissions: permissionCodes,
  };
}

// ── LIST ─────────────────────────────────────────────────────
export interface ListRolesFilters {
  q?: string;
  includePermissions: boolean;
  sort?: string;
  page: number;
  pageSize: number;
}

export interface ListRolesResult {
  items: ReturnType<typeof toDetailResponse>[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listRoles(f: ListRolesFilters): Promise<ListRolesResult> {
  const offset = (f.page - 1) * f.pageSize;

  // Free-text search across role code + name + description.
  const whereExpr = f.q
    ? or(
        ilike(roles.code, `%${f.q}%`),
        ilike(roles.name, `%${f.q}%`),
        ilike(roles.description, `%${f.q}%`),
      )
    : undefined;

  // Importance ranking — used as the default sort so the highest-
  // privilege canonical roles (system admin → project leader → ims
  // manager → field officer → coop chair → buyer) surface first.
  // Custom roles get rank 100 and fall after, alphabetised. Mirrors
  // the FE's `ROLE_DISPLAY_RANK` for the user-list role-pill column —
  // keep both lists in sync.
  const importanceRank = dsql<number>`CASE ${roles.code}
    WHEN 'system_admin' THEN 0
    WHEN 'project_leader' THEN 1
    WHEN 'ims_manager' THEN 2
    WHEN 'field_officer' THEN 3
    WHEN 'cooperative_chair' THEN 4
    WHEN 'buyer' THEN 5
    ELSE 100
  END`;

  // Parse JSON:API sort spec → drizzle order expressions in
  // priority order. Supported fields: `name`, `updated_at`,
  // `permissions` (granted-permission count). Unknown
  // fields are dropped silently. Empty / unsupported → importance
  // rank (canonical roles first, then alpha) so admins see the
  // privilege ladder by default.
  const orderExprs = (() => {
    const out: ReturnType<typeof asc>[] = [];
    const fields = (f.sort ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const raw of fields) {
      const isDesc = raw.startsWith('-');
      const field = isDesc ? raw.slice(1) : raw;
      const dir = isDesc ? <T>(c: T) => desc(c as never) : <T>(c: T) => asc(c as never);
      switch (field) {
        case 'name':
          out.push(dir(roles.name));
          break;
        case 'updated_at':
        case 'updatedAt':
          out.push(dir(roles.updatedAt));
          break;
        case 'permissions':
        case 'grant_count':
          // Order by the granted-permission count. Safe to reference
          // the aggregate here — the query GROUPs BY roles.id below.
          out.push(dir(dsql`count(${rolePermissions.permissionId})`));
          break;
      }
    }
    if (out.length === 0) {
      out.push(asc(importanceRank), asc(roles.name));
    }
    return out;
  })();

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        createdAt: roles.createdAt,
        updatedAt: roles.updatedAt,
        grantCount: dsql<number>`CAST(count(${rolePermissions.permissionId}) AS INT)`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(whereExpr)
      .groupBy(roles.id)
      .orderBy(...orderExprs)
      .limit(f.pageSize)
      .offset(offset),
    db.select({ count: dsql<number>`CAST(count(*) AS INT)` }).from(roles).where(whereExpr),
  ]);

  // When permissions are requested, one bulk join fetches every
  // (roleId, code) pair for the page — avoids N per-role round trips.
  // Grouped in JS so the Drizzle query stays straightforward.
  const roleIds = rows.map((r) => r.id);
  const permsByRoleId = new Map<string, string[]>();
  if (f.includePermissions && roleIds.length > 0) {
    const pairs = await db
      .select({ roleId: rolePermissions.roleId, code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, roleIds))
      .orderBy(permissions.code);
    for (const p of pairs) {
      const list = permsByRoleId.get(p.roleId) ?? [];
      list.push(p.code);
      permsByRoleId.set(p.roleId, list);
    }
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      grantCount: Number(r.grantCount),
      permissions: f.includePermissions ? (permsByRoleId.get(r.id) ?? []) : [],
    })),
    total: Number(countRows[0].count),
    page: f.page,
    pageSize: f.pageSize,
  };
}

// ── STATS ────────────────────────────────────────────────────
export interface RolesStatsResult {
  total: number;
  active: number;
  byRole: { code: string; name: string; userCount: number }[];
  permissions: { assigned: number; unassigned: number };
}

export async function getRolesStats(): Promise<RolesStatsResult> {
  const [totalRow, byRoleRows, permRow] = await Promise.all([
    db.select({ n: dsql<number>`CAST(count(*) AS INT)` }).from(roles),
    // Left-join `user_roles` so a role with zero users still shows
    // up — `count(user_id)` ignores nulls so the count is 0 for
    // never-assigned roles, which is what the design wants.
    db
      .select({
        code: roles.code,
        name: roles.name,
        userCount: dsql<number>`CAST(count(${userRoles.userId}) AS INT)`,
      })
      .from(roles)
      .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
      .groupBy(roles.id, roles.code, roles.name)
      .orderBy(dsql`count(${userRoles.userId}) desc`, roles.name),
    db
      .select({
        assigned: dsql<number>`CAST(count(*) FILTER (WHERE EXISTS (SELECT 1 FROM iam.role_permissions rp WHERE rp.permission_id = ${permissions.id})) AS INT)`,
        unassigned: dsql<number>`CAST(count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM iam.role_permissions rp WHERE rp.permission_id = ${permissions.id})) AS INT)`,
      })
      .from(permissions),
  ]);

  const byRole = byRoleRows.map((r) => ({
    code: r.code,
    name: r.name,
    userCount: Number(r.userCount),
  }));

  return {
    total: Number(totalRow[0]?.n ?? 0),
    // "Active" = role has ≥ 1 user assigned.
    active: byRole.filter((r) => r.userCount > 0).length,
    byRole,
    permissions: {
      assigned: Number(permRow[0]?.assigned ?? 0),
      unassigned: Number(permRow[0]?.unassigned ?? 0),
    },
  };
}

// ── DETAIL ───────────────────────────────────────────────────
export async function getRoleDetail(
  id: string,
): Promise<ReturnType<typeof toDetailResponse> | null> {
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return null;

  const grantedPerms = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, id))
    .orderBy(permissions.code);

  return toDetailResponse(
    role,
    grantedPerms.length,
    grantedPerms.map((p) => p.code),
  );
}

// ── CREATE ───────────────────────────────────────────────────
export type CreateRoleResult =
  | { kind: 'ok'; role: ReturnType<typeof toDetailResponse> }
  | { kind: 'conflict'; code: string }
  | { kind: 'unknown-permissions'; missing: string[] };

export async function createRole(input: CreateRoleInput, actor: Actor): Promise<CreateRoleResult> {
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, input.code))
    .limit(1);
  if (existing) return { kind: 'conflict', code: input.code };

  // Validate permission codes if provided.
  let grants: { roleId: string; permissionId: string }[] = [];
  if (input.permissionCodes?.length) {
    const found = await db
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, input.permissionCodes));
    const foundCodes = new Set(found.map((p) => p.code));
    const missing = input.permissionCodes.filter((c) => !foundCodes.has(c));
    if (missing.length > 0) {
      return { kind: 'unknown-permissions', missing };
    }
    grants = found.map((p) => ({ roleId: '<pending>', permissionId: p.id }));
  }

  const [role] = await db
    .insert(roles)
    .values({
      code: input.code,
      name: input.name,
      description: input.description,
    })
    .returning();

  if (grants.length > 0) {
    await db
      .insert(rolePermissions)
      .values(grants.map((g) => ({ roleId: role.id, permissionId: g.permissionId })));
  }

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'roles',
    entityId: role.id,
    action: 'create',
    after: {
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: (input.permissionCodes ?? []).slice().sort(),
    },
    summary: `Created role ${role.code}`,
    metadata: actorMetadata(actor),
  });

  return {
    kind: 'ok',
    role: toDetailResponse(role, grants.length, input.permissionCodes ?? []),
  };
}

// ── UPDATE ───────────────────────────────────────────────────
export async function updateRole(
  id: string,
  input: UpdateRoleInput,
  actor: Actor,
): Promise<ReturnType<typeof toCoreResponse> | null> {
  const [before] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!before) return null;

  const [role] = await db.update(roles).set(input).where(eq(roles.id, id)).returning();
  if (!role) return null;

  const [{ count }] = await db
    .select({ count: dsql<number>`CAST(count(*) AS INT)` })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id));

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'roles',
    entityId: id,
    action: 'update',
    before: {
      code: before.code,
      name: before.name,
      description: before.description,
    },
    after: {
      code: role.code,
      name: role.name,
      description: role.description,
    },
    summary: `Updated role ${role.code}`,
    metadata: actorMetadata(actor),
  });

  return toCoreResponse(role, Number(count));
}

// ── DELETE ───────────────────────────────────────────────────
export async function deleteRole(id: string, actor: Actor): Promise<{ deleted: true } | null> {
  const res = await db.delete(roles).where(eq(roles.id, id)).returning();
  if (res.length === 0) return null;

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'roles',
    entityId: id,
    action: 'delete',
    summary: `Deleted role ${res[0].code}`,
    metadata: actorMetadata(actor),
  });

  return { deleted: true };
}

// ── REPLACE PERMISSIONS ──────────────────────────────────────
export type SetRolePermissionsResult =
  | { kind: 'ok'; role: ReturnType<typeof toDetailResponse> }
  | { kind: 'not-found' }
  | { kind: 'unknown-permissions'; missing: string[] };

export async function setRolePermissions(
  id: string,
  input: SetRolePermissionsInput,
  actor: Actor,
): Promise<SetRolePermissionsResult> {
  const { permissionCodes } = input;

  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return { kind: 'not-found' };

  let permIds: { id: string; code: string }[] = [];
  if (permissionCodes.length > 0) {
    permIds = await db
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, permissionCodes));
    const found = new Set(permIds.map((p) => p.code));
    const missing = permissionCodes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      return { kind: 'unknown-permissions', missing };
    }
  }

  // Snapshot existing grants for the audit diff.
  const beforePerms = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, id));

  // Replace in a single transaction.
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (permIds.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permIds.map((p) => ({ roleId: id, permissionId: p.id })));
    }
  });

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'roles',
    entityId: id,
    action: 'assign-permissions',
    before: { permissions: beforePerms.map((p) => p.code).sort() },
    after: { permissions: permIds.map((p) => p.code).sort() },
    summary: `Set permissions for role ${role.code}`,
    metadata: actorMetadata(actor),
  });

  // Force every user holding this role to drop + reconnect any open
  // SSE connection so their cached `subscribedResources` set rebuilds
  // from the new perm set.
  await notifyPermChangedForRole(id);

  return {
    kind: 'ok',
    role: toDetailResponse(role, permIds.length, permIds.map((p) => p.code).sort()),
  };
}
