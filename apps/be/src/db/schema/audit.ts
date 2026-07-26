/**
 * Audit schema — immutable audit log, field-level changes, report audit.
 * Mirrors `audit.*` tables from migration 009.
 */

import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives, users } from './iam';
import { reportRuns } from './reporting';

export const auditSchema = pgSchema('audit');

export const auditLogs = auditSchema.table(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    serviceName: text('service_name'),
    entitySchema: text('entity_schema').notNull(),
    entityTable: text('entity_table').notNull(),
    entityId: text('entity_id'),
    action: text().notNull(),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every list query sorts by created_at DESC; composite (filter,
  // created_at DESC) indexes satisfy the common filters (per-entity
  // history feed, user actions, coop-scoped feed) + the sort in one scan.
  (t) => [
    index('idx_audit_logs_created_at').on(t.createdAt.desc()),
    index('idx_audit_logs_entity').on(t.entityTable, t.entityId, t.createdAt.desc()),
    index('idx_audit_logs_actor').on(t.actorUserId, t.createdAt.desc()),
    index('idx_audit_logs_coop').on(t.cooperativeId, t.createdAt.desc()),
  ],
);

/**
 * Audit-attachment — externally-stored blobs (diff JSON, exported
 * reports, bulk-import source files) referenced by an audit log
 * row. The audit row keeps a small `metadata.attachments[]` /
 * `metadata.diff` pointer; the bytes live in the storage backend
 * keyed by `storage_key`.
 *
 * Replaces the per-field `entity_changes` table — diffs are now
 * single-blob JSON written to storage on each mutation.
 */
export const auditAttachment = auditSchema.table(
  'audit_attachment',
  {
    id: uuid().primaryKey().defaultRandom(),
    auditLogId: bigint('audit_log_id', { mode: 'number' })
      .notNull()
      .references(() => auditLogs.id, { onDelete: 'cascade' }),
    filename: text().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text().notNull(),
    storageBackend: text('storage_backend').notNull().default('local'),
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_attachment_log').on(t.auditLogId)],
);

export const reportAuditLogs = auditSchema.table('report_audit_logs', {
  id: uuid().primaryKey().defaultRandom(),
  reportRunId: uuid('report_run_id').references(() => reportRuns.id, {
    onDelete: 'set null',
  }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  reportCode: text('report_code').notNull(),
  parameters: jsonb(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
