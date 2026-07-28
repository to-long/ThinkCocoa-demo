/**
 * Inspection schema — `inspection.*` tables.
 *
 * Pure JSONB-first model: every Kobo submission lands as one row in
 * `inspection.inspections` with the entire payload in `raw_data`,
 * plus a thin set of denormalized columns the list/detail pages
 * filter and sort by (date, farmer, parcel, EUDR flags, compliance
 * pct). Attachments (photos + signatures) get their own table so
 * the lazy "mirror to Spaces" maintenance job can iterate them.
 *
 * See migration `0023_inspection_schema.sql` for the source-of-truth
 * DDL — this file mirrors it for drizzle queries.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coachingVisits } from './coaching';
import { farmers } from './farmer';
import { parcels } from './gis';
import { cooperatives } from './iam';

export const inspectionSchema = pgSchema('inspection');

export const inspections = inspectionSchema.table(
  'inspections',
  {
    // Use Kobo's `_id` (stable, globally-unique integer per
    // submission) directly as the PK. Migration 0024 dropped the
    // previous auto-generated uuid + separate `kobo_id` column.
    // URLs become /inspections/757860568 — cleaner than uuids.
    id: bigint('id', { mode: 'number' }).primaryKey(),

    // Kobo `_uuid` — kept as a UNIQUE side-key so legacy reads /
    // cross-references (e.g. snapshot filenames) still work.
    koboUuid: text('kobo_uuid').notNull(),
    formVersion: text('form_version').notNull(),

    // FK columns (nullable for orphan inspections)
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    farmerId: text('farmer_id').references(() => farmers.id),
    parcelId: text('parcel_id').references(() => parcels.id),
    dateInspection: date('date_inspection').notNull(),
    inspectorCode: text('inspector_code'),

    // EUDR
    eudrStatus: text('eudr_status'),
    eudrScore: smallint('eudr_score'),
    eudrNoDeforestation: boolean('eudr_no_deforestation'),
    eudrNoForestConversion: boolean('eudr_no_forest_conversion'),
    eudrOutsideHcva: boolean('eudr_outside_hcva'),
    eudrLegalRights: boolean('eudr_legal_rights'),
    eudrAssessedAt: timestamp('eudr_assessed_at', { withTimezone: true }),

    // Compliance (RA score)
    complianceScore: smallint('compliance_score'),
    complianceMax: smallint('compliance_max'),
    compliancePct: numeric('compliance_pct', { precision: 5, scale: 2 }),

    // Certification grading — derived at sync time from compliance_pct
    // + farmer.registration_date via cocoa-season math (see
    // `apps/be/src/features/inspections/grading.ts`).
    programYear: smallint('program_year'),
    certificationOutcome: text('certification_outcome'),

    // ── Structured detail (formerly in raw_data) ──────────────────
    // Farmer snapshot at inspection time.
    farmerDob: text('farmer_dob'),
    farmerGender: text('farmer_gender'),
    ghanaCard: text('ghana_card'),
    cocobodCard: text('cocobod_card'),
    householdSize: smallint('household_size'),
    childrenCount: smallint('children_count'),
    clmrsAssessed: boolean('clmrs_assessed'),
    // Parcel snapshot.
    fieldSizeHa: numeric('field_size_ha', { precision: 10, scale: 4 }),
    yearEstablished: smallint('year_established'),
    farmMapped: boolean('farm_mapped'),
    gpsLocation: text('gps_location'),
    permanentStaff: smallint('permanent_staff'),
    temporaryStaff: smallint('temporary_staff'),
    // Traceability figures (kg).
    totalHarvestKg: numeric('total_harvest_kg', { precision: 12, scale: 2 }),
    totalSoldKg: numeric('total_sold_kg', { precision: 12, scale: 2 }),
    nextSeasonEstimateKg: numeric('next_season_estimate_kg', { precision: 12, scale: 2 }),
    anotherLbc: boolean('another_lbc'),
    anotherLbcReason: text('another_lbc_reason'),
    // Training + RA-critical social flags ('0' fail | '1' partial | '2' pass).
    trainingTopics: text('training_topics'),
    raChildLabour: text('ra_child_labour'),
    raForcedLabour: text('ra_forced_labour'),
    raDiscrimination: text('ra_discrimination'),
    raAbuse: text('ra_abuse'),

    // Submission metadata (source-agnostic).
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by'),
    snapshotUrl: text('snapshot_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inspections_kobo_uuid_uk').on(t.koboUuid),
    // (no separate kobo_id index — `id` IS the kobo_id now)
    check(
      'inspections_eudr_status_check',
      sql`${t.eudrStatus} IS NULL OR ${t.eudrStatus} IN ('unknown','compliant','non_compliant','needs_review')`,
    ),
    check(
      'inspections_certification_outcome_check',
      sql`${t.certificationOutcome} IS NULL OR ${t.certificationOutcome} IN ('certified','certified_with_ca','not_certified','disqualified')`,
    ),
    check(
      'inspections_program_year_check',
      sql`${t.programYear} IS NULL OR (${t.programYear} >= 1 AND ${t.programYear} <= 5)`,
    ),
    index('idx_inspections_farmer_date').on(t.farmerId, t.dateInspection.desc()),
    index('idx_inspections_parcel_date').on(t.parcelId, t.dateInspection.desc()),
    index('idx_inspections_coop_date').on(t.cooperativeId, t.dateInspection.desc()),
    index('idx_inspections_compliance_pct').on(t.compliancePct.desc()),
    index('idx_inspections_eudr_status').on(t.eudrStatus),
  ],
);

export const inspectionAttachments = inspectionSchema.table(
  'attachments',
  {
    id: uuid().primaryKey().defaultRandom(),
    inspectionId: bigint('inspection_id', { mode: 'number' })
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    koboUid: text('kobo_uid').notNull(),
    questionXpath: text('question_xpath').notNull(),
    filename: text(),
    mimetype: text(),
    koboUrl: text('kobo_url'),
    spacesUrl: text('spaces_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attachments_kobo_uid_uk').on(t.koboUid),
    index('idx_attachments_inspection').on(t.inspectionId),
  ],
);

// Corrective-action follow-ups — one row per flagged topic on an
// inspection (parsed from `raw_data` at sync time). Split out of the
// JSONB so the mutable `status` (open → processing → done, plus
// reopen) survives re-syncs and list counts become indexed lookups.
export const correctiveActions = inspectionSchema.table(
  'corrective_actions',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Source of the action. 'inspection' → inspection_id set; 'coaching'
    // → coaching_visit_id set (exactly one, enforced by a XOR check).
    source: text('source').notNull().default('inspection'),
    inspectionId: bigint('inspection_id', { mode: 'number' }).references(() => inspections.id, {
      onDelete: 'cascade',
    }),
    coachingVisitId: uuid('coaching_visit_id').references(() => coachingVisits.id, {
      onDelete: 'cascade',
    }),
    // Denormalized from the parent record — powers the indexed
    // not-done counts on the farmer / parcel / inspection lists.
    farmerId: text('farmer_id').references(() => farmers.id),
    parcelId: text('parcel_id').references(() => parcels.id),
    cooperativeId: uuid('cooperative_id').references(() => cooperatives.id),
    dateInspection: date('date_inspection'),
    // Inspection: one of the 8 form topics. Coaching: the non-compliance
    // type code (see shared NON_COMPLIANCE_TYPES).
    topic: text('topic').notNull(),
    action: text('action').notNull(),
    // Deadline to resolve the action.
    actionDate: date('action_date'),
    // Mutable user state — NOT overwritten on re-sync.
    status: text('status').notNull().default('open'),
    // Closing note captured when the action is marked done — the final
    // situation on the ground. Preserved across reopen.
    lastComment: text('last_comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('corrective_actions_inspection_topic_uk').on(t.inspectionId, t.topic),
    uniqueIndex('corrective_actions_coaching_topic_uk')
      .on(t.coachingVisitId, t.topic)
      .where(sql`${t.coachingVisitId} IS NOT NULL`),
    check(
      'corrective_actions_status_check',
      sql`${t.status} IN ('open','reopen','processing','done')`,
    ),
    check('corrective_actions_source_check', sql`${t.source} IN ('inspection','coaching')`),
    check(
      'corrective_actions_one_source_check',
      sql`num_nonnulls(${t.inspectionId}, ${t.coachingVisitId}) = 1`,
    ),
    // Partial indexes — the farmer/parcel/inspection lists only ever count
    // NOT-done actions (`status <> 'done'`). Scoping the index to that
    // predicate keeps it small and turns the count subqueries into
    // index-only scans (no heap visit for `status`).
    index('idx_corrective_actions_farmer_open').on(t.farmerId).where(sql`${t.status} <> 'done'`),
    index('idx_corrective_actions_parcel_open').on(t.parcelId).where(sql`${t.status} <> 'done'`),
    index('idx_corrective_actions_coaching_open')
      .on(t.coachingVisitId)
      .where(sql`${t.status} <> 'done'`),
    index('idx_corrective_actions_coop').on(t.cooperativeId),
  ],
);

export const inspectionsRelations = relations(inspections, ({ one, many }) => ({
  cooperative: one(cooperatives, {
    fields: [inspections.cooperativeId],
    references: [cooperatives.id],
  }),
  farmer: one(farmers, { fields: [inspections.farmerId], references: [farmers.id] }),
  parcel: one(parcels, { fields: [inspections.parcelId], references: [parcels.id] }),
  attachments: many(inspectionAttachments),
  correctiveActions: many(correctiveActions),
}));

export const correctiveActionsRelations = relations(correctiveActions, ({ one }) => ({
  inspection: one(inspections, {
    fields: [correctiveActions.inspectionId],
    references: [inspections.id],
  }),
  coachingVisit: one(coachingVisits, {
    fields: [correctiveActions.coachingVisitId],
    references: [coachingVisits.id],
  }),
}));

export const inspectionAttachmentsRelations = relations(inspectionAttachments, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionAttachments.inspectionId],
    references: [inspections.id],
  }),
}));
