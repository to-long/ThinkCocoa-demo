/**
 * Primary Evacuation schema — `primary_evacuation.*` tables.
 *
 * JSONB-first mirror of `purchase.cocoa_purchases`. Two tables:
 *   • `lots`          — 1 row per Kobo primary_evacuation_depot submission
 *   • `lot_purchases` — child rows linking each lot to N source purchases
 *
 * Source-of-truth DDL: `0034_primary_evacuation_schema.sql`. Not
 * re-exported from `schema/index.ts` (same convention as
 * coaching/training/purchase) — import directly:
 *
 *   import { primaryEvacLots } from '../../db/schema/primary-evacuation';
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
import { cocoaPurchases } from './purchase';

export const primaryEvacuationSchema = pgSchema('primary_evacuation');

export const primaryEvacLots = primaryEvacuationSchema.table(
  'lots',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    primaryWaybillNumber: text('primary_waybill_number').notNull(),

    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),

    // Station / PC level (denorm copies)
    stationMarkNumber: text('station_mark_number'),
    pcName: text('pc_name'),
    society: text(),
    districtDepot: text('district_depot'),

    // Destination
    districtWarehouse: text('district_warehouse').notNull(),

    // Receipt
    evacuationDate: date('evacuation_date').notNull(),
    bagsReceived: integer('bags_received').notNull(),
    kgReceived: numeric('kg_received', { precision: 11, scale: 1 }).notNull(),

    // Driver
    driverFirstName: text('driver_first_name'),
    driverLastName: text('driver_last_name'),
    truckRegistration: text('truck_registration'),
    sealNumber: text('seal_number'),

    lotPhotoUrl: text('lot_photo_url'),


    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('primary_evac_lots_kobo_uuid_uk').on(t.koboUuid),
    check('primary_evac_lots_bags_check', sql`${t.bagsReceived} > 0`),
    check('primary_evac_lots_kg_check', sql`${t.kgReceived} > 0`),
    index('primary_evac_lots_evac_date_idx').on(t.evacuationDate.desc()),
    index('primary_evac_lots_cooperative_date_idx').on(t.cooperativeId, t.evacuationDate.desc()),
    index('primary_evac_lots_station_date_idx').on(t.stationMarkNumber, t.evacuationDate.desc()),
    index('primary_evac_lots_warehouse_date_idx').on(t.districtWarehouse, t.evacuationDate.desc()),
    index('primary_evac_lots_waybill_idx').on(t.primaryWaybillNumber),
  ],
);

export const primaryEvacLotPurchases = primaryEvacuationSchema.table(
  'lot_purchases',
  {
    id: uuid().primaryKey().defaultRandom(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => primaryEvacLots.id, { onDelete: 'cascade' }),
    purchaseIdRaw: text('purchase_id_raw').notNull(),
    purchaseId: uuid('purchase_id').references(() => cocoaPurchases.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('primary_evac_lot_purchases_lot_pid_uk').on(t.lotId, t.purchaseIdRaw),
    index('primary_evac_lot_purchases_lot_idx').on(t.lotId),
  ],
);
