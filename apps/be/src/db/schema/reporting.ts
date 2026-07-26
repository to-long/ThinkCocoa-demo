/**
 * Reporting schema — report runs, artifacts, dashboard snapshots, caches.
 * Mirrors `reporting.*` tables from migrations 007, 016.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives, users } from './iam';

export const reportingSchema = pgSchema('reporting');

export const reportRuns = reportingSchema.table(
  'report_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    reportCode: text('report_code').notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    districtScope: text('district_scope'),
    parameters: jsonb(),
    outputFormat: text('output_format').notNull(),
    status: text().notNull().default('queued'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    /** Populated when the run terminates as 'failed' — surfaced in the FE
     *  history list so admins can see why an export bombed without digging
     *  into server logs. Free-form string trimmed by the worker. */
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('report_runs_format_check', sql`${t.outputFormat} IN ('pdf','excel','csv','json')`),
    check(
      'report_runs_status_check',
      sql`${t.status} IN ('queued','running','completed','failed')`,
    ),
  ],
);

export const reportFiles = reportingSchema.table('report_files', {
  id: uuid().primaryKey().defaultRandom(),
  reportRunId: uuid('report_run_id')
    .notNull()
    .references(() => reportRuns.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dashboardSnapshots = reportingSchema.table(
  'dashboard_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    snapshotType: text('snapshot_type').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    payload: jsonb(),
    // Added in migration 016 — freshness markers for the projection worker.
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
    sourceVersion: text('source_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('dashboard_snapshots_uk').on(t.cooperativeId, t.snapshotType, t.snapshotDate),
  ],
);

export const traceabilityReportCache = reportingSchema.table(
  'traceability_report_cache',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    season: text(),
    payload: jsonb(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    sourceVersion: text('source_version'),
  },
  (t) => [uniqueIndex('trace_cache_uk').on(t.cooperativeId, t.season)],
);

export const inspectionReportCache = reportingSchema.table(
  'inspection_report_cache',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    inspectionYear: integer('inspection_year'),
    payload: jsonb(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    sourceVersion: text('source_version'),
  },
  (t) => [uniqueIndex('inspection_cache_uk').on(t.cooperativeId, t.inspectionYear)],
);
