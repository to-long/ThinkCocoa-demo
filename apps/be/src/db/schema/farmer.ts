/**
 * Farmer schema — farmer profiles, household, photos, change history.
 * Mirrors `farmer.*` tables from migrations 003, 013, 018, 019.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cooperatives, users } from './iam';

export const farmerSchema = pgSchema('farmer');

export const farmers = farmerSchema.table(
  'farmers',
  {
    // PK is the source-system ProducerID (e.g. "AS-AK001WP009"). The
    // 2025-2026 dataset already namespaces every ID with its
    // cooperative prefix, so codes are globally unique without an
    // extra `(coop, code)` composite. See migration 0019.
    id: text().primaryKey(),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    externalSource: text('external_source'),
    /** Producer ID from the source system (Demo Cocoa CSV import / Kobo
     *  `Member/producerId`). Same value as `id` for new rows seeded
     *  from the 2025-2026 CSV; kept as a separate column for Kobo
     *  sync, which still matches on this field by name. */
    producerId: text('producer_id'),
    /** Kobo submission `_id` for farmers ingested via `farmer_registration`
     *  sync. NULL for CSV-imported / manually-created rows. Used by the
     *  sync "delete unsynced" prune to identify Kobo-sourced rows whose
     *  submission was removed on Kobo. */
    koboId: bigint('kobo_id', { mode: 'number' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    otherNames: text('other_names'),
    sex: text(),
    dateOfBirth: date('date_of_birth'),
    phoneNumber: text('phone_number'),
    // FE label is "National ID"; column stays country-agnostic.
    nationalIdNumber: text('national_id_number'),
    // Type of government ID document (e.g. "National ID",
    // "Voter ID"). Demo Cocoa CSVs surface type but not number; admin fills
    // in the actual number later.
    nationalIdType: text('national_id_type'),
    // CSV `HHAssessed` — has the household been assessed yet? Boolean
    // (nullable for "not asked"). The CSV column is mostly blank in
    // the current dataset so most rows land NULL.
    hhAssessed: boolean('hh_assessed'),
    // Rainforest Alliance "Society" — the cooperative-internal
    // grouping that Annex S13 reports against. CSV column `Society`.
    // (Renamed from the Demo Cocoa-era `section` in migration 0020.)
    society: text(),
    // Tri-state (true/false/null). GDPR-style opt-in collected at
    // registration — null means "not asked yet", not "refused".
    dataCollectionConsent: boolean('data_collection_consent'),
    certificationStatus: text('certification_status').notNull().default('unknown'),
    // Rainforest Alliance certificate details (migration 0010). On the
    // farmer because RA certifies the producer through the group — one
    // certificate covers every plot that producer farms.
    raCertificateNumber: text('ra_certificate_number'),
    raAuditDate: date('ra_audit_date'),
    raExpiryDate: date('ra_expiry_date'),
    raCertifyingBody: text('ra_certifying_body'),
    // FE label is "Date of Membership".
    registrationDate: date('registration_date'),
    householdSize: smallint('household_size'),
    childrenCount: smallint('children_count'),
    // Farmer-level shade tree survival — arithmetic mean across the
    // farmer's parcels' shade_survival_pct (skipping parcels with no
    // shade trees). Sole writer is the shade-trees parser (0052). NULL
    // when the farmer has no shade tree profiles yet.
    shadeSurvivalPct: numeric('shade_survival_pct', { precision: 5, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('farmers_sex_check', sql`${t.sex} IN ('male','female','other','unknown')`),
    check('farmers_household_size_check', sql`${t.householdSize} >= 0`),
    check('farmers_children_count_check', sql`${t.childrenCount} >= 0`),
    index('idx_farmer_farmers_cooperative_id').on(t.cooperativeId),
    index('idx_farmer_farmers_active').on(t.isActive),
    index('idx_farmers_active_by_coop').on(t.cooperativeId).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const householdMembers = farmerSchema.table(
  'household_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    relationshipToFarmer: text('relationship_to_farmer'),
    sex: text(),
    dateOfBirth: date('date_of_birth'),
    phoneNumber: text('phone_number'),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('household_members_sex_check', sql`${t.sex} IN ('male','female','other','unknown')`),
    index('idx_household_members_farmer').on(t.farmerId),
  ],
);

export const farmerPhotos = farmerSchema.table('farmer_photos', {
  id: uuid().primaryKey().defaultRandom(),
  farmerId: text('farmer_id')
    .notNull()
    .references(() => farmers.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const profileChangeHistory = farmerSchema.table('profile_change_history', {
  id: uuid().primaryKey().defaultRandom(),
  farmerId: text('farmer_id')
    .notNull()
    .references(() => farmers.id, { onDelete: 'cascade' }),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  fieldName: text('field_name').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const farmersRelations = relations(farmers, ({ many, one }) => ({
  cooperative: one(cooperatives, {
    fields: [farmers.cooperativeId],
    references: [cooperatives.id],
  }),
  householdMembers: many(householdMembers),
  photos: many(farmerPhotos),
  changeHistory: many(profileChangeHistory),
}));
