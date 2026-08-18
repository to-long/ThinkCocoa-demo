/**
 * Permissions — request/response schemas.
 *
 * Pulled out of `routes.ts` so the SDK consumer side (FE) can import
 * the same Zod shape if it ever wants client-side validation, and so
 * the route handlers stay focused on HTTP wiring. Request bodies for
 * create / update / batch-create live in `@kuanadata/shared` —
 * we only re-tag them here for OpenAPI registration.
 */

import { z } from '@hono/zod-openapi';
import {
  createPermissionGroupsSchema,
  createPermissionSchema,
  updatePermissionSchema,
} from '@kuanadata/shared';

// Response schema (OpenAPI-tagged) — request bodies come from @kuanadata/shared.
export const permissionSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Permission');

export const createPermissionBody = createPermissionSchema.openapi('CreatePermissionBody');
export const updatePermissionBody = updatePermissionSchema.openapi('UpdatePermissionBody');
export const createPermissionGroupsBody = createPermissionGroupsSchema.openapi(
  'CreatePermissionGroupsBody',
);

export const permissionGroupsResultSchema = z
  .object({
    created: z.array(permissionSchema),
    existed: z.array(z.string()), // codes that were already present
  })
  .openapi('PermissionGroupsResult');

// Body for `PUT /api/permissions/groups/:resource` (set-state edit).
// `actions` is the desired action list — BE diffs against current and
// applies the add/remove deltas in a single audit-tagged transaction.
export const setPermissionGroupActionsBody = z
  .object({
    actions: z.array(z.string().min(1)).max(64),
  })
  .openapi('SetPermissionGroupActionsBody');

export const setPermissionGroupActionsResultSchema = z
  .object({
    codes: z.array(z.string()),
    added: z.array(z.string()),
    removed: z.array(z.string()),
  })
  .openapi('SetPermissionGroupActionsResult');

export const errorResponse = z.object({ error: z.string() }).openapi('Error');

// Powers the slim stats row at the top of /admin/permissions (Pencil
// `GYxeF`):
//   • Left card  — total permission count + "<N> Groups" pill
//   • Right card — chip per action verb across all permissions
export const permissionsStatsSchema = z
  .object({
    total: z.number().int(),
    groupCount: z.number().int(),
    byAction: z.array(
      z.object({
        action: z.string(),
        count: z.number().int(),
      }),
    ),
  })
  .openapi('PermissionsStats');

export const permissionActionSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    action: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  })
  .openapi('PermissionAction');

export const permissionGroupSchema = z
  .object({
    resource: z.string(),
    actions: z.array(permissionActionSchema),
    /** Latest `updated_at` across the group's permission rows.
     *  Surfaces in the admin list as a "last touched" column. */
    updatedAt: z.string(),
  })
  .openapi('PermissionGroup');

export const permissionGroupsPageSchema = z
  .object({
    items: z.array(permissionGroupSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('PermissionGroupsPage');

export const permissionGroupsListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  /** JSON:API sort spec — `field` (asc) / `-field` (desc),
   *  comma-separated. Supported: `resource`, `updated_at`.
   *  Unknowns silently fall back to default (newest first). */
  sort: z.string().optional(),
});
