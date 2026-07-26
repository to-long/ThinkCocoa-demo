/**
 * Roles — request/response schemas.
 *
 * Pulled out of `routes.ts` so the SDK consumer side (FE) can import
 * the same Zod shape if it ever wants client-side validation, and so
 * the route handlers stay focused on HTTP wiring.
 *
 * Request body schemas come from `@cocoaimpact/shared` (single source
 * of truth between BE + FE) and are re-exported here with OpenAPI
 * tags so the generated SDK gets nice names.
 */

import { createRoleSchema, setRolePermissionsSchema, updateRoleSchema } from '@cocoaimpact/shared';
import { z } from '@hono/zod-openapi';

// ── Response schemas ─────────────────────────────────────────
export const roleCoreSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    grantCount: z.number().int(),
  })
  .openapi('Role');

export const roleDetailSchema = roleCoreSchema
  .extend({ permissions: z.array(z.string()) })
  .openapi('RoleDetail');

export const roleListResponseSchema = z.object({
  items: z.array(roleDetailSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const rolesStatsSchema = z
  .object({
    total: z.number().int(),
    active: z.number().int(),
    byRole: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        userCount: z.number().int(),
      }),
    ),
    permissions: z.object({
      assigned: z.number().int(),
      unassigned: z.number().int(),
    }),
  })
  .openapi('RolesStats');

// ── Request body schemas ─────────────────────────────────────
export const createRoleBody = createRoleSchema.openapi('CreateRoleBody');
export const updateRoleBody = updateRoleSchema.openapi('UpdateRoleBody');
export const setPermissionsBody = setRolePermissionsSchema.openapi('SetRolePermissionsBody');

// ── Query schemas ────────────────────────────────────────────
export const rolesListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  includePermissions: z.string().optional(),
  /** JSON:API sort spec — `field` (asc) / `-field` (desc),
   *  comma-separated. Supported fields: `name`. Anything else
   *  falls back to the BE default (newest createdAt). */
  sort: z.string().optional(),
});

// ── Error envelope ───────────────────────────────────────────
export const errorResponse = z.object({ error: z.string() }).openapi('Error');
