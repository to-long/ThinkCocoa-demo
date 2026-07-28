/**
 * Secondary Evacuation schema — `secondary_evacuation.*` tables.
 *
 * JSONB-first mirror of `primary_evacuation.lots`. Two tables:
 *   • `lots`          — 1 row per Kobo secondary_evacuation_port submission
 *                       (depot → port shipment, the final lot before export)
 *   • `lot_primaries` — child rows linking each secondary lot to N
 *                       contributing primary lots
 *
 * Source-of-truth DDL: `0036_secondary_evacuation_schema.sql`. Not
 * re-exported from `schema/index.ts` — import directly.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives } from './iam';
import { primaryEvacLots } from './primary-evacuation';

export const secondaryEvacuationSchema = pgSchema('secondary_evacuation');

export const secondaryEvacLots = secondaryEvacuationSchema.table(
  'lots',
  {
    id: uuid().primaryKey().defaultRandom(),

    koboUuid: text('kobo_uuid').notNull(),
    koboId: bigint('kobo_id', { mode: 'number' }).notNull(),
    formVersion: text('form_version').notNull(),

    secondaryWaybillNumber: text('secondary_waybill_number').notNull(),

    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),

    // Form header
    evacuationDate: date('evacuation_date').notNull(),
    district: text().notNull(),
    depotOrigin: text('depot_origin').notNull(),
    depotGps: text('depot_gps'),

    // Lot details
    beanGrade: text('bean_grade').notNull(),
    beanCategory: text('bean_category').notNull(),
    sealNumber: text('seal_number').notNull(),
    sourcingPartner: text('sourcing_partner').notNull(),

    // Transport
    bagsLoaded: integer('bags_loaded').notNull(),
    portDestination: text('port_destination').notNull(),
    driverFirstName: text('driver_first_name'),
    driverLastName: text('driver_last_name'),
    driverLicenceNumber: text('driver_licence_number'),
    truckRegistration: text('truck_registration'),

    qccImageUrl: text('qcc_image_url'),

    // DDS submission lifecycle (EUDR endpoint).
    ddsStatus: text('dds_status').notNull().default('draft'),
    ddsReference: text('dds_reference'),
    ddsSubmittedAt: timestamp('dds_submitted_at', { withTimezone: true }),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('secondary_evac_lots_kobo_uuid_uk').on(t.koboUuid),
    check('secondary_evac_lots_bags_check', sql`${t.bagsLoaded} > 0`),
    check(
      'secondary_evac_lots_dds_status_check',
      sql`${t.ddsStatus} IN ('draft','ready','submitted','accepted','rejected','withdrawn')`,
    ),
    index('secondary_evac_lots_evac_date_idx').on(t.evacuationDate.desc()),
    index('secondary_evac_lots_cooperative_date_idx').on(t.cooperativeId, t.evacuationDate.desc()),
    index('secondary_evac_lots_depot_idx').on(t.depotOrigin, t.evacuationDate.desc()),
    index('secondary_evac_lots_port_idx').on(t.portDestination),
    index('secondary_evac_lots_partner_idx').on(t.sourcingPartner),
    index('secondary_evac_lots_waybill_idx').on(t.secondaryWaybillNumber),
  ],
);

export const secondaryEvacLotPrimaries = secondaryEvacuationSchema.table(
  'lot_primaries',
  {
    id: uuid().primaryKey().defaultRandom(),
    secondaryLotId: uuid('secondary_lot_id')
      .notNull()
      .references(() => secondaryEvacLots.id, { onDelete: 'cascade' }),
    primaryWaybillRaw: text('primary_waybill_raw').notNull(),
    primaryLotId: uuid('primary_lot_id').references(() => primaryEvacLots.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('secondary_evac_lot_primaries_uk').on(t.secondaryLotId, t.primaryWaybillRaw),
    index('secondary_evac_lot_primaries_secondary_idx').on(t.secondaryLotId),
  ],
);
