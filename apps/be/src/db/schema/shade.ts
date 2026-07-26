/**
 * Shade Trees schema — `shade.*` tables. JSONB-first mirror of the
 * Kobo `shade_trees` form (asset `a4J8U78iDFN6PsuDfKx8aX`).
 *
 *   • `tree_profiling`   — 1 row per Kobo submission (per tree)
 *   • `survival_checks`  — derived per-parcel snapshot, recomputed by
 *                          the parser after each tree_profiling upsert
 *
 * DDL: `0052_shade_trees_schema.sql`. Not re-exported from
 * `schema/index.ts` (same convention as primary-evacuation, coaching,
 * training, purchase) — import directly:
 *
 *   import { treeProfiling, survivalChecks } from '../../db/schema/shade';
 */

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives } from './iam';

export const shadeSchema = pgSchema('shade');

export const treeProfiling = shadeSchema.table(
  'tree_profiling',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    farmerId: text('farmer_id'),
    parcelId: text('parcel_id'),

    farmerName: text('farmer_name'),
    district: text(),
    society: text(),
    enumerator: text(),

    dateObserved: date('date_observed').notNull(),
    species: text().notNull(),
    treeTagNum: text('tree_tag_num'),
    dbhCm: numeric('dbh_cm', { precision: 6, scale: 1 }),
    heightClass: text('height_class'),
    treeCondition: text('tree_condition'),
    isAlive: boolean('is_alive').notNull(),
    gpsPoint: text('gps_point'),
    photoFilename: text('photo_filename'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shade_tree_profiling_kobo_uuid_uk').on(t.koboUuid),
    index('shade_tree_profiling_coop_date_idx').on(t.cooperativeId, t.dateObserved.desc()),
    index('shade_tree_profiling_farmer_idx').on(t.farmerId),
    index('shade_tree_profiling_parcel_idx').on(t.parcelId),
    index('shade_tree_profiling_species_idx').on(t.species),
  ],
);

export const survivalChecks = shadeSchema.table(
  'survival_checks',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id),
    farmerId: text('farmer_id'),
    parcelId: text('parcel_id').notNull(),
    totalTrees: integer('total_trees').notNull(),
    aliveTrees: integer('alive_trees').notNull(),
    deadTrees: integer('dead_trees').notNull(),
    survivalPct: numeric('survival_pct', { precision: 5, scale: 2 }).notNull(),
    lastObservedAt: date('last_observed_at').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shade_survival_checks_coop_parcel_uk').on(t.cooperativeId, t.parcelId),
    index('shade_survival_checks_farmer_idx').on(t.farmerId),
    index('shade_survival_checks_pct_idx').on(t.survivalPct),
  ],
);
