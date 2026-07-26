/**
 * Audit log writer. Every mutation route (create / update / delete /
 * restore / assign-*) calls `writeAudit()` after the DB write succeeds
 * so `audit.audit_logs` becomes the single source of truth for "who
 * did what, when, on which entity".
 *
 * Three design choices worth flagging:
 *
 *   • Failures are **swallowed** — audit must never break the user-
 *     facing mutation. We log to stderr instead. If we eventually want
 *     hard durability, switch this to a transactional outbox.
 *
 *   • Field-level diffs (`audit.entity_changes`) are computed by
 *     shallow-comparing the `before` / `after` objects. Pass only the
 *     fields you care about — primarily user-editable columns. Internal
 *     bookkeeping like `updatedAt` / `passwordHash` / `id` should be
 *     excluded by the caller.
 *
 *   • The `metadata` JSONB column has a stable shape — every audit
 *     row, regardless of entity_table, lands as:
 *
 *       {
 *         status:    'success' | 'failed' | 'warning',
 *         summary:   string,             // headline rendered in UI
 *         entity:    { …domain fields }, // snapshot — see below
 *         ipAddress, userAgent, sessionId,
 *         …caller extras
 *       }
 *
 *     `entity` is the domain-specific snapshot (e.g. farmerCode +
 *     firstName + lastName for farmers; parcelCode + areaHa for
 *     parcels). Storing it inline lets history pages and
 *     notifications render WITHOUT joining the source table — the
 *     audit row stays useful even after the source row is deleted.
 *     Pass via the `entitySnapshot` param; the helper merges it.
 */

import { createHash } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { db } from '../db/client';
import { auditAttachment, auditLogs } from '../db/schema/audit';
import { tiered, toDateKey } from './tiered-storage';

/** SHA-256 hex digest — used as the per-event content hash that
 *  goes into the `audit_attachment.sha256` column and as a key
 *  prefix on disk / Spaces. */
function sha256Hex(content: Buffer | Uint8Array | string): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return createHash('sha256').update(buf).digest('hex');
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'soft-delete'
  | 'restore'
  | 'assign-roles'
  | 'assign-permissions'
  | 'assign-cooperative'
  | 'login'
  | 'logout';

export interface AuditWriteParams {
  /** Logged-in user issuing the change. Required. */
  actorUserId: string;
  /** DB schema of the touched entity (e.g. `iam`, `farmer`, `gis`). */
  entitySchema: string;
  /** Table name without schema prefix. */
  entityTable: string;
  /** Natural / surrogate id of the row (text — UUIDs and codes both fit). */
  entityId?: string | null;
  /** Verb describing the change. */
  action: AuditAction | string;
  /** State BEFORE the mutation, for diff. Omit on `create`. */
  before?: Record<string, unknown> | null;
  /** State AFTER the mutation, for diff. Omit on `delete` if you want
   *  to record a delete with no diff rows. */
  after?: Record<string, unknown> | null;
  /** Optional cooperative scope for filtering. */
  cooperativeId?: string | null;
  /** Human-readable summary surfaced in the audit-log UI and the
   *  notification bell. One short sentence; the row is unreadable
   *  without it once the diff is collapsed. */
  summary?: string;
  /** Domain-specific snapshot of the affected record's small "label
   *  fields" (e.g. for farmer: `{farmerCode, firstName, lastName}`;
   *  for parcel: `{parcelCode, areaHa, farmerCode}`). Stored at
   *  `metadata.entity`. Lets history pages / notifications render
   *  without joining the source table — and keeps the row useful
   *  after the source row is hard-deleted. Only include label-style
   *  fields, NOT the full row. */
  entitySnapshot?: Record<string, unknown>;
  /** Extra metadata merged into the JSONB column. Sits last in the
   *  spread, so it can override `entity` / `summary` etc. if a caller
   *  really needs to. Don't use it for label snapshots — use
   *  `entitySnapshot` so the contract stays explicit. */
  metadata?: Record<string, unknown>;
  /** Hono context — used to extract IP / user-agent / session id. */
  // Loosely-typed: writeAudit only reads `req.raw.headers`, `get('sessionId')`,
  // and connInfo — none of which depend on a specific Variables shape. Using
  // `any` lets callers pass either AuthedContext or ActiveCoopContext.
  // biome-ignore lint/suspicious/noExplicitAny: accepts any context type
  ctx?: Context<any>;
  /**
   * Pre-extracted request metadata. Lets a service-layer caller (which
   * must not depend on hono) pass through ip/userAgent/sessionId without
   * threading the full `Context` down. When provided, takes precedence
   * over anything we'd otherwise pull from `ctx`.
   */
  actor?: {
    ip?: string | null;
    userAgent?: string | null;
    sessionId?: string | null;
  };
}

/**
 * Write a single audit-log row + (optionally) the field-level
 * `entity_changes` derived from the `before` / `after` diff.
 *
 * Returns the inserted audit-log id, or `null` if the write failed.
 * Callers MUST NOT depend on the returned id for control flow — the
 * mutation itself has already succeeded by the time this runs.
 */
export async function writeAudit(params: AuditWriteParams): Promise<number | null> {
  try {
    // No-op suppression: when both `before` and `after` are passed
    // (i.e. an update / assign / replace flow) AND nothing actually
    // changed, skip the write. Otherwise dialogs that fan out to
    // multiple endpoints (e.g. user-edit fires PATCH /users + PUT
    // /users/:id/roles on save) leave a trail of redundant rows even
    // when the second endpoint was a no-op. Pure-create / pure-
    // delete / login / restore actions don't pass both sides, so
    // they always record.
    if (params.before != null && params.after != null) {
      const diffs = computeDiffs(params.before, params.after);
      if (diffs.length === 0) return null;
    }

    const { ctx, actor } = params;
    const headers = ctx?.req.raw.headers;
    // IP resolution priority:
    //   0. Explicit `actor.ip` (service-layer caller already extracted it)
    //   1. `X-Forwarded-For` first hop (set by reverse proxy / dev
    //      proxy when `xfwd` is on)
    //   2. `X-Real-IP` (alternate proxy header)
    //   3. node-server conninfo socket address (works without any
    //      proxy headers — covers `bun test` via app.fetch + bare
    //      localhost dev). IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is
    //      stripped so the value matches the X-Forwarded-For format.
    let ipAddress: string | null =
      actor?.ip ??
      headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers?.get('x-real-ip') ??
      null;
    if (!ipAddress && ctx) {
      try {
        const info = getConnInfo(ctx);
        const raw = info.remote.address ?? null;
        ipAddress = raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
      } catch {
        // getConnInfo throws when there's no underlying socket
        // (e.g. tests via `app.fetch(new Request(...))`). Leave
        // ipAddress null and let the metadata reflect that.
      }
    }
    const userAgent = actor?.userAgent ?? headers?.get('user-agent') ?? null;
    const sessionId = actor?.sessionId ?? ctx?.get('sessionId') ?? null;

    const metadata: Record<string, unknown> = {
      status: 'success',
      ...(params.summary ? { summary: params.summary } : {}),
      ...(params.entitySnapshot ? { entity: params.entitySnapshot } : {}),
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(params.metadata ?? {}),
    };

    const [inserted] = await db
      .insert(auditLogs)
      .values({
        actorUserId: params.actorUserId,
        serviceName: 'admin-ui',
        entitySchema: params.entitySchema,
        entityTable: params.entityTable,
        entityId: params.entityId ?? null,
        action: params.action,
        cooperativeId: params.cooperativeId ?? null,
        metadata,
      })
      .returning({ id: auditLogs.id });

    const diffs = computeDiffs(params.before ?? null, params.after ?? null);
    if (diffs.length > 0) {
      // Offload diff to TieredStorage — disk hot tier + Spaces cold
      // archive. The storage key encodes the date (`YYYY-MM-DD`) as
      // the first segment so the reader knows which day folder /
      // archive to fetch from. Older 1-month rolloff + thaw are
      // handled by the daily cron (see `scripts/storage-maintenance.ts`).
      const json = JSON.stringify(diffs);
      const sha = sha256Hex(json);
      const day = toDateKey(new Date());
      const relPath = `audit/${inserted.id}/${sha.slice(0, 16)}`;
      const key = `${day}/${relPath}.json`;
      try {
        await tiered().write(day, relPath, diffs);
        const [att] = await db
          .insert(auditAttachment)
          .values({
            auditLogId: inserted.id,
            filename: 'diff.json',
            mimeType: 'application/json',
            sizeBytes: Buffer.byteLength(json, 'utf-8'),
            sha256: sha,
            storageBackend: 'tiered',
            storageKey: key,
          })
          .returning({ id: auditAttachment.id });

        // Back-reference inside the audit row so the FE can detect
        // a diff exists without a second JOIN. Single UPDATE — the
        // INSERT already happened with the base metadata block.
        await db
          .update(auditLogs)
          .set({
            metadata: {
              ...metadata,
              diff: {
                attachmentId: att.id,
                fieldCount: diffs.length,
              },
            },
          })
          .where(eq(auditLogs.id, inserted.id));
      } catch (err) {
        // Storage hiccup must NOT lose the audit row — log + carry
        // on. Detail page will render "diff unavailable" gracefully.
        console.error('[audit] diff offload failed:', err);
      }
    }

    return inserted.id;
  } catch (err) {
    // Audit failure must never block the request that just succeeded.
    console.error('[audit] writeAudit failed:', err);
    return null;
  }
}

/**
 * Shallow-diff two records and return the fields that changed.
 *
 * Rules:
 *   - Field exists in both, value differs (deep-equal via JSON) → diff
 *   - Field present only in `after`  (e.g. created)             → diff with `oldValue=null`
 *   - Field present only in `before` (e.g. cleared)             → diff with `newValue=null`
 *
 * Caller controls which fields make it through by choosing what to
 * pass — there's no "exclude list" here on purpose, so adding a new
 * column to a table doesn't accidentally start logging it.
 */
export function computeDiffs(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  if (!before && !after) return [];
  const keys = new Set([
    ...(before ? Object.keys(before) : []),
    ...(after ? Object.keys(after) : []),
  ]);
  const out: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ field: k, oldValue: a ?? null, newValue: b ?? null });
    }
  }
  return out;
}

/** Shape of one diff entry as serialised by writeAudit + read back
 *  from storage. Kept inline to avoid a one-field types file. */
export interface AuditDiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** Read an audit diff blob back from TieredStorage. Returns null if
 *  the storage key is malformed (legacy non-dated key from before
 *  the TieredStorage cutover) or if the blob is absent.
 *
 *  Caller (audit/service.ts) renders these into the FE diff preview
 *  or the per-entry detail rows. */
export async function readAuditDiff(storageKey: string): Promise<AuditDiffEntry[] | null> {
  // Format introduced when we moved to TieredStorage:
  //   `<YYYY-MM-DD>/audit/<auditLogId>/<sha-prefix>.json`
  // Older rows have keys like `audit/<auditLogId>/<sha>.json` (no
  // date prefix). For an empty-DB cutover (POC) we treat those as
  // legacy + return null so the FE just shows the audit row without
  // expandable changes — acceptable until a backfill lands.
  const m = storageKey.match(/^(\d{4}-\d{2}-\d{2})\/(.+?)(?:\.json)?$/);
  if (!m) return null;
  const [, date, relPath] = m;
  return (await tiered().read<AuditDiffEntry[]>(date!, relPath!)) ?? null;
}
