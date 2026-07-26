/**
 * Audit log — JSONB extraction + row mapper shared between list/detail/stats.
 *
 * Status, IP, user-agent, session-id, and summary all live in the JSONB
 * `metadata` column on `audit.audit_logs`. We pull them out at projection
 * time so the FE never has to interpret raw JSONB — it gets typed columns.
 *
 * Kept separate from `service.ts` so a future audit consumer (background
 * worker, export job) can reuse the shape without dragging in route
 * dependencies.
 */

import { sql as dsql } from 'drizzle-orm';
import { auditLogs } from '../../db/schema/audit';
import { cooperatives, users } from '../../db/schema/iam';
import type { AuditStatus } from './schemas';

function metaText(field: string) {
  // Postgres JSONB ->> operator extracts the value as text. Wrapped in
  // dsql so drizzle inserts it correctly into SELECT projections.
  return dsql<string | null>`(${auditLogs.metadata}->>${field})`;
}

function statusFromMeta() {
  return dsql<AuditStatus | null>`CASE WHEN (${auditLogs.metadata}->>'status') IN ('success','failed','warning') THEN (${auditLogs.metadata}->>'status') ELSE NULL END`;
}

// Shared projection: list, stats, detail all share the same row shape
// (modulo the nested `changes` array on detail).
export const SELECT_FIELDS = {
  id: auditLogs.id,
  createdAt: auditLogs.createdAt,
  actorUserId: auditLogs.actorUserId,
  actorEmail: users.email,
  actorFullName: users.name,
  serviceName: auditLogs.serviceName,
  entitySchema: auditLogs.entitySchema,
  entityTable: auditLogs.entityTable,
  entityId: auditLogs.entityId,
  action: auditLogs.action,
  cooperativeId: auditLogs.cooperativeId,
  cooperativeName: cooperatives.name,
  status: statusFromMeta(),
  ipAddress: metaText('ipAddress'),
  userAgent: metaText('userAgent'),
  sessionId: metaText('sessionId'),
  summary: metaText('summary'),
  metadata: auditLogs.metadata,
};

export type Row = {
  id: number;
  createdAt: Date;
  actorUserId: string | null;
  actorEmail: string | null;
  actorFullName: string | null;
  serviceName: string | null;
  entitySchema: string;
  entityTable: string;
  entityId: string | null;
  action: string;
  cooperativeId: string | null;
  cooperativeName: string | null;
  status: AuditStatus | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  summary: string | null;
  metadata: unknown;
};

/** Compact preview of field-level changes attached to an audit row —
 *  surfaced in the list endpoint so the FE can render the top changes
 *  inline without doing 25 storage GETs to fetch each blob client-side.
 *  Full diff still lives behind the detail endpoint. */
export interface ChangePreviewEntry {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}
export interface ChangePreview {
  /** Top N (≤ 3) entries from the blob, sorted by fieldName. */
  preview: ChangePreviewEntry[];
  /** Total number of changes in the blob (may exceed `preview.length`). */
  total: number;
}

export function toRowResponse(r: Row, changes?: ChangePreview | null) {
  return {
    id: Number(r.id),
    createdAt: r.createdAt.toISOString(),
    actorUserId: r.actorUserId ?? null,
    actorEmail: r.actorEmail ?? null,
    actorFullName: r.actorFullName ?? null,
    serviceName: r.serviceName ?? null,
    entitySchema: r.entitySchema,
    entityTable: r.entityTable,
    entityId: r.entityId ?? null,
    action: r.action,
    cooperativeId: r.cooperativeId ?? null,
    cooperativeName: r.cooperativeName ?? null,
    status: r.status ?? null,
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
    sessionId: r.sessionId ?? null,
    summary: r.summary ?? null,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
    /** Top-N changes preview + total count. `null` when the row has
     *  no attached diff (create / delete / login / etc.). */
    changesPreview: changes ?? null,
  };
}
