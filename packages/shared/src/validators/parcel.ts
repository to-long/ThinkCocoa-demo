/**
 * Parcel (Farm field) validators. Shared between BE route validation
 * and FE form resolvers (Create / Edit Farm dialogs).
 *
 * Parcels keyed by `id` (text, e.g. `AS-AK001F1` — the Kobo Field ID).
 * Cooperative is set server-side from the active-coop cookie, so the
 * create body omits it on purpose.
 */

import { z } from 'zod';
import { boundedDate, boundedInt, FIELD_LIMITS, farmerCodeSchema } from './common';
import { V } from './validator-error-code';

const optionalShortText = z.string().trim().max(FIELD_LIMITS.shortText, V.TEXT_TOO_LONG);

/**
 * GeoJSON boundary geometry accepted by the Add / Edit Farm dialog's
 * map upload. Only Polygon / MultiPolygon are meaningful for a parcel
 * boundary — points/lines are rejected. Coordinates are validated as
 * nested `[lng, lat]` positions; PostGIS `ST_GeomFromGeoJSON` is the
 * final authority server-side (rejects self-intersections etc.).
 */
const geoPosition = z.array(z.number()).min(2, V.PARCEL_GEOMETRY_INVALID);
const geoLinearRing = z.array(geoPosition).min(4, V.PARCEL_GEOMETRY_INVALID);
const geoPolygonCoords = z.array(geoLinearRing).min(1, V.PARCEL_GEOMETRY_INVALID);
export const parcelGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: geoPolygonCoords }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(geoPolygonCoords).min(1) }),
]);
export type ParcelGeometry = z.infer<typeof parcelGeometrySchema>;

/** Cocoa variety bucket — closed enum mirrored from the DB check
 *  constraint added in migration 0022 (`parcels_cocoa_variety_check`). */
const COCOA_VARIETIES = ['hybrid', 'amazon', 'amelonado', 'other'] as const;
/** Nearby feature select — EUDR proximity-risk input. */
const NEARBY_FEATURES = ['road', 'river', 'hamlet', 'forest_reserve', 'other'] as const;
/** Land ownership — closed enum. */
const LAND_OWNERSHIP = ['owned', 'family', 'sharecropped', 'leased', 'communal', 'other'] as const;
/** Parcel lifecycle status — distinct from `deleted_at` tombstone. */
const PARCEL_STATUS = ['active', 'inactive', 'archived'] as const;

const parcelBase = z.object({
  parcelName: optionalShortText.optional().nullable(),
  cropType: optionalShortText.optional().nullable(),
  cocoaVariety: z.enum(COCOA_VARIETIES).optional().nullable(),
  treeSpacing: optionalShortText.optional().nullable(),
  plantingDate: boundedDate().optional().nullable(),
  // Tree count + area are both nullable — the dialog allows manual
  // entry or "auto from map" (left blank for the upcoming geometry
  // import to populate).
  cocoaTreeCount: boundedInt(1_000_000).optional().nullable(),
  calculatedAreaHa: z
    .number()
    .gt(0, V.PARCEL_AREA_INVALID)
    .lt(10_000, V.PARCEL_AREA_INVALID)
    .optional()
    .nullable(),
  nearbyFeatureType: z.enum(NEARBY_FEATURES).optional().nullable(),
  willingToRehabilitate: z.boolean().optional().nullable(),
  landOwnershipType: z.enum(LAND_OWNERSHIP).optional().nullable(),
  parcelStatus: z.enum(PARCEL_STATUS).optional(),
  // Optional boundary uploaded via the dialog's GeoJSON map upload.
  // Persisted server-side into `gis.parcel_geometries`; when present
  // and `calculatedAreaHa` is left blank, the server derives area from
  // the polygon. Absent = geometry left unchanged.
  geometry: parcelGeometrySchema.optional().nullable(),
});

/** Full create payload — `id` (Field ID) + `farmerId` are required. */
export const createParcelSchema = parcelBase.extend({
  // Reuse the farmer-code regex (alphanumeric + dash + underscore) for
  // the Field ID — same Kobo origin, same constraints.
  id: farmerCodeSchema,
  farmerId: z.string().trim().min(1, V.PARCEL_FARMER_REQUIRED),
});

/** Update = every field optional. `id` is immutable so it stays out
 *  of the patch payload entirely (the route reads it from the URL). */
export const updateParcelSchema = parcelBase.extend({
  farmerId: z.string().trim().min(1).optional(),
});

/** List query — pagination + filters + sort. */
export const listParcelsQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  cooperativeCode: z.string().optional(),
  cropType: z.string().optional(),
  parcelStatus: z.string().optional(),
  // EUDR filter is `compliant | non_compliant | needs_review | unknown`
  // — joined from `gis.eudr_status` server-side.
  eudr: z.string().optional(),
  // Shade-survival band: healthy (≥80) | caution (60–79) |
  // warning (40–59) | danger (<40) | none (no shade profiles) —
  // bucketed server-side against `parcels.shade_survival_pct`.
  survival: z.string().optional(),
  /** The three EUDR assessment verdicts from `gis.eudr_status`, each
   *  comma-separated like the other multi-selects:
   *    deforestation  — `high` | `medium` | `low`
   *    protectedArea  — `high` | `medium` | `low`
   *    overlap        — `overlap` | `review` | `none`
   *  Separate filters because they answer different questions: a plot can
   *  sit near cleared forest without overlapping a protected boundary. */
  deforestation: z.string().optional(),
  protectedArea: z.string().optional(),
  overlap: z.string().optional(),
  /** Exact farmer-id filter — used by the farmer detail page's
   *  Parcels card to pull only the parcels owned by that farmer. */
  farmerId: z.string().optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  sort: z.string().optional(),
});

export type CreateParcelInput = z.infer<typeof createParcelSchema>;
export type UpdateParcelInput = z.infer<typeof updateParcelSchema>;
export type ListParcelsQuery = z.infer<typeof listParcelsQuerySchema>;
