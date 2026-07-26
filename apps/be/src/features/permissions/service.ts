/**
 * Permissions — DB access + audit-write layer.
 *
 * Pure async functions that take typed inputs and return typed data.
 * No knowledge of Hono context, headers, or HTTP status codes —
 * route handlers parse query/body and map nullable returns into 404s.
 *
 * Mutations accept an `actor: { id, ip, userAgent, sessionId }` so
 * audit rows can be written without dragging the Hono `Context` into
 * this layer. The actor's transport details are forwarded to
 * `writeAudit` via the metadata override path so the JSONB blob ends
 * up identical to the pre-refactor (ctx-based) behaviour.
 */

import { sql as dsql, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { permissions } from '../../db/schema/iam';
import { type AuditAction, writeAudit } from '../../lib/audit';
import type { PermissionRow } from './projection';

export interface Actor {
  id: string;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

/**
 * Build the metadata override that mirrors what `writeAudit` would
 * extract from a Hono `Context`. Service-layer callers don't have a
 * ctx, so we inject the same fields directly into `metadata` — which
 * is spread last in `writeAudit`, so the JSONB shape on disk is
 * unchanged.
 */
function actorMetadata(actor: Actor): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (actor.ip) out.ipAddress = actor.ip;
  if (actor.userAgent) out.userAgent = actor.userAgent;
  if (actor.sessionId) out.sessionId = actor.sessionId;
  return out;
}

async function audit(params: {
  actor: Actor;
  action: AuditAction | string;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  summary: string;
}): Promise<void> {
  await writeAudit({
    actorUserId: params.actor.id,
    entitySchema: 'iam',
    entityTable: 'permissions',
    entityId: params.entityId,
    action: params.action,
    before: params.before,
    after: params.after,
    summary: params.summary,
    metadata: actorMetadata(params.actor),
  });
}

// ── LIST ─────────────────────────────────────────────────────
export async function listPermissions(): Promise<PermissionRow[]> {
  return db.select().from(permissions).orderBy(permissions.code);
}

// ── STATS ────────────────────────────────────────────────────
export interface PermissionsStatsResult {
  total: number;
  groupCount: number;
  byAction: { action: string; count: number }[];
}

export async function getPermissionsStats(): Promise<PermissionsStatsResult> {
  // One round-trip: split the code on `:` and aggregate. Postgres
  // does the heavy lifting so we don't ship every permission row to
  // the BE just to count them.
  const [totalRow, groupRow, actionRows] = await Promise.all([
    db.select({ n: dsql<number>`CAST(count(*) AS INT)` }).from(permissions),
    db
      .select({
        n: dsql<number>`CAST(count(DISTINCT split_part(${permissions.code}, ':', 1)) AS INT)`,
      })
      .from(permissions),
    db
      .select({
        action: dsql<string>`split_part(${permissions.code}, ':', 2)`,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(permissions)
      .groupBy(dsql`split_part(${permissions.code}, ':', 2)`)
      .orderBy(dsql`count(*) desc, split_part(${permissions.code}, ':', 2) asc`),
  ]);

  return {
    total: Number(totalRow[0]?.n ?? 0),
    groupCount: Number(groupRow[0]?.n ?? 0),
    byAction: actionRows
      .filter((r) => r.action) // skip codes without an `:action` part
      .map((r) => ({ action: r.action, count: Number(r.count) })),
  };
}

// ── LIST GROUPS (paginated, grouped by resource) ────────────
export interface PermissionGroupsListInput {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
}

export interface PermissionGroupItem {
  resource: string;
  actions: {
    id: string;
    code: string;
    action: string;
    name: string;
    description: string | null;
  }[];
  updatedAt: string;
}

export interface PermissionGroupsListResult {
  items: PermissionGroupItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPermissionGroups(
  input: PermissionGroupsListInput,
): Promise<PermissionGroupsListResult> {
  const { page, pageSize, q, sort } = input;
  const offset = (page - 1) * pageSize;

  const whereExpr = q
    ? or(ilike(permissions.code, `%${q}%`), ilike(permissions.name, `%${q}%`))
    : undefined;

  // Parse JSON:API sort spec → ORDER BY pieces against the
  // GROUPED-BY query. Supported fields:
  //   - `resource`    → group key (split_part(code, ':', 1))
  //   - `updated_at`  → max(updatedAt) within each group
  // Empty / unknown → default ordering (newest first by min created_at)
  // so anything just added bubbles to the top.
  const orderClauses = (() => {
    const out: ReturnType<typeof dsql>[] = [];
    const fields = (sort ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const raw of fields) {
      const isDesc = raw.startsWith('-');
      const field = isDesc ? raw.slice(1) : raw;
      // `dsql.raw('desc')` injects the literal SQL keyword — using
      // `${dir}` inside the template would bind it as a parameter.
      const dir = isDesc ? dsql.raw('desc') : dsql.raw('asc');
      switch (field) {
        case 'resource':
          out.push(dsql`split_part(${permissions.code}, ':', 1) ${dir}`);
          break;
        case 'updated_at':
        case 'updatedAt':
          out.push(dsql`max(${permissions.updatedAt}) ${dir}`);
          break;
      }
    }
    if (out.length === 0) {
      out.push(dsql`min(${permissions.createdAt}) desc`);
    }
    return out;
  })();

  // Step 1: paginated list of distinct resources matching the search,
  // including the latest `updated_at` per group so the FE can render
  // a "last touched" column.
  const [resourceRows, countRows] = await Promise.all([
    db
      .select({
        resource: dsql<string>`split_part(${permissions.code}, ':', 1)`,
        updatedAt: dsql<Date>`max(${permissions.updatedAt})`,
      })
      .from(permissions)
      .where(whereExpr)
      .groupBy(dsql`split_part(${permissions.code}, ':', 1)`)
      .orderBy(...orderClauses)
      .limit(pageSize)
      .offset(offset),
    db
      .select({
        count: dsql<number>`CAST(count(DISTINCT split_part(${permissions.code}, ':', 1)) AS INT)`,
      })
      .from(permissions)
      .where(whereExpr),
  ]);

  const wantedResources = resourceRows.map((r) => r.resource);
  const updatedAtByResource = new Map(resourceRows.map((r) => [r.resource, r.updatedAt]));
  if (wantedResources.length === 0) {
    return { items: [], total: Number(countRows[0].count), page, pageSize };
  }

  // Step 2: pull every row for those resources (no q-filter; we want the
  // full action set for each group we've already decided to show).
  const detailRows = await db
    .select()
    .from(permissions)
    .where(inArray(dsql`split_part(${permissions.code}, ':', 1)`, wantedResources))
    .orderBy(permissions.code);

  const grouped = new Map<string, typeof detailRows>();
  for (const row of detailRows) {
    const resource = row.code.split(':')[0] ?? '';
    if (!grouped.has(resource)) grouped.set(resource, []);
    grouped.get(resource)!.push(row);
  }

  return {
    items: wantedResources.map((resource) => ({
      resource,
      actions: (grouped.get(resource) ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        action: r.code.split(':')[1] ?? '',
        name: r.name,
        description: r.description,
      })),
      // Drizzle returns aggregate `max(timestamptz)` as a Date OR
      // a string depending on the driver path — wrap defensively
      // so we always emit ISO.
      updatedAt: (() => {
        const v = updatedAtByResource.get(resource);
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'string') return new Date(v).toISOString();
        return new Date().toISOString();
      })(),
    })),
    total: Number(countRows[0].count),
    page,
    pageSize,
  };
}

// ── GET ──────────────────────────────────────────────────────
export async function getPermission(id: string): Promise<PermissionRow | null> {
  const [row] = await db.select().from(permissions).where(eq(permissions.id, id));
  return row ?? null;
}

// ── CREATE ───────────────────────────────────────────────────
export interface CreatePermissionInput {
  code: string;
  name: string;
  description?: string | null;
}

export type CreatePermissionResult =
  | { status: 'created'; row: PermissionRow }
  | { status: 'conflict'; code: string };

export async function createPermission(
  input: CreatePermissionInput,
  actor: Actor,
): Promise<CreatePermissionResult> {
  const [existing] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, input.code))
    .limit(1);
  if (existing) return { status: 'conflict', code: input.code };

  const [row] = await db
    .insert(permissions)
    .values({ code: input.code, name: input.name, description: input.description })
    .returning();

  await audit({
    actor,
    action: 'create',
    entityId: row.id,
    after: { code: row.code, name: row.name, description: row.description },
    summary: `Created permission ${row.code}`,
  });

  return { status: 'created', row };
}

// ── BATCH CREATE (GROUPED BY RESOURCE) ──────────────────────
export type CreatePermissionGroupsResult =
  | { status: 'ok'; created: PermissionRow[]; existed: string[] }
  | { status: 'conflict'; existed: string[] };

export async function createPermissionGroups(
  body: Record<string, string[]>,
  actor: Actor,
): Promise<CreatePermissionGroupsResult> {
  // Reassemble the grouped payload into a flat list of permission rows.
  // Defaults for name/description are human-readable but shallow — the
  // admin UI is expected to let the user rename afterwards if needed.
  type NewPerm = { code: string; name: string; description: string };
  const toInsert: NewPerm[] = [];
  for (const [resource, actions] of Object.entries(body)) {
    for (const action of actions) {
      toInsert.push({
        code: `${resource}:${action}`,
        name: `${action[0]!.toUpperCase()}${action.slice(1).replace(/_/g, ' ')} ${resource.replace(/_/g, ' ')}`,
        description: `Auto-generated from group '${resource}'.`,
      });
    }
  }

  // Pre-query so we can return the full list (existing + freshly
  // inserted). The follow-up insert uses `onConflictDoNothing(code)`
  // so a concurrent insert from another admin can't TOCTOU us into a
  // unique-constraint violation — `.returning()` then yields only the
  // rows we actually inserted, which is what we want for the audit
  // diff.
  const codes = toInsert.map((p) => p.code);
  const existingRows = await db.select().from(permissions).where(inArray(permissions.code, codes));
  const existingCodes = new Set(existingRows.map((r) => r.code));
  const newRows = toInsert.filter((p) => !existingCodes.has(p.code));

  let inserted: typeof existingRows = [];
  if (newRows.length > 0) {
    inserted = await db
      .insert(permissions)
      .values(newRows)
      .onConflictDoNothing({ target: permissions.code })
      .returning();
  }

  if (inserted.length > 0) {
    // One audit row for the whole group — group-create is a single
    // admin action even if it materialises N permission rows.
    await audit({
      actor,
      action: 'create',
      entityId: null,
      after: { codes: inserted.map((r) => r.code).sort() },
      summary: `Created ${inserted.length} permission(s) in group`,
    });
  }

  // Pure-duplicate submit: nothing to insert AND nothing was new.
  // Used to silently 201 with `created: []`, which left the FE thinking
  // the create succeeded — admins typed an existing resource name and
  // saw no feedback. Surface a 409 instead so they can rename or use
  // the Edit flow.
  if (inserted.length === 0 && existingCodes.size > 0) {
    return { status: 'conflict', existed: [...existingCodes].sort() };
  }

  return {
    status: 'ok',
    created: inserted,
    existed: [...existingCodes].sort(),
  };
}

// ── SET GROUP STATE (PUT semantics) ──────────────────────────
// "Make this group's actions exactly equal to the given list."
// Computes the add + remove diffs server-side and writes ONE audit
// row capturing both — replaces the FE's old "create-then-loop-
// delete" edit flow that produced N+1 audit entries for a single
// admin action.
export interface SetPermissionGroupActionsResult {
  /** Final list of codes in the group, sorted. */
  codes: string[];
  /** Codes inserted by this call. */
  added: string[];
  /** Codes deleted by this call. */
  removed: string[];
}

export async function setPermissionGroupActions(
  resource: string,
  actions: string[],
  actor: Actor,
): Promise<SetPermissionGroupActionsResult> {
  // Snapshot the group's current state. We compare codes (not ids)
  // because the FE's payload is action names, not ids.
  const existing = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(ilike(permissions.code, `${resource}:%`));
  const existingCodes = new Set(existing.map((r) => r.code));
  const desiredCodes = new Set(actions.map((a) => `${resource}:${a.trim()}`).filter(Boolean));

  const toAddCodes = [...desiredCodes].filter((c) => !existingCodes.has(c));
  const toRemoveIds = existing.filter((r) => !desiredCodes.has(r.code)).map((r) => r.id);
  const removedCodes = existing.filter((r) => !desiredCodes.has(r.code)).map((r) => r.code);

  // Apply both changes in a transaction — leaves the group in a
  // consistent state if either side fails.
  await db.transaction(async (tx) => {
    if (toAddCodes.length > 0) {
      await tx
        .insert(permissions)
        .values(
          toAddCodes.map((code) => {
            const action = code.slice(resource.length + 1);
            return {
              code,
              name: `${action[0]!.toUpperCase()}${action
                .slice(1)
                .replace(/_/g, ' ')} ${resource.replace(/_/g, ' ')}`,
              description: `Auto-generated from group '${resource}'.`,
            };
          }),
        )
        .onConflictDoNothing({ target: permissions.code });
    }
    if (toRemoveIds.length > 0) {
      await tx.delete(permissions).where(inArray(permissions.id, toRemoveIds));
    }
  });

  // Single audit row only when something actually changed. No-op
  // edits (admin opens the dialog, hits save without touching it)
  // shouldn't pollute the audit log.
  if (toAddCodes.length > 0 || removedCodes.length > 0) {
    await audit({
      actor,
      action: 'update',
      entityId: null,
      before: { codes: [...existingCodes].sort() },
      after: { codes: [...desiredCodes].sort() },
      summary:
        `Updated permission group '${resource}' ` +
        `(+${toAddCodes.length} / -${removedCodes.length})`,
    });
  }

  return {
    codes: [...desiredCodes].sort(),
    added: toAddCodes.sort(),
    removed: removedCodes.sort(),
  };
}

// ── UPDATE ───────────────────────────────────────────────────
export interface UpdatePermissionInput {
  code?: string;
  name?: string;
  description?: string | null;
}

export type UpdatePermissionResult =
  | { status: 'updated'; row: PermissionRow }
  | { status: 'not-found' }
  | { status: 'no-fields' };

export async function updatePermission(
  id: string,
  input: UpdatePermissionInput,
  actor: Actor,
): Promise<UpdatePermissionResult> {
  if (Object.keys(input).length === 0) {
    return { status: 'no-fields' };
  }

  const [before] = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
  if (!before) return { status: 'not-found' };

  const [row] = await db
    .update(permissions)
    // Bump `updated_at` so the admin permissions list's "Updated"
    // column reflects this edit (same convention as iam.roles).
    .set({ ...input, updatedAt: new Date() })
    .where(eq(permissions.id, id))
    .returning();
  if (!row) return { status: 'not-found' };

  await audit({
    actor,
    action: 'update',
    entityId: id,
    before: { code: before.code, name: before.name, description: before.description },
    after: { code: row.code, name: row.name, description: row.description },
    summary: `Updated permission ${row.code}`,
  });

  return { status: 'updated', row };
}

// ── DELETE ───────────────────────────────────────────────────
export type DeletePermissionResult = { status: 'deleted' } | { status: 'not-found' };

export async function deletePermission(id: string, actor: Actor): Promise<DeletePermissionResult> {
  const res = await db.delete(permissions).where(eq(permissions.id, id)).returning();
  if (res.length === 0) return { status: 'not-found' };

  await audit({
    actor,
    action: 'delete',
    entityId: id,
    summary: `Deleted permission ${res[0].code}`,
  });

  return { status: 'deleted' };
}

// ── DELETE GROUP ─────────────────────────────────────────────
// Deletes every permission whose code starts with `${resource}:` in
// one round-trip and writes ONE audit row for the whole group — the
// FE's group-delete dialog used to loop `deletePermission` per id,
// producing N audit rows for a single admin action. Mirrors the
// create-group path which has always batched its audit (one row,
// `entityId: null`, `after: { codes: [...] }`).
export type DeletePermissionGroupResult =
  | { status: 'deleted'; codes: string[] }
  | { status: 'not-found' };

export async function deletePermissionGroup(
  resource: string,
  actor: Actor,
): Promise<DeletePermissionGroupResult> {
  // `like` with the trailing `:` is a strict prefix match — doesn't
  // catch sibling resources that happen to share a name fragment.
  const deleted = await db
    .delete(permissions)
    .where(ilike(permissions.code, `${resource}:%`))
    .returning({ code: permissions.code });
  if (deleted.length === 0) return { status: 'not-found' };

  const codes = deleted.map((r) => r.code).sort();
  await audit({
    actor,
    action: 'delete',
    entityId: null,
    before: { codes },
    summary: `Deleted ${codes.length} permission(s) in group '${resource}'`,
  });

  return { status: 'deleted', codes };
}
