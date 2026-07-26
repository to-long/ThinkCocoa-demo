/**
 * CLMRS case register.
 *
 * A CLMRS "flag" (an at-risk / case observation) lives on a coaching
 * visit (`coaching.coaching_visits.clmrs_risk_level`). When IMS staff
 * open a remediation case for that observation, a row is written here,
 * keyed by `child_id` (= the originating coaching visit id). Status is
 * mutable (open → processing → closed) and survives coaching re-syncs.
 */

import { sql } from 'drizzle-orm';
import { check, date, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const clmrsSchema = pgSchema('clmrs');

export const clmrsCases = clmrsSchema.table(
  'cases',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** = coaching visit id of the originating flag (one case per flag). */
    childId: text('child_id').notNull().unique(),
    clmrsCode: text('clmrs_code').notNull(),
    status: text().notNull().default('open'),
    lastVisitDate: date('last_visit_date'),
    followUpDate: date('follow_up_date'),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('clmrs_cases_status_check', sql`${t.status} IN ('open','processing','closed')`),
  ],
);
