/**
 * Audit log — DB access layer.
 *
 * Pure async functions that take typed inputs and return typed data.
 * No knowledge of Hono context, headers, or HTTP status codes —
 * route handlers translate filter strings → `AuditListFilters` and
 * map nullable returns into 404s.
 */

import {
  and,
  asc,
  count,
  desc,
  sql as dsql,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from 'drizzle-orm';
import { db } from '../../db/client';
import { auditAttachment, auditLogs } from '../../db/schema/audit';
import { cooperatives, users } from '../../db/schema/iam';
import { readAuditDiff } from '../../lib/audit';
import { type ChangePreview, type Row, SELECT_FIELDS } from './projection';
import type { AuditStatus } from './schemas';

/** Max number of field-level changes the LIST endpoint returns inline
 *  per row. The full diff still lives behind GET /:id detail; this is
 *  the slice the list cell renders without forcing an extra click. */
const LIST_CHANGES_PREVIEW_LIMIT = 3;

export interface AuditListFilters {
  q?: string;
  actorId?: string;
  /** Exact `entity_id` match — used by "follow this object" deep
   *  links (e.g. open the audit feed pinned to one farmer). */
  entityId?: string;
  entityTables: string[];
  /** Filter to events scoped to these cooperatives (audit row's
   *  `cooperative_id`). Empty array = no filter. */
  cooperativeIds: string[];
  actions: string[];
  /** Multi-select: 0+ statuses. Empty = no filter. Values outside
   *  `STATUS_VALUES` are dropped silently. */
  statuses: AuditStatus[];
  /** Already clamped to [1, 365] by the caller. Wins over `from`. */
  daysClamped?: number;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
  sort?: string;
  /** Server-side scope filter: only return rows whose
   *  `entity_table` resolves (via `audit.resource_from_entity_table`)
   *  to a resource in this set. Caller passes the set computed from
   *  the user's `:notification` permissions so non-admin viewers
   *  never see audit rows for a domain they can't subscribe to. */
  scopeResources?: string[];
}

export interface AuditListResult {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  /** Per-row change preview keyed by `audit_logs.id`. Missing entries
   *  = the row has no attached diff (create / delete / login / etc.). */
  changesById: Map<number, ChangePreview>;
}

export async function listAuditLogs(f: AuditListFilters): Promise<AuditListResult> {
  const conditions = [];
  if (f.actorId) conditions.push(eq(auditLogs.actorUserId, f.actorId));
  if (f.entityId) conditions.push(eq(auditLogs.entityId, f.entityId));
  if (f.entityTables.length > 0) {
    conditions.push(inArray(auditLogs.entityTable, f.entityTables));
  }
  if (f.cooperativeIds.length > 0) {
    // Include rows with `cooperative_id IS NULL` too — those are
    // org-wide admin events (role / permission / user edits) that
    // every accessible coop should see, otherwise system_admin
    // browsing a coop-filtered notification feed would miss every
    // admin-level audit row.
    conditions.push(
      or(inArray(auditLogs.cooperativeId, f.cooperativeIds), isNull(auditLogs.cooperativeId))!,
    );
  }
  if (f.actions.length > 0) {
    conditions.push(inArray(auditLogs.action, f.actions));
  }
  if (f.scopeResources && f.scopeResources.length > 0) {
    // Build an OR list of equality checks rather than `= ANY($1::text[])`
    // — drizzle interpolates JS arrays as `($1, $2, …)` (a record),
    // not as a `text[]`, so a direct cast errors at parse time.
    // Cheap because scopeResources is at most ~13 entries.
    const orClauses = f.scopeResources.map(
      (r) => dsql`audit.resource_from_entity_table(${auditLogs.entityTable}) = ${r}`,
    );
    conditions.push(or(...orClauses)!);
  }
  if (f.statuses.length > 0) {
    // drizzle's `inArray` won't accept raw SQL on the LHS, and its
    // template binding doesn't auto-expand arrays — so we OR a list
    // of equality checks. Cheap because `statuses` is at most 3.
    const orClauses = f.statuses.map((s) => dsql`(${auditLogs.metadata}->>'status') = ${s}`);
    conditions.push(or(...orClauses)!);
  }
  // `daysClamped` wins over `from`: easier URL-state semantics and avoids
  // the FE having to round-trip ISO timestamps that decay every tick.
  if (f.daysClamped) {
    const since = new Date(Date.now() - f.daysClamped * 86_400_000);
    conditions.push(gte(auditLogs.createdAt, since));
  } else if (f.from) {
    conditions.push(gte(auditLogs.createdAt, f.from));
  }
  if (f.to) conditions.push(lte(auditLogs.createdAt, f.to));
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(
      or(
        ilike(auditLogs.action, like),
        ilike(auditLogs.entityTable, like),
        ilike(auditLogs.entityId, like),
        ilike(users.email, like),
        ilike(users.name, like),
        dsql`(${auditLogs.metadata}->>'summary') ILIKE ${like}`,
      )!,
    );
  }
  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(whereExpr);

  // Parse JSON:API sort spec → drizzle order expression. Only the
  // first sort field is honoured today (single-column UI); the
  // multi-column path is left open for a future extension.
  let orderExpr = desc(auditLogs.createdAt);
  if (f.sort) {
    const first = f.sort.split(',')[0]?.trim() ?? '';
    const isDesc = first.startsWith('-');
    const field = isDesc ? first.slice(1) : first;
    if (field === 'createdAt') {
      orderExpr = isDesc ? desc(auditLogs.createdAt) : asc(auditLogs.createdAt);
    }
    // Anything else: unknown column, fall back to the default.
  }

  const offset = (f.page - 1) * f.pageSize;
  const rows = await db
    .select(SELECT_FIELDS)
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(cooperatives, eq(cooperatives.id, auditLogs.cooperativeId))
    .where(whereExpr)
    .orderBy(orderExpr)
    .limit(f.pageSize)
    .offset(offset);

  // Pull change previews for the rows on this page. Each row's diff
  // is a JSON blob in object storage referenced from `auditAttachment`.
  // We:
  //   1. find which rows on this page have an attachment (1 SQL query)
  //   2. fetch + parse only those blobs in parallel (capped at 3 entries)
  // create / delete / login / etc. rows have no attachment so they
  // skip the storage read entirely.
  const ids = (rows as Row[]).map((r) => r.id);
  const changesById =
    ids.length > 0
      ? await loadChangesPreviews(ids, LIST_CHANGES_PREVIEW_LIMIT)
      : new Map<number, ChangePreview>();

  return {
    rows: rows as Row[],
    total: Number(total),
    page: f.page,
    pageSize: f.pageSize,
    changesById,
  };
}

/**
 * Batch-load the top-N change entries for a set of audit-log ids.
 * Returns only ids that have an attachment row (rows without one are
 * absent from the map — the caller treats that as "no diff").
 *
 * Storage reads run in parallel; a single failed read is logged and
 * elided so it doesn't poison the rest of the page.
 */
async function loadChangesPreviews(
  auditLogIdsForPage: number[],
  limit: number,
): Promise<Map<number, ChangePreview>> {
  const out = new Map<number, ChangePreview>();
  const attachments = await db
    .select({
      auditLogId: auditAttachment.auditLogId,
      storageKey: auditAttachment.storageKey,
    })
    .from(auditAttachment)
    .where(inArray(auditAttachment.auditLogId, auditLogIdsForPage));
  if (attachments.length === 0) return out;

  await Promise.all(
    attachments.map(async (att) => {
      try {
        const parsed = await readAuditDiff(att.storageKey);
        if (!parsed) return; // legacy key (pre-tiered) or missing blob
        // Sort first so "preview" is deterministic (same order as the
        // detail endpoint), then slice to the limit.
        const sorted = [...parsed].sort((a, b) => a.field.localeCompare(b.field));
        out.set(Number(att.auditLogId), {
          preview: sorted.slice(0, limit).map((d) => ({
            fieldName: d.field,
            oldValue: d.oldValue ?? null,
            newValue: d.newValue ?? null,
          })),
          total: sorted.length,
        });
      } catch (err) {
        console.error('[audit] loadChangesPreviews skipped row', att.auditLogId, err);
      }
    }),
  );
  return out;
}

export interface AuditStatsResult {
  total: number;
  windowDays: number;
  byStatus: { success: number; failed: number; warning: number };
  byScope: { entityTable: string; count: number }[];
}

export async function getAuditLogStats(windowDays: number): Promise<AuditStatsResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const windowExpr = gte(auditLogs.createdAt, since);

  const [totals] = await db
    .select({
      total: count(),
      success: dsql<number>`CAST(SUM(CASE WHEN (${auditLogs.metadata}->>'status') = 'success' THEN 1 ELSE 0 END) AS INT)`,
      failed: dsql<number>`CAST(SUM(CASE WHEN (${auditLogs.metadata}->>'status') = 'failed' THEN 1 ELSE 0 END) AS INT)`,
      warning: dsql<number>`CAST(SUM(CASE WHEN (${auditLogs.metadata}->>'status') = 'warning' THEN 1 ELSE 0 END) AS INT)`,
    })
    .from(auditLogs)
    .where(windowExpr);

  // Top scopes (by event count) — caps at 8 to keep the row tidy.
  const byScope = await db
    .select({
      entityTable: auditLogs.entityTable,
      c: count(),
    })
    .from(auditLogs)
    .where(windowExpr)
    .groupBy(auditLogs.entityTable)
    .orderBy(desc(count()), asc(auditLogs.entityTable))
    .limit(8);

  return {
    total: Number(totals.total),
    windowDays,
    byStatus: {
      success: Number(totals.success ?? 0),
      failed: Number(totals.failed ?? 0),
      warning: Number(totals.warning ?? 0),
    },
    byScope: byScope.map((r) => ({
      entityTable: r.entityTable,
      count: Number(r.c),
    })),
  };
}

export interface AuditDetailResult {
  row: Row;
  changes: {
    id: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}

/**
 * Fetch the audit-log row only (no entity_changes). The route handler
 * then checks the caller's `:notification` perm against the row's
 * resource BEFORE deciding whether to load the changes — keeps the
 * 404-on-no-perm path constant-time so an unauthorised viewer can't
 * probe id existence by measuring response latency.
 */
export async function getAuditLogRow(id: number): Promise<Row | null> {
  const [row] = await db
    .select(SELECT_FIELDS)
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(cooperatives, eq(cooperatives.id, auditLogs.cooperativeId))
    .where(eq(auditLogs.id, id))
    .limit(1);
  return row ? (row as Row) : null;
}

/** Diff payload for an audit row — fetched from external storage
 *  via `audit_attachment`. The blob is a JSON array of
 *  `{field, oldValue, newValue}`. Returns `[]` when the row had
 *  no field-level changes (create / delete / login / etc.) OR
 *  when the storage fetch fails (the audit row stays accessible).
 *
 *  Called only after the route handler confirmed the caller has
 *  `<resource>:notification` for this row. */
export async function getAuditLogChanges(id: number): Promise<
  Array<{
    id: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }>
> {
  const [att] = await db
    .select({
      id: auditAttachment.id,
      storageKey: auditAttachment.storageKey,
    })
    .from(auditAttachment)
    .where(eq(auditAttachment.auditLogId, id))
    .limit(1);
  if (!att) return [];
  try {
    const parsed = await readAuditDiff(att.storageKey);
    if (!parsed) return [];
    return parsed
      .map((d, idx) => ({
        // Synthesise a stable id per change — caller (FE) uses it
        // as React key. Combine attachment id + array index.
        id: `${att.id}:${idx}`,
        fieldName: d.field,
        oldValue: d.oldValue ?? null,
        newValue: d.newValue ?? null,
      }))
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName));
  } catch (err) {
    console.error('[audit] getAuditLogChanges fetch failed:', err);
    return [];
  }
}

export async function getAuditLog(id: number): Promise<AuditDetailResult | null> {
  const row = await getAuditLogRow(id);
  if (!row) return null;
  const changes = await getAuditLogChanges(id);
  return { row, changes };
}
