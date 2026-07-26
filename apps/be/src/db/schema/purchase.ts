/**
 * Purchase schema — `purchase.*` tables.
 *
 * JSONB-first mirror of `coaching.coaching_visits`: the full Kobo
 * `cocoa_purchases_society` submission lands in `raw_data`, and a
 * thin set of denormalised columns powers the list page filters and
 * the KPI strip (district, society, payment_type rollups). FK columns
 * are nullable so an orphan (unknown station mark / farmer / plot)
 * still ingests — the FE flags it.
 *
 * Source-of-truth DDL: `0032_purchase_schema.sql`. NOT re-exported
 * from `schema/index.ts` because barrel exports caused name
 * collisions for coaching/training earlier (see schema/index.ts
 * comment); imports should be by direct path:
 *
 *   import { cocoaPurchases } from '../../db/schema/purchase';
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { farmers } from './farmer';
import { parcels } from './gis';
import { cooperatives } from './iam';

export const purchaseSchema = pgSchema('purchase');

export const cocoaPurchases = purchaseSchema.table(
  'cocoa_purchases',
  {
    id: uuid().primaryKey().defaultRandom(),

    // Kobo source metadata
    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    // Display PK from Kobo (`<plot>-YYMMDD`); not unique on its own.
    purchaseId: text('purchase_id').notNull(),

    // FKs — nullable for orphan tolerance.
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    farmerId: text('farmer_id').references(() => farmers.id),
    parcelId: text('parcel_id').references(() => parcels.id),

    // Station / PC level
    stationMarkNumber: text('station_mark_number'),
    pcName: text('pc_name'),
    society: text(),
    district: text(),

    // Farmer level
    farmerCode: text('farmer_code').notNull(),
    farmerName: text('farmer_name'),
    cocobodCardNumber: text('cocobod_card_number'),
    fieldId: text('field_id'),

    // Transaction
    purchaseDate: date('purchase_date').notNull(),
    weightKg: numeric('weight_kg', { precision: 10, scale: 3 }).notNull(),
    amountReceivedGhs: numeric('amount_received_ghs', { precision: 12, scale: 2 }).notNull(),
    paymentType: text('payment_type').notNull(),
    paymentReference: text('payment_reference'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cocoa_purchases_kobo_uuid_uk').on(t.koboUuid),
    check(
      'cocoa_purchases_payment_type_check',
      sql`${t.paymentType} IN ('cash', 'mobile_money', 'cheque', 'card')`,
    ),
    check('cocoa_purchases_weight_check', sql`${t.weightKg} > 0`),
    check('cocoa_purchases_amount_check', sql`${t.amountReceivedGhs} >= 0`),
    index('cocoa_purchases_purchase_date_idx').on(t.purchaseDate.desc()),
    index('cocoa_purchases_cooperative_date_idx').on(t.cooperativeId, t.purchaseDate.desc()),
    index('cocoa_purchases_station_date_idx').on(t.stationMarkNumber, t.purchaseDate.desc()),
    index('cocoa_purchases_payment_type_idx').on(t.paymentType),
    index('cocoa_purchases_purchase_id_idx').on(t.purchaseId),
    index('cocoa_purchases_parcel_idx').on(t.parcelId),
  ],
);
