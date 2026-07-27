/**
 * Parcels — request/response schemas.
 *
 * BE-only Zod shapes wrapping the shared validators with OpenAPI
 * metadata. Mirrors `apps/be/src/features/farmers/schemas.ts`.
 */

import { z } from '@hono/zod-openapi';
import { createParcelSchema, listParcelsQuerySchema, updateParcelSchema } from '@thinkcocoa/shared';

// ── Response schemas ─────────────────────────────────────────
export const parcelCoreSchema = z
  .object({
    id: z.string(),
    cooperativeId: z.string().uuid(),
    cooperativeCode: z.string(),
    cooperativeName: z.string(),
    districtName: z.string().nullable(),
    farmerId: z.string(),
    farmerFullName: z.string(),
    parcelName: z.string().nullable(),
    parcelStatus: z.string(),
    cropType: z.string().nullable(),
    cocoaVariety: z.string().nullable(),
    treeSpacing: z.string().nullable(),
    plantingDate: z.string().nullable(),
    cocoaTreeCount: z.number().int().nullable(),
    calculatedAreaHa: z.number().nullable(),
    nearbyFeatureType: z.string().nullable(),
    willingToRehabilitate: z.boolean().nullable(),
    landOwnershipType: z.string().nullable(),
    /** Joined from `gis.eudr_status.status` — `compliant`,
     *  `non_compliant`, `needs_review`, `unknown`, or `null` when
     *  there's no EUDR row yet. */
    eudrStatus: z.string().nullable(),
    /** The three EUDR verdicts, flattened out of the assessment so the
     *  LIST can badge and filter them without shipping the whole block. */
    deforestationRisk: z.string().nullable(),
    protectedAreaRisk: z.string().nullable(),
    overlap: z.string().nullable(),
    /** Full EUDR assessment fields (detail endpoint). Null when the
     *  parcel has no `gis.eudr_status` row; omitted on list responses. */
    eudr: z
      .object({
        overlap: z.string().nullable(),
        onLand: z.string().nullable(),
        inCountry: z.string().nullable(),
        deforestationRisk: z.string().nullable(),
        protectedAreaRisk: z.string().nullable(),
        data: z.string().nullable(),
        explanation: z.string().nullable(),
        assessedAt: z.string().nullable(),
        assessedBy: z.string().nullable(),
        notes: z.string().nullable(),
      })
      .nullable()
      .optional(),
    /** Shade-tree survival % mirrored from `shade.survival_checks`
     *  (see 0052). Null when the parcel has no shade tree profiles. */
    shadeSurvivalPct: z.number().nullable(),
    /** Total shade tree profiles recorded on this parcel. 0 when none. */
    shadeTreeCount: z.number().int(),
    /** Outstanding corrective actions aggregated across this parcel's
     *  inspections. 0 when none (or on the detail endpoint). */
    correctiveActions: z.number().int().default(0),
    geojson: z.any().nullable().optional(),
    // GeoJSON FeatureCollection of EUDR risk zones near this parcel
    // (red map overlays). Only populated on the detail endpoint.
    riskZones: z.any().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .openapi('Parcel');

export const parcelDetailSchema = parcelCoreSchema.openapi('ParcelDetail');

export const createParcelBody = createParcelSchema.openapi('CreateParcelBody');
export const updateParcelBody = updateParcelSchema.openapi('UpdateParcelBody');
export const listParcelsQuery = listParcelsQuerySchema;

export const parcelListResponseSchema = z.object({
  items: z.array(parcelCoreSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const errorResponse = z.object({ error: z.string() }).openapi('ErrorResponse');

// ── Stats ────────────────────────────────────────────────────
export const parcelStatsSchema = z
  .object({
    total: z.number().int(),
    mapped: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    archived: z.number().int(),
    deleted: z.number().int(),
    eudr: z.object({
      compliant: z.number().int(),
      needs_review: z.number().int(),
      non_compliant: z.number().int(),
      unknown: z.number().int(),
    }),
  })
  .openapi('ParcelStats');
