/**
 * Traceability schema — purchases, batches, batch items, trace links.
 * Mirrors `traceability.*` tables from migrations 006, 013.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { farmers } from './farmer';
import { parcels } from './gis';
import { cooperatives, users } from './iam';

export const traceabilitySchema = pgSchema('traceability');

export const batches = traceabilitySchema.table(
  'batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    batchNumber: text('batch_number').notNull().unique(),
    season: text(),
    batchType: text('batch_type').notNull(),
    status: text().notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('batches_type_check', sql`${t.batchType} IN ('primary','secondary','blended')`),
    check('batches_status_check', sql`${t.status} IN ('open','closed','exported','cancelled')`),
    index('idx_batches_active_by_coop')
      .on(t.cooperativeId, t.season)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const purchases = traceabilitySchema.table(
  'purchases',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    parcelId: text('parcel_id').references(() => parcels.id, { onDelete: 'set null' }),
    purchaseLevel: text('purchase_level').notNull(),
    purchaseDate: date('purchase_date').notNull(),
    quantityKg: numeric('quantity_kg', { precision: 12, scale: 3 }).notNull(),
    qualityGrade: text('quality_grade'),
    pricePerKg: numeric('price_per_kg', { precision: 12, scale: 4 }),
    sourceSubmissionUuid: text('source_submission_uuid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('purchases_level_check', sql`${t.purchaseLevel} IN ('primary','secondary')`),
    index('idx_purchases_active_by_farmer')
      .on(t.farmerId, t.purchaseDate)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const batchItems = traceabilitySchema.table(
  'batch_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('batch_items_uk').on(t.batchId, t.purchaseId)],
);

export const traceLinks = traceabilitySchema.table(
  'trace_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    parcelId: text('parcel_id').references(() => parcels.id, { onDelete: 'set null' }),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('trace_links_uk').on(t.batchId, t.purchaseId, t.farmerId, t.parcelId)],
);

export const batchesRelations = relations(batches, ({ many, one }) => ({
  cooperative: one(cooperatives, {
    fields: [batches.cooperativeId],
    references: [cooperatives.id],
  }),
  items: many(batchItems),
  traces: many(traceLinks),
}));
