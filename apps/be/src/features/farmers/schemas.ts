/**
 * Farmers — request/response schemas.
 *
 * Pulled out of `routes.ts` so the SDK consumer side (FE) can import
 * the same Zod shape if it ever wants client-side validation, and so
 * the route handlers stay focused on HTTP wiring.
 */

import {
  createFarmerSchema,
  listFarmersQuerySchema,
  updateFarmerSchema,
} from '@cocoaimpact/shared';
import { z } from '@hono/zod-openapi';

// ── Response schemas ─────────────────────────────────────────
export const farmerCoreSchema = z
  .object({
    // `id` is the source-system ProducerID (text, e.g. "AS-AK001WP009").
    // No longer a UUID since migration 0019.
    id: z.string(),
    cooperativeId: z.string().uuid(),
    cooperativeCode: z.string(),
    cooperativeName: z.string(),
    districtName: z.string().nullable(),
    // Backward-compat alias for `id`. Same value, kept on the wire so
    // FE i18n + table-column wiring keeps working without rename.
    farmerCode: z.string(),
    externalSource: z.string().nullable(),
    producerId: z.string().nullable(),
    hhAssessed: z.boolean().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    otherNames: z.string().nullable(),
    sex: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    nationalIdNumber: z.string().nullable(),
    nationalIdType: z.string().nullable(),
    society: z.string().nullable(),
    dataCollectionConsent: z.boolean().nullable(),
    certificationStatus: z.string(),
    registrationDate: z.string().nullable(),
    householdSize: z.number().int().nullable(),
    childrenCount: z.number().int().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    // Latest inspection-derived certification. Null when the farmer
    // has no inspection rows yet.
    latestCertification: z
      .object({
        inspectionId: z.number().int(),
        dateInspection: z.string(),
        complianceScore: z.number().int().nullable(),
        compliancePct: z.number().nullable(),
        programYear: z.number().int().nullable(),
        outcome: z
          .enum(['certified', 'certified_with_ca', 'not_certified', 'disqualified'])
          .nullable(),
      })
      .nullable(),
    // Arithmetic mean of the farmer's parcels' shade_survival_pct
    // (skipping parcels with no shade trees). Null when the farmer
    // has no shade tree profiles yet.
    shadeSurvivalPct: z.number().nullable(),
    /** Outstanding (not-done) corrective actions across the farmer's
     *  inspections. 0 when none / on non-list endpoints. */
    correctiveActions: z.number().int().default(0),
  })
  .openapi('Farmer');

export const farmerDetailSchema = farmerCoreSchema.openapi('FarmerDetail');

export const createFarmerBody = createFarmerSchema.openapi('CreateFarmerBody');
export const updateFarmerBody = updateFarmerSchema.openapi('UpdateFarmerBody');
export const listFarmersQuery = listFarmersQuerySchema;

export const farmerListResponseSchema = z.object({
  items: z.array(farmerCoreSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// ── Stats schemas ────────────────────────────────────────────
// Full shape — every computed metric. The slim schema below is a strict
// subset, so one DB round-trip can satisfy both endpoints (slim just
// drops fields on the way out).
export const farmerFullStatsSchema = z
  .object({
    // Status buckets — sum to `total`.
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    deleted: z.number().int(),
    // Compliance / data-quality counts (live rows only — deleted
    // tombstones shouldn't inflate "coverage" metrics).
    raCertified: z.number().int(),
    withConsent: z.number().int(),
    withPhone: z.number().int(),
    withNationalId: z.number().int(),
    // Breakdowns — each bucket is { label, count }. Live rows only.
    byCooperative: z.array(
      z.object({ code: z.string(), name: z.string(), count: z.number().int() }),
    ),
    byDistrict: z.array(
      z.object({
        code: z.string().nullable(),
        name: z.string().nullable(),
        count: z.number().int(),
      }),
    ),
    bySociety: z.array(z.object({ society: z.string(), count: z.number().int() })),
    byTenure: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
    // Demographic breakdowns. All three can currently be 100% "unknown"
    // in fresh environments — the Demo Cocoa CSV import doesn't populate
    // these columns yet. The dashboard still renders the donuts so the
    // shape of the chart is ready when a future import (or dialog
    // entry) starts landing non-null values.
    bySex: z.array(z.object({ sex: z.string(), count: z.number().int() })),
    byHouseholdSize: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
    byChildrenCount: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
    // Certification breakdown — counts of farmers by their most-recent
    // inspection outcome. `none` = farmer has no inspection yet.
    byCertificationOutcome: z.array(
      z.object({
        outcome: z.enum([
          'certified',
          'certified_with_ca',
          'not_certified',
          'disqualified',
          'none',
        ]),
        count: z.number().int(),
      }),
    ),
  })
  .openapi('FarmerFullStats');

// Slim shape — matches the Pencil design inline on the farmer list.
// Strict subset of `farmerFullStatsSchema`: status totals, RA certified,
// data-collection consent count, tenure breakdown. No district / village
// breakdowns. `byCooperative` was dropped — list-page tenant scope is
// now ambient via the active-coop cookie, so a single-row breakdown
// chip was redundant.
export const farmerStatsSchema = z
  .object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    deleted: z.number().int(),
    raCertified: z.number().int(),
    withConsent: z.number().int(),
    byTenure: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
    byCertificationOutcome: z.array(
      z.object({
        outcome: z.enum([
          'certified',
          'certified_with_ca',
          'not_certified',
          'disqualified',
          'none',
        ]),
        count: z.number().int(),
      }),
    ),
  })
  .openapi('FarmerStats');

export type FullStatsPayload = z.infer<typeof farmerFullStatsSchema>;
export type StatsPayload = z.infer<typeof farmerStatsSchema>;

export const errorResponse = z.object({ error: z.string() }).openapi('Error');
