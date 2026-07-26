/**
 * Integration schema — sync SETTINGS only.
 *
 * The demo no longer syncs from Kobo (the sync engine, scheduler, and
 * Kobo-ingest tables were removed). This table survives so the admin
 * Sync page can still read + save per-job settings; the run-tracking
 * columns are retained for shape compatibility but are never written
 * without a sync engine.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const integrationSchema = pgSchema('integration');

export const syncSettings = integrationSchema.table(
  'sync_settings',
  {
    id: uuid().primaryKey().defaultRandom(),
    jobKey: text('job_key').notNull().unique(),
    label: text().notNull(),
    description: text(),
    sourceUrl: text('source_url').notNull(),
    fieldMapping: jsonb('field_mapping').notNull().default(sql`'{}'::jsonb`),
    autoSyncEnabled: boolean('auto_sync_enabled').notNull().default(false),
    intervalMinutes: integer('interval_minutes').notNull().default(1440),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastQueryAt: timestamp('last_query_at', { withTimezone: true }),
    lastRunStatus: text('last_run_status'),
    lastRunSummary: jsonb('last_run_summary'),
    snapshotHash: text('snapshot_hash'),
    snapshotUploadedAt: timestamp('snapshot_uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sync_settings_interval_check', sql`${t.intervalMinutes} >= 1`),
    check(
      'sync_settings_status_check',
      sql`${t.lastRunStatus} IS NULL OR ${t.lastRunStatus} IN ('running','success','failed')`,
    ),
  ],
);
