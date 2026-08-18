/**
 * Cooperatives — request/response schemas + error response.
 *
 * Pulled out of `routes.ts` so the SDK consumer side (FE) can import
 * the same Zod shape if it ever wants client-side validation, and so
 * the route handlers stay focused on HTTP wiring.
 *
 * The create/update body schemas live in `@kuanadata/shared` (so the
 * FE forms reuse them); we re-export them here registered with the
 * OpenAPI generator under stable component names.
 */

import { z } from '@hono/zod-openapi';
import { createCooperativeSchema, updateCooperativeSchema } from '@kuanadata/shared';

export const cooperativeCoreSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    farmerCodePrefix: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    districtCode: z.string().nullable(),
    districtName: z.string().nullable(),
    chairUserId: z.string().uuid().nullable(),
    chairFullName: z.string().nullable(),
    chairEmail: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    address: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    /** Live (not soft-deleted) farmer count for this cooperative. */
    farmerCount: z.number().int(),
    /** Farmers with `certificationStatus = 'rainforest_alliance'`. */
    certifiedFarmerCount: z.number().int(),
    /** Farmers with `dataCollectionConsent = true`. Aggregated server-
     *  side because the detail page renders a coop-level Yes/No. */
    consentingFarmerCount: z.number().int(),
    /** Live parcel count rolled up across the cooperative's farmers. */
    parcelCount: z.number().int(),
    /** Subset of parcels that have a measured `calculated_area_ha` —
     *  treated as the "fields" count: parcels that have been mapped /
     *  surveyed and have a numeric area. */
    fieldCount: z.number().int(),
    /** Sum of `calculated_area_ha` across the cooperative's parcels.
     *  Returned as a string to preserve precision; FE parses to display. */
    totalAreaHa: z.string().nullable(),
    /** Count of users who can access this cooperative — explicit
     *  assignments + org-wide admins, deduped. */
    userCount: z.number().int(),
  })
  .openapi('Cooperative');

export const createCooperativeBodySchema = createCooperativeSchema.openapi('CreateCooperativeBody');
export const updateCooperativeBodySchema = updateCooperativeSchema.openapi('UpdateCooperativeBody');

export const cooperativeListQuerySchema = z.object({
  q: z.string().optional(),
  includeDeleted: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

export const cooperativeListResponseSchema = z
  .object({
    data: z.array(cooperativeCoreSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('CooperativeListResponse');

export const cooperativeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const errorResponse = z.object({ error: z.string() }).openapi('Error');

// Slim member shape for the cooperative-detail "Users with access" section.
// Roles are global (all role codes the user has) — coop-specific role
// scoping isn't part of the model, only assignment + scope.
export const cooperativeMemberSchema = z
  .object({
    userId: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    status: z.string(),
    isPrimary: z.boolean(),
    scope: z.enum(['district', 'all_districts']),
    roles: z.array(z.string()),
    /** True when access comes from `users.is_all_cooperative` rather
     *  than an explicit assignment. The FE hides the remove control
     *  on these rows since there's nothing coop-specific to un-assign. */
    viaOrgWide: z.boolean(),
  })
  .openapi('CooperativeMember');

export const cooperativeMembersResponseSchema = z
  .object({ data: z.array(cooperativeMemberSchema) })
  .openapi('CooperativeMembersResponse');

export const cooperativeMemberParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});
