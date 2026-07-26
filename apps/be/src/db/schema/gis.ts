/**
 * GIS schema — parcels, geometries, EUDR status, overlaps.
 * Mirrors `gis.*` tables from migrations 005, 011, 013.
 */

import { relations, sql } from 'drizzle-orm';
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
import { geometry } from './_types';
import { farmers } from './farmer';
import { cooperatives, users } from './iam';

export const gisSchema = pgSchema('gis');

export const geoImportJobs = gisSchema.table(
  'geo_import_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceFormat: text('source_format').notNull(),
    sourceFileName: text('source_file_name'),
    status: text().notNull().default('pending'),
    processedCount: integer('processed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'gij_source_check',
      sql`${t.sourceFormat} IN ('geojson','kml','kmz','shapefile','manual','qgis')`,
    ),
    check('gij_status_check', sql`${t.status} IN ('pending','processing','completed','failed')`),
  ],
);

export const parcels = gisSchema.table(
  'parcels',
  {
    // PK is the source-system Field ID (text, e.g. "AS-AK001F1"). The
    // Farmer Dataset 2025-2026 namespaces every field code with its
    // cooperative + farmer prefix, so codes are globally unique
    // without an extra UUID surrogate. See migration 0022.
    id: text().primaryKey(),
    farmerId: text('farmer_id')
      .notNull()
      .references(() => farmers.id, { onDelete: 'restrict' }),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'restrict' }),
    parcelName: text('parcel_name'),
    parcelStatus: text('parcel_status').notNull().default('active'),
    cropType: text('crop_type'),
    // Kobo Form 5a `cocoa_variety` — Hybrid / Amazon / Amelonado / Other.
    cocoaVariety: text('cocoa_variety'),
    // Kobo `tree_spacing` — free-form, e.g. "3m x 3m".
    treeSpacing: text('tree_spacing'),
    // Calendar-precise planting date when known; year-only data
    // lands as YYYY-01-01. Tree age + EUDR cutoff queries derive
    // from this rather than storing them as separate columns.
    plantingDate: date('planting_date'),
    // Kobo `cocoa_tree_count`. Cocoa-specific name avoids ambiguity
    // with shade trees (counted in `parcel_characteristics`).
    cocoaTreeCount: integer('cocoa_tree_count'),
    calculatedAreaHa: numeric('calculated_area_ha', { precision: 10, scale: 4 }),
    // Kobo `nearby_feature_type` — Road / River / Hamlet /
    // Forest Reserve / Other. EUDR proximity-risk input.
    nearbyFeatureType: text('nearby_feature_type'),
    // Kobo `willing_to_rehabilitate` — Yes/No question on whether
    // the farmer is willing to rehabilitate the plot. NULL = not
    // asked yet.
    willingToRehabilitate: boolean('willing_to_rehabilitate'),
    // Kobo `land_ownership_type` — Owned / Family / Sharecropped /
    // Leased / Communal / Other.
    landOwnershipType: text('land_ownership_type'),
    // Parcel-level shade tree survival, mirrored from
    // shade.survival_checks after each shade_trees sync. NULL when
    // no tree profiles exist for this parcel.
    shadeSurvivalPct: numeric('shade_survival_pct', { precision: 5, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('parcels_status_check', sql`${t.parcelStatus} IN ('active','inactive','archived')`),
    check(
      'parcels_cocoa_variety_check',
      sql`${t.cocoaVariety} IS NULL OR ${t.cocoaVariety} IN ('hybrid','amazon','amelonado','other')`,
    ),
    check(
      'parcels_nearby_feature_check',
      sql`${t.nearbyFeatureType} IS NULL OR ${t.nearbyFeatureType} IN ('road','river','hamlet','forest_reserve','other')`,
    ),
    check(
      'parcels_ownership_check',
      sql`${t.landOwnershipType} IS NULL OR ${t.landOwnershipType} IN ('owned','family','sharecropped','leased','communal','other')`,
    ),
    check(
      'parcels_cocoa_tree_count_check',
      sql`${t.cocoaTreeCount} IS NULL OR ${t.cocoaTreeCount} >= 0`,
    ),
    index('idx_parcels_active_by_farmer').on(t.farmerId).where(sql`${t.deletedAt} IS NULL`),
    // The parcel list always filters by the active coop (`cooperative_id
    // = ? AND deleted_at IS NULL`) — mirror the farmers' tenant index so
    // that scan is index-backed instead of a seq scan on ~4K rows.
    index('idx_parcels_active_by_coop').on(t.cooperativeId).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const parcelGeometries = gisSchema.table('parcel_geometries', {
  id: uuid().primaryKey().defaultRandom(),
  parcelId: text('parcel_id')
    .notNull()
    .unique()
    .references(() => parcels.id, { onDelete: 'cascade' }),
  importJobId: uuid('import_job_id').references(() => geoImportJobs.id, {
    onDelete: 'set null',
  }),
  sourceFormat: text('source_format'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  // Perimeter walk — Kobo Form 5e `farm_boundary_polygon` (geotrace).
  geom: geometry('geom', { type: 'MultiPolygon', srid: 4326 }),
  // Single GPS waypoint — Kobo Form 5e `farm_gps_point` (accuracy ≤ 5m).
  // EUDR mandates a plot geolocation even when the polygon walk
  // isn't done; this column preserves the surveyor's pin-drop.
  pointGeom: geometry('point_geom', { type: 'Point', srid: 4326 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Shared EUDR risk zones — deforestation patches + protected-area
 * boundaries drawn on the parcel map (red overlays). Stored once in
 * their own table (not per-parcel) so a zone near several plots is
 * referenced by spatial proximity rather than duplicated. Seeded from
 * the parcels flagged with an EUDR risk; the Farm detail map returns the
 * zones within a short radius of the viewed parcel.
 */
export const riskZones = gisSchema.table('risk_zones', {
  id: uuid().primaryKey().defaultRandom(),
  // Deterministic key (e.g. "<parcelId>:deforestation") for idempotent seeding.
  code: text().notNull().unique(),
  riskType: text('risk_type').notNull(), // 'deforestation' | 'protected_area'
  severity: text().notNull(), // 'medium' | 'high'
  name: text(),
  // Provenance: the parcel whose EUDR risk generated the zone (nullable).
  sourceParcelId: text('source_parcel_id'),
  geom: geometry('geom', { type: 'MultiPolygon', srid: 4326 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const parcelCharacteristics = gisSchema.table(
  'parcel_characteristics',
  {
    id: uuid().primaryKey().defaultRandom(),
    parcelId: text('parcel_id')
      .notNull()
      .unique()
      .references(() => parcels.id, { onDelete: 'cascade' }),
    soilType: text('soil_type'),
    irrigationType: text('irrigation_type'),
    // Kobo Form 5b shade-tree breakdown. The old single
    // `shade_tree_count` is replaced by life-stage counts +
    // species text + arrangement multi-select + seedling source.
    // Year-cutoff queries ("planted before 2010", "planted since
    // 2020 EUDR cutoff") are derived in reports / API, not stored
    // as separate columns.
    shadeTreesTotal: integer('shade_trees_total'),
    shadeTreeSpecies: text('shade_tree_species'),
    shadeTreeSeedlings: integer('shade_tree_seedlings'),
    shadeTreesYoung: integer('shade_trees_young'),
    shadeTreesMatured: integer('shade_trees_matured'),
    // Multi-select stored as PG text[] — queryable via `@>` / `&&`.
    // Closed options enforced at API layer (not at DB) so a new
    // Kobo arrangement type doesn't require a migration.
    shadeTreeArrangement: text('shade_tree_arrangement').array(),
    shadeTreeSeedlingSource: text('shade_tree_seedling_source'),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'shade_trees_total_check',
      sql`${t.shadeTreesTotal} IS NULL OR ${t.shadeTreesTotal} >= 0`,
    ),
    check(
      'shade_tree_seedlings_check',
      sql`${t.shadeTreeSeedlings} IS NULL OR ${t.shadeTreeSeedlings} >= 0`,
    ),
    check(
      'shade_trees_young_check',
      sql`${t.shadeTreesYoung} IS NULL OR ${t.shadeTreesYoung} >= 0`,
    ),
    check(
      'shade_trees_matured_check',
      sql`${t.shadeTreesMatured} IS NULL OR ${t.shadeTreesMatured} >= 0`,
    ),
  ],
);

export const parcelOverlapFlags = gisSchema.table(
  'parcel_overlap_flags',
  {
    id: uuid().primaryKey().defaultRandom(),
    parcelId: text('parcel_id')
      .notNull()
      .references(() => parcels.id, { onDelete: 'cascade' }),
    nearbyParcelId: text('nearby_parcel_id')
      .notNull()
      .references(() => parcels.id, { onDelete: 'cascade' }),
    distanceMeters: numeric('distance_meters', { precision: 10, scale: 2 }),
    status: text().notNull().default('flagged'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('overlap_status_check', sql`${t.status} IN ('flagged','reviewed','dismissed')`),
    uniqueIndex('overlap_parcels_uk').on(t.parcelId, t.nearbyParcelId),
  ],
);

export const eudrStatus = gisSchema.table(
  'eudr_status',
  {
    id: uuid().primaryKey().defaultRandom(),
    parcelId: text('parcel_id')
      .notNull()
      .unique()
      .references(() => parcels.id, { onDelete: 'cascade' }),
    status: text().notNull().default('unknown'),
    assessedAt: timestamp('assessed_at', { withTimezone: true }),
    assessedBy: text('assessed_by'),
    baselineDataset: text('baseline_dataset'),
    qgisJobRef: text('qgis_job_ref'),
    notes: text(),
    // FK to reference.eudr_country_risk added in migration 011.
    countryRiskId: uuid('country_risk_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Additive EUDR Assessment Fields (from Rainforest Alliance)
    overlap: text('overlap'),
    onLand: text('on_land'),
    inCountry: text('in_country'),
    deforestationRisk: text('deforestation_risk'),
    protectedAreaRisk: text('protected_area_risk'),
    eudrData: text('eudr_data'),
    eudrExplanation: text('eudr_explanation'),
  },
  (t) => [
    check(
      'eudr_status_check',
      sql`${t.status} IN ('unknown','compliant','non_compliant','needs_review')`,
    ),
  ],
);

export const parcelsRelations = relations(parcels, ({ one, many }) => ({
  farmer: one(farmers, { fields: [parcels.farmerId], references: [farmers.id] }),
  cooperative: one(cooperatives, {
    fields: [parcels.cooperativeId],
    references: [cooperatives.id],
  }),
  geometry: one(parcelGeometries),
  characteristics: one(parcelCharacteristics),
  eudr: one(eudrStatus),
  overlaps: many(parcelOverlapFlags),
}));
