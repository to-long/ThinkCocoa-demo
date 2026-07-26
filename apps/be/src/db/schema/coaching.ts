/**
 * Coaching schema — `coaching.*` tables.
 *
 * JSONB-first model mirroring inspections: the full Kobo submission
 * (including Sections B–G repeat groups) lives in `raw_data`, with
 * denormalized columns for everything the list / dashboard filters
 * or sorts by:
 *
 *   • CLMRS risk verdict + case id (filter for at-risk dashboard)
 *   • GAP / IPM / GEP / GSP compliance scores (sorting + tiles)
 *   • Activity row counts per section (B–G) so the list page can
 *     render "12 activities" without unfolding jsonb
 *   • follow_up_required + follow_up_date (pending follow-ups view)
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
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { farmers } from './farmer';
import { parcels } from './gis';
import { cooperatives } from './iam';

export const coachingSchema = pgSchema('coaching');

export const coachingVisits = coachingSchema.table(
  'coaching_visits',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    // FK columns — nullable so an orphan (farmer not yet in master)
    // can still ingest and be flagged in the UI.
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    farmerId: text('farmer_id').references(() => farmers.id),
    parcelId: text('parcel_id').references(() => parcels.id),

    coachName: text('coach_name'),
    visitDate: date('visit_date').notNull(),
    district: text(),
    society: text(),

    // CLMRS verdict
    clmrsRiskLevel: text('clmrs_risk_level'),
    clmrsCaseId: text('clmrs_case_id'),
    childrenObservedWorking: boolean('children_observed_working'),
    numChildrenInHousehold: smallint('num_children_in_household'),

    // Compliance scores (0..100)
    gapScore: smallint('gap_score'),
    ipmScore: smallint('ipm_score'),
    gepScore: smallint('gep_score'),
    gspScore: smallint('gsp_score'),
    overallScore: smallint('overall_score'),

    // EUDR critical flag
    gepNoDeforestation: boolean('gep_no_deforestation'),

    // Activity counts (Sections B–G)
    nChemicalApps: smallint('n_chemical_apps').notNull().default(0),
    nFertilizerApps: smallint('n_fertilizer_apps').notNull().default(0),
    nWeedingActs: smallint('n_weeding_acts').notNull().default(0),
    nPruningActs: smallint('n_pruning_acts').notNull().default(0),
    nHarvestActs: smallint('n_harvest_acts').notNull().default(0),
    nOtherActs: smallint('n_other_acts').notNull().default(0),

    // Workflow (Section P)
    followUpRequired: boolean('follow_up_required').notNull().default(false),
    followUpDate: date('follow_up_date'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    // Synthetic Kobo-shaped form payload for the detail page (demo only).
    rawData: jsonb('raw_data'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coaching_visits_kobo_uuid_uk').on(t.koboUuid),
    check(
      'coaching_visits_clmrs_check',
      sql`${t.clmrsRiskLevel} IS NULL OR ${t.clmrsRiskLevel} IN ('no_risk','at_risk','case')`,
    ),
    index('coaching_visits_visit_date_idx').on(t.visitDate.desc()),
    index('coaching_visits_cooperative_date_idx').on(t.cooperativeId, t.visitDate.desc()),
    index('coaching_visits_farmer_date_idx').on(t.farmerId, t.visitDate.desc()),
    index('coaching_visits_parcel_idx').on(t.parcelId),
  ],
);

export const coachingVisitsRelations = relations(coachingVisits, ({ one }) => ({
  cooperative: one(cooperatives, {
    fields: [coachingVisits.cooperativeId],
    references: [cooperatives.id],
  }),
  farmer: one(farmers, { fields: [coachingVisits.farmerId], references: [farmers.id] }),
  parcel: one(parcels, { fields: [coachingVisits.parcelId], references: [parcels.id] }),
}));
