/**
 * Cooperatives — DB access layer.
 *
 * Pure async functions that take typed inputs and return typed data.
 * No knowledge of Hono context, headers, or HTTP status codes — route
 * handlers extract the actor info from the Hono context and translate
 * nullable returns / sentinel errors into HTTP responses.
 *
 * Audit-write side effects live next to their corresponding mutation
 * (create / update / soft-delete) so a future caller can't forget to
 * emit one. The actor envelope is supplied by the caller so the service
 * stays Hono-free.
 */

import type { z } from '@hono/zod-openapi';
import type { createCooperativeSchema, updateCooperativeSchema } from '@thinkcocoa/shared';
import { and, sql as dsql, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { parcels } from '../../db/schema/gis';
import {
  cooperatives,
  roles,
  userCooperativeAssignments,
  userRoles,
  users,
} from '../../db/schema/iam';
import { writeAudit } from '../../lib/audit';
import { type Row, SELECT_FIELDS } from './projection';

/**
 * Actor envelope passed in from the route layer. Includes the request-
 * scoped fields that `writeAudit` would otherwise pull from the Hono
 * context — keeping the service free of `hono` imports.
 */
export interface AuditActor {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

export type CreateCooperativeInput = z.infer<typeof createCooperativeSchema>;
export type UpdateCooperativeInput = z.infer<typeof updateCooperativeSchema>;

/** Snapshot the columns we audit on cooperatives (drops housekeeping
 *  fields like createdAt/updatedAt that change every write). */
function coopAuditSnapshot(c: typeof cooperatives.$inferSelect) {
  return {
    code: c.code,
    farmerCodePrefix: c.farmerCodePrefix,
    name: c.name,
    description: c.description,
    districtCode: c.districtCode,
    districtName: c.districtName,
    chairUserId: c.chairUserId,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    address: c.address,
    isActive: c.isActive,
  };
}

/** Build the JSONB metadata blob that `writeAudit` would otherwise
 *  derive from the Hono ctx. Mirrors the same conditional shape so
 *  audit rows look identical regardless of whether the caller passed
 *  ctx or pre-extracted actor fields. */
function metadataFromActor(actor: AuditActor) {
  return {
    ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    ...(actor.sessionId ? { sessionId: actor.sessionId } : {}),
  };
}

// ── LIST ─────────────────────────────────────────────────────
export interface CooperativeListFilters {
  q?: string;
  includeDeleted: boolean;
  /** Already clamped to [1, ∞) by the caller. */
  page: number;
  /** Already clamped to [1, 100] by the caller. */
  pageSize: number;
}

export interface CooperativeListResult {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCooperatives(f: CooperativeListFilters): Promise<CooperativeListResult> {
  const whereClauses = [];
  if (!f.includeDeleted) {
    whereClauses.push(isNull(cooperatives.deletedAt));
  }
  if (f.q) {
    whereClauses.push(
      or(
        ilike(cooperatives.code, `%${f.q}%`),
        ilike(cooperatives.name, `%${f.q}%`),
        ilike(cooperatives.districtName, `%${f.q}%`),
      )!,
    );
  }
  const whereExpr = whereClauses.length > 0 ? and(...whereClauses) : undefined;

  // Total runs against the cooperatives table only (no left-join to
  // users) so the count is stable regardless of chair_user_id values.
  const [{ total }] = await db
    .select({ total: dsql<number>`CAST(count(*) AS INT)` })
    .from(cooperatives)
    .where(whereExpr);

  const offset = (f.page - 1) * f.pageSize;
  const rows = await db
    .select(SELECT_FIELDS)
    .from(cooperatives)
    .leftJoin(users, eq(users.id, cooperatives.chairUserId))
    .where(whereExpr)
    .orderBy(dsql`${cooperatives.name} ASC`)
    .limit(f.pageSize)
    .offset(offset);

  return {
    rows: rows as Row[],
    total: Number(total),
    page: f.page,
    pageSize: f.pageSize,
  };
}

// ── DETAIL ───────────────────────────────────────────────────
export async function getCooperative(id: string): Promise<Row | null> {
  const [row] = await db
    .select(SELECT_FIELDS)
    .from(cooperatives)
    .leftJoin(users, eq(users.id, cooperatives.chairUserId))
    .where(eq(cooperatives.id, id))
    .limit(1);
  return (row as Row | undefined) ?? null;
}

// ── CREATE ───────────────────────────────────────────────────
/** Sentinel returned when the unique `code` constraint would be
 *  violated. Routes translate to a 409. */
export interface CodeConflict {
  kind: 'code-conflict';
  code: string;
}

export type CreateCooperativeResult = { kind: 'ok'; row: Row } | CodeConflict;

export async function createCooperative(
  body: CreateCooperativeInput,
  actor: AuditActor,
): Promise<CreateCooperativeResult> {
  const [existing] = await db
    .select({ id: cooperatives.id })
    .from(cooperatives)
    .where(eq(cooperatives.code, body.code))
    .limit(1);
  if (existing) {
    return { kind: 'code-conflict', code: body.code };
  }

  const [created] = await db
    .insert(cooperatives)
    .values({
      code: body.code,
      farmerCodePrefix: body.farmerCodePrefix ?? null,
      name: body.name,
      description: body.description ?? null,
      districtCode: body.districtCode ?? null,
      districtName: body.districtName ?? null,
      chairUserId: body.chairUserId ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      address: body.address ?? null,
      isActive: body.isActive ?? true,
    })
    .returning();

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'cooperatives',
    entityId: created.id,
    action: 'create',
    after: coopAuditSnapshot(created),
    cooperativeId: created.id,
    summary: `Created cooperative ${created.code}`,
    metadata: metadataFromActor(actor),
  });

  // Re-select via the projection so the response includes joined chair
  // fields + computed counts (which the insert returning() can't
  // produce on its own).
  const [row] = await db
    .select(SELECT_FIELDS)
    .from(cooperatives)
    .leftJoin(users, eq(users.id, cooperatives.chairUserId))
    .where(eq(cooperatives.id, created.id))
    .limit(1);
  return { kind: 'ok', row: row as Row };
}

// ── UPDATE ───────────────────────────────────────────────────
export type UpdateCooperativeResult =
  | { kind: 'ok'; row: Row }
  | { kind: 'not-found' }
  | CodeConflict;

export async function updateCooperative(
  id: string,
  body: UpdateCooperativeInput,
  actor: AuditActor,
): Promise<UpdateCooperativeResult> {
  if (body.code) {
    const [existing] = await db
      .select({ id: cooperatives.id })
      .from(cooperatives)
      .where(and(eq(cooperatives.code, body.code), dsql`${cooperatives.id} != ${id}`))
      .limit(1);
    if (existing) return { kind: 'code-conflict', code: body.code };
  }

  // Snapshot pre-update state for audit diff.
  const [before] = await db.select().from(cooperatives).where(eq(cooperatives.id, id)).limit(1);
  if (!before) return { kind: 'not-found' };

  const patch: Partial<typeof cooperatives.$inferInsert> = {};
  if (body.code !== undefined) patch.code = body.code;
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.districtCode !== undefined) patch.districtCode = body.districtCode;
  if (body.districtName !== undefined) patch.districtName = body.districtName;
  if (body.chairUserId !== undefined) patch.chairUserId = body.chairUserId;
  if (body.contactEmail !== undefined) patch.contactEmail = body.contactEmail;
  if (body.contactPhone !== undefined) patch.contactPhone = body.contactPhone;
  if (body.address !== undefined) patch.address = body.address;
  if (body.isActive !== undefined) patch.isActive = body.isActive;
  patch.updatedAt = new Date();

  const [updated] = await db
    .update(cooperatives)
    .set(patch)
    .where(eq(cooperatives.id, id))
    .returning();
  if (!updated) return { kind: 'not-found' };

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'cooperatives',
    entityId: id,
    action: 'update',
    before: coopAuditSnapshot(before),
    after: coopAuditSnapshot(updated),
    cooperativeId: id,
    summary: `Updated cooperative ${updated.code}`,
    metadata: metadataFromActor(actor),
  });

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(cooperatives)
    .leftJoin(users, eq(users.id, cooperatives.chairUserId))
    .where(eq(cooperatives.id, id))
    .limit(1);
  return { kind: 'ok', row: row as Row };
}

// ── SOFT DELETE ──────────────────────────────────────────────
export type SoftDeleteCooperativeResult = { kind: 'ok' } | { kind: 'not-found' };

export async function softDeleteCooperative(
  id: string,
  actor: AuditActor,
): Promise<SoftDeleteCooperativeResult> {
  // Cascade soft-delete: deleting a cooperative hides ALL of its data
  // (farmers + their parcels) in one action — no need to reassign or
  // delete each farmer by hand. The rows stay in the DB (restorable);
  // the coop drops off the switcher so nothing under it is reachable.
  const now = new Date();
  const res = await db
    .update(cooperatives)
    .set({ deletedAt: now, deletedBy: actor.id, isActive: false })
    .where(and(eq(cooperatives.id, id), isNull(cooperatives.deletedAt)))
    .returning();
  if (res.length === 0) return { kind: 'not-found' };

  const deletedFarmers = await db
    .update(farmers)
    .set({ deletedAt: now, deletedBy: actor.id, isActive: false })
    .where(and(eq(farmers.cooperativeId, id), isNull(farmers.deletedAt)))
    .returning({ id: farmers.id });

  await db
    .update(parcels)
    .set({ deletedAt: now, deletedBy: actor.id })
    .where(and(eq(parcels.cooperativeId, id), isNull(parcels.deletedAt)));

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'cooperatives',
    entityId: id,
    action: 'soft-delete',
    cooperativeId: id,
    summary: `Soft-deleted cooperative ${res[0].code} + ${deletedFarmers.length} farmer(s) and their parcels`,
    metadata: metadataFromActor(actor),
  });

  return { kind: 'ok' };
}

export type RestoreCooperativeResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'not-deleted' };

/**
 * Undo a cascade soft-delete: restore the cooperative + exactly the
 * farmers and parcels that were tombstoned in the SAME action (matched
 * on the coop's `deleted_at` timestamp, which the cascade stamps
 * identically across all three tables). Farmers/parcels deleted
 * individually at a different time stay deleted.
 */
export async function restoreCooperative(
  id: string,
  actor: AuditActor,
): Promise<RestoreCooperativeResult> {
  const [coop] = await db
    .select({ id: cooperatives.id, code: cooperatives.code, deletedAt: cooperatives.deletedAt })
    .from(cooperatives)
    .where(eq(cooperatives.id, id))
    .limit(1);
  if (!coop) return { kind: 'not-found' };
  if (!coop.deletedAt) return { kind: 'not-deleted' };
  const deletedAt = coop.deletedAt;

  await db
    .update(cooperatives)
    .set({ deletedAt: null, deletedBy: null, isActive: true })
    .where(eq(cooperatives.id, id));

  const restoredFarmers = await db
    .update(farmers)
    .set({ deletedAt: null, deletedBy: null, isActive: true })
    .where(and(eq(farmers.cooperativeId, id), eq(farmers.deletedAt, deletedAt)))
    .returning({ id: farmers.id });

  await db
    .update(parcels)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(eq(parcels.cooperativeId, id), eq(parcels.deletedAt, deletedAt)));

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'cooperatives',
    entityId: id,
    action: 'restore',
    cooperativeId: id,
    summary: `Restored cooperative ${coop.code} + ${restoredFarmers.length} farmer(s) and their parcels`,
    metadata: metadataFromActor(actor),
  });

  return { kind: 'ok' };
}

// ── COOPERATIVE MEMBERS ──────────────────────────────────────
// Users who can access this cooperative. Two source paths, unioned:
//   1. Explicit assignment — a row in `user_cooperative_assignments`.
//      These users CAN be removed from the coop (the FE shows an X
//      button next to their row).
//   2. Org-wide admins — `users.is_all_cooperative = true`. They show
//      up on every coop's member list with `viaOrgWide = true` so the
//      FE can label them and hide the remove control (there's nothing
//      coop-specific to un-assign).
// Users matching both paths are emitted once with `viaOrgWide = true`
// (the org-wide grant supersedes the explicit assignment for the
// "can remove?" decision).

export interface CooperativeMember {
  userId: string;
  name: string;
  email: string;
  status: string;
  isPrimary: boolean;
  scope: 'district' | 'all_districts';
  /** Role CODES the user has globally (not per-coop). */
  roles: string[];
  /** True when this user's access comes from `users.is_all_cooperative`
   *  rather than an explicit assignment. The FE hides the remove
   *  control on these rows. */
  viaOrgWide: boolean;
}

export async function listCooperativeMembers(cooperativeId: string): Promise<CooperativeMember[]> {
  const [assignments, orgWideUsers] = await Promise.all([
    db
      .select({
        userId: userCooperativeAssignments.userId,
        name: users.name,
        email: users.email,
        status: users.status,
        isPrimary: userCooperativeAssignments.isPrimary,
        scope: userCooperativeAssignments.assignmentScope,
      })
      .from(userCooperativeAssignments)
      .innerJoin(users, eq(users.id, userCooperativeAssignments.userId))
      .where(
        and(eq(userCooperativeAssignments.cooperativeId, cooperativeId), isNull(users.deletedAt)),
      ),
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.isAllCooperative, true), isNull(users.deletedAt))),
  ]);

  // Merge — org-wide entries win over explicit assignments since they
  // imply broader access and the remove UI shouldn't be offered.
  type Row = CooperativeMember;
  const byId = new Map<string, Row>();
  for (const a of assignments) {
    byId.set(a.userId, {
      userId: a.userId,
      name: a.name,
      email: a.email,
      status: a.status,
      isPrimary: a.isPrimary,
      scope: a.scope as 'district' | 'all_districts',
      roles: [],
      viaOrgWide: false,
    });
  }
  for (const u of orgWideUsers) {
    byId.set(u.userId, {
      userId: u.userId,
      name: u.name,
      email: u.email,
      status: u.status,
      isPrimary: false,
      scope: 'all_districts',
      roles: [],
      viaOrgWide: true,
    });
  }

  if (byId.size === 0) return [];

  // Bulk-load roles in a single query (avoid N+1 across the member list).
  const userIds = Array.from(byId.keys());
  const roleRows = await db
    .select({ userId: userRoles.userId, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds));
  for (const r of roleRows) {
    const member = byId.get(r.userId);
    if (member) member.roles.push(r.code);
  }
  for (const m of byId.values()) m.roles.sort();

  // Sort: org-wide admins last (they're not coop-specific so the
  // explicitly-assigned coop members surface first); within each
  // group sort by name for stable ordering.
  return Array.from(byId.values()).sort((a, b) => {
    if (a.viaOrgWide !== b.viaOrgWide) return a.viaOrgWide ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export type RemoveMemberResult = { kind: 'ok' } | { kind: 'not-found' };

export async function removeCooperativeMember(
  cooperativeId: string,
  userId: string,
  actor: AuditActor,
): Promise<RemoveMemberResult> {
  const deleted = await db
    .delete(userCooperativeAssignments)
    .where(
      and(
        eq(userCooperativeAssignments.cooperativeId, cooperativeId),
        eq(userCooperativeAssignments.userId, userId),
      ),
    )
    .returning();
  if (deleted.length === 0) return { kind: 'not-found' };

  await writeAudit({
    actorUserId: actor.id,
    entitySchema: 'iam',
    entityTable: 'user_cooperative_assignments',
    entityId: deleted[0].id,
    action: 'delete',
    cooperativeId,
    summary: `Removed user ${userId} from cooperative ${cooperativeId}`,
    metadata: metadataFromActor(actor),
  });

  return { kind: 'ok' };
}
