/**
 * Field Ops schema — inspections, findings, training, coaching, farm plans.
 * Mirrors `field_ops.*` tables from migration 004, 013.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { farmers } from './farmer';
import { cooperatives, users } from './iam';

export const fieldOpsSchema = pgSchema('field_ops');

export const inspections = fieldOpsSchema.table(
  'inspections',
  {
    id: uuid().primaryKey().defaultRandom(),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    inspectionYear: integer('inspection_year').notNull(),
    inspectionDate: date('inspection_date'),
    inspectorUserId: uuid('inspector_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    complianceStatus: text('compliance_status'),
    score: numeric({ precision: 5, scale: 2 }),
    certificationStatus: text('certification_status'),
    sourceSubmissionUuid: text('source_submission_uuid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('inspections_farmer_year_uk').on(t.farmerId, t.inspectionYear),
    index('idx_inspections_active_by_farmer')
      .on(t.farmerId, t.inspectionYear)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const inspectionFindings = fieldOpsSchema.table(
  'inspection_findings',
  {
    id: uuid().primaryKey().defaultRandom(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    requirementCode: text('requirement_code').notNull(),
    severity: text().notNull(),
    findingStatus: text('finding_status').notNull().default('open'),
    notes: text(),
    // FK to reference.ra_indicator added in migration 011.
    raIndicatorId: uuid('ra_indicator_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('findings_severity_check', sql`${t.severity} IN ('minor','major','critical')`),
    check('findings_status_check', sql`${t.findingStatus} IN ('open','resolved','waived')`),
  ],
);

export const followUpActions = fieldOpsSchema.table(
  'follow_up_actions',
  {
    id: uuid().primaryKey().defaultRandom(),
    inspectionId: uuid('inspection_id').references(() => inspections.id, {
      onDelete: 'set null',
    }),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actionType: text('action_type').notNull(),
    description: text(),
    dueDate: date('due_date'),
    status: text().notNull().default('open'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('follow_up_status_check', sql`${t.status} IN ('open','in_progress','done','cancelled')`),
  ],
);

export const trainingModules = fieldOpsSchema.table('training_modules', {
  id: uuid().primaryKey().defaultRandom(),
  cooperativeId: uuid('cooperative_id').references(() => cooperatives.id, {
    onDelete: 'set null',
  }),
  title: text().notNull(),
  description: text(),
  objectives: text(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});

export const trainingSessions = fieldOpsSchema.table('training_sessions', {
  id: uuid().primaryKey().defaultRandom(),
  moduleId: uuid('module_id')
    .notNull()
    .references(() => trainingModules.id, { onDelete: 'restrict' }),
  cooperativeId: uuid('cooperative_id')
    .notNull()
    .references(() => cooperatives.id, { onDelete: 'restrict' }),
  facilitatorUserId: uuid('facilitator_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  sessionDate: date('session_date'),
  location: text(),
  notes: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});

export const trainingAttendance = fieldOpsSchema.table(
  'training_attendance',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => trainingSessions.id, { onDelete: 'cascade' }),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    attendanceStatus: text('attendance_status').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attendance_session_farmer_uk').on(t.sessionId, t.farmerId),
    check('attendance_status_check', sql`${t.attendanceStatus} IN ('attended','absent','excused')`),
  ],
);

export const coachingVisits = fieldOpsSchema.table('coaching_visits', {
  id: uuid().primaryKey().defaultRandom(),
  farmerId: text('farmer_id')
    .notNull()
    .references(() => farmers.id, { onDelete: 'restrict' }),
  cooperativeId: uuid('cooperative_id')
    .notNull()
    .references(() => cooperatives.id, { onDelete: 'restrict' }),
  coachUserId: uuid('coach_user_id').references(() => users.id, { onDelete: 'set null' }),
  visitDate: date('visit_date'),
  attendeesCount: integer('attendees_count'),
  summary: text(),
  actionsAgreed: text('actions_agreed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
});

export const farmDevelopmentPlans = fieldOpsSchema.table(
  'farm_development_plans',
  {
    id: uuid().primaryKey().defaultRandom(),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text().notNull().default('draft'),
    planNotes: text('plan_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('fdp_status_check', sql`${t.status} IN ('draft','active','completed','cancelled')`),
  ],
);

export const coachingReports = fieldOpsSchema.table('coaching_reports', {
  id: uuid().primaryKey().defaultRandom(),
  coachingVisitId: uuid('coaching_visit_id')
    .notNull()
    .references(() => coachingVisits.id, { onDelete: 'cascade' }),
  progressSummary: text('progress_summary'),
  nextSteps: text('next_steps'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
