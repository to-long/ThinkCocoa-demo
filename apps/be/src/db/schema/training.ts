/**
 * Training schema — `training.*` tables.
 *
 * Two tables:
 *   • `training_sessions`   — 1 row per group training event
 *   • `training_attendance` — 1 row per farmer who signed in
 *
 * Sessions are JSONB-first (full Kobo payload preserved in
 * `raw_data`); attendance is fully normalised because the FE roster
 * table + farmer-detail "trainings attended" list both query at the
 * per-participant level.
 *
 * Source-of-truth DDL: `0028_coaching_training_schema.sql`.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { farmers } from './farmer';
import { cooperatives } from './iam';

export const trainingSchema = pgSchema('training');

export const trainingSessions = trainingSchema.table(
  'training_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),

    trainingDate: date('training_date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    durationMinutes: integer('duration_minutes'),

    program: text(),
    trainingType: text('training_type'),
    trainingTopics: text('training_topics').array(),
    participantCategory: text('participant_category'),
    district: text(),
    society: text(),
    venue: text(),

    trainerName: text('trainer_name'),
    trainerPhone: text('trainer_phone'),

    numMale: smallint('num_male'),
    numFemale: smallint('num_female'),
    totalParticipants: smallint('total_participants'),
    consentCount: smallint('consent_count'),
    consentRate: numeric('consent_rate', { precision: 5, scale: 2 }),

    sessionObjectivesMet: boolean('session_objectives_met'),
    participantEngagement: text('participant_engagement'),
    trainerRemarks: text('trainer_remarks'),
    trainerSignatureUrl: text('trainer_signature_url'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('training_sessions_kobo_uuid_uk').on(t.koboUuid),
    check(
      'training_sessions_engagement_check',
      sql`${t.participantEngagement} IS NULL OR ${t.participantEngagement} IN ('low','medium','high')`,
    ),
    index('training_sessions_training_date_idx').on(t.trainingDate.desc()),
    index('training_sessions_cooperative_date_idx').on(t.cooperativeId, t.trainingDate.desc()),
  ],
);

export const trainingAttendance = trainingSchema.table(
  'training_attendance',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => trainingSessions.id, { onDelete: 'cascade' }),

    farmerId: text('farmer_id').references(() => farmers.id),

    farmerCode: text('farmer_code').notNull(),
    farmerName: text('farmer_name'),
    gender: text(),
    cooperative: text(),
    phone: text(),

    consent: boolean().notNull().default(false),
    signatureUrl: text('signature_url'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('training_attendance_session_farmer_uk').on(t.sessionId, t.farmerCode),
    index('training_attendance_session_idx').on(t.sessionId),
  ],
);

export const trainingSessionsRelations = relations(trainingSessions, ({ one, many }) => ({
  cooperative: one(cooperatives, {
    fields: [trainingSessions.cooperativeId],
    references: [cooperatives.id],
  }),
  attendance: many(trainingAttendance),
}));

export const trainingAttendanceRelations = relations(trainingAttendance, ({ one }) => ({
  session: one(trainingSessions, {
    fields: [trainingAttendance.sessionId],
    references: [trainingSessions.id],
  }),
  farmer: one(farmers, {
    fields: [trainingAttendance.farmerId],
    references: [farmers.id],
  }),
}));
