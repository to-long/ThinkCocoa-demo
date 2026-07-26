/**
 * Users — request/response schemas + OpenAPI registrations.
 *
 * Request bodies and the list query come from `@thinkcocoa/shared`
 * (so the FE / generated SDK pick up the same Zod shape). Response
 * shapes and the slim-stats schema are owned here so changes don't
 * leak across the package boundary unnecessarily.
 */

import {
  ASSIGNMENT_SCOPES,
  assignCooperativeSchema,
  createUserSchema,
  listUsersQuerySchema,
  setUserRolesSchema,
  USER_STATUSES,
  updateUserSchema,
} from '@thinkcocoa/shared';
import { z } from '@hono/zod-openapi';

// ── Response schemas ─────────────────────────────────────────
export const userCoreSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    status: z.enum(USER_STATUSES),
    defaultCooperativeId: z.string().uuid().nullable(),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /**
     * Soft-delete tombstone. `null` for live users. ALWAYS returned (not
     * conditional on `includeDeleted=true`) so the admin list can render
     * the "Deleted" badge + Restore button for tombstoned rows without
     * having to refetch with a different query shape.
     */
    deletedAt: z.string().nullable(),
    /** Org-wide override flag. When true, the user has access to every
     *  cooperative regardless of the assignment list below. */
    isAllCooperative: z.boolean(),
    // Role CODES granted to the user. Included on the LIST response so the
    // admin users table can render role badges without an N+1 detail fetch.
    roles: z.array(z.string()),
    // Slim cooperative assignments — same idea as `roles` above. Lets the
    // admin list render the "Scope" column tags (one per coop, or a
    // single "All cooperatives" pill when an org-wide role is present)
    // without hitting `/api/users/:id` for each row.
    cooperativeAssignments: z.array(
      z.object({
        cooperativeId: z.string().uuid(),
        cooperativeCode: z.string(),
        cooperativeName: z.string(),
        scope: z.enum(ASSIGNMENT_SCOPES),
        isPrimary: z.boolean(),
      }),
    ),
  })
  .openapi('User');

export const userDetailSchema = userCoreSchema
  .extend({
    roles: z.array(z.string()),
    /**
     * Permission codes (`resource:action`) the user has effectively been
     * granted — union of every permission reachable via any of their roles.
     * Included on the DETAIL endpoint only so callers don't need to loop
     * `/api/roles/:id` to reconstruct the set.
     */
    permissions: z.array(z.string()),
    cooperativeAssignments: z.array(
      z.object({
        cooperativeId: z.string().uuid(),
        cooperativeCode: z.string(),
        cooperativeName: z.string(),
        scope: z.enum(ASSIGNMENT_SCOPES),
        isPrimary: z.boolean(),
      }),
    ),
    /**
     * Resolved coop catalog the user can switch into via the header
     * CoopSwitcher — saves the FE a separate `/api/cooperatives` call
     * on bootstrap. For org-wide admins this is every live coop;
     * otherwise it mirrors `cooperativeAssignments` (id/code/name only).
     */
    accessibleCooperatives: z.array(
      z.object({
        id: z.string().uuid(),
        code: z.string(),
        name: z.string(),
      }),
    ),
  })
  .openapi('UserDetail');

export const userListResponseSchema = z.object({
  items: z.array(userCoreSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// ── Stats schema ─────────────────────────────────────────────
// Powers the user list's slim stats row (Pencil `0M9b6`):
//   • Total Users card
//   • Status row: Active / Inactive / Blocked / Deleted
//   • Roles row: one chip per canonical role with a live user count
//
// Status buckets mirror the list page's UI aliasing:
//   DB `status = 'locked'` surfaces as `blocked` (the name used in
//   every badge / filter / legend on the FE). `deleted` is live rows
//   with a non-null `deleted_at` tombstone — they're hidden from the
//   default list, but admins need the count here to know how many
//   restorable accounts exist.
export const userStatsSchema = z
  .object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    blocked: z.number().int(),
    deleted: z.number().int(),
    /** Scope distribution — counts users by WHO can access each
     *  cooperative. `all` = users with `is_all_cooperative = true`
     *  (these add to every coop's count too, since they implicitly
     *  access all). Per-coop entries surface even when zero so the
     *  FE chip row stays deterministic across reloads. */
    byScope: z.object({
      all: z.number().int(),
      /** Users with no coop access at all (no assignment, not org-wide). */
      none: z.number().int(),
      byCooperative: z.array(
        z.object({
          cooperativeId: z.string().uuid(),
          cooperativeName: z.string(),
          count: z.number().int(),
        }),
      ),
    }),
  })
  .openapi('UserStats');

export const setRolesResponseSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(z.string()),
});

export const assignCoopResponseSchema = z.object({
  userId: z.string().uuid(),
  cooperativeId: z.string().uuid(),
  scope: z.enum(['district', 'all_districts']),
  isPrimary: z.boolean(),
});

// ── Request bodies / query (OpenAPI-tagged passthroughs) ─────
export const createUserBody = createUserSchema.openapi('CreateUserBody');
export const updateUserBody = updateUserSchema.openapi('UpdateUserBody');
export const setRolesBody = setUserRolesSchema.openapi('SetUserRolesBody');
export const assignCoopBody = assignCooperativeSchema.openapi('AssignCooperativeBody');
export const listUsersQuery = listUsersQuerySchema;

export const errorResponse = z.object({ error: z.string() }).openapi('Error');

export type UserStatsPayload = z.infer<typeof userStatsSchema>;
