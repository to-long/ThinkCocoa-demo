/**
 * Audit log — request/response schemas + status enum.
 *
 * Pulled out of `routes.ts` so the SDK consumer side (FE) can import
 * the same Zod shape if it ever wants client-side validation, and so
 * the route handlers stay focused on HTTP wiring.
 */

import { z } from '@hono/zod-openapi';

// Status lives in `metadata.status`; we constrain it to a known
// vocabulary so the FE can render coloured badges deterministically.
export const STATUS_VALUES = ['success', 'failed', 'warning'] as const;
export type AuditStatus = (typeof STATUS_VALUES)[number];

export const auditLogRowSchema = z
  .object({
    id: z.number().int(),
    createdAt: z.string(),
    actorUserId: z.string().uuid().nullable(),
    actorEmail: z.string().nullable(),
    actorFullName: z.string().nullable(),
    serviceName: z.string().nullable(),
    entitySchema: z.string(),
    entityTable: z.string(),
    entityId: z.string().nullable(),
    action: z.string(),
    cooperativeId: z.string().uuid().nullable(),
    cooperativeName: z.string().nullable(),
    /** Derived from metadata.status; null if untagged. */
    status: z.enum(STATUS_VALUES).nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    sessionId: z.string().nullable(),
    /** Human-readable one-liner ("Updated farmer profile"). */
    summary: z.string().nullable(),
    /** Full JSONB metadata blob — kept around in case the FE needs it. */
    metadata: z.record(z.string(), z.unknown()).nullable(),
    /** Top-N field changes attached to this audit row, surfaced in the
     *  list response so the FE can render them inline. Full diff still
     *  lives on the detail endpoint. `null` when no changes are attached
     *  (create / delete / login / etc.). */
    changesPreview: z
      .object({
        preview: z.array(
          z.object({
            fieldName: z.string(),
            oldValue: z.unknown().nullable(),
            newValue: z.unknown().nullable(),
          }),
        ),
        total: z.number().int(),
      })
      .nullable(),
  })
  .openapi('AuditLogEntry');

export const auditLogDetailSchema = auditLogRowSchema
  .extend({
    changes: z.array(
      z.object({
        id: z.string().uuid(),
        fieldName: z.string(),
        oldValue: z.unknown().nullable(),
        newValue: z.unknown().nullable(),
      }),
    ),
  })
  .openapi('AuditLogDetail');

export const auditLogListResponseSchema = z
  .object({
    data: z.array(auditLogRowSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('AuditLogListResponse');

export const auditLogStatsSchema = z
  .object({
    total: z.number().int(),
    windowDays: z.number().int(),
    byStatus: z.object({
      success: z.number().int(),
      failed: z.number().int(),
      warning: z.number().int(),
    }),
    byScope: z.array(
      z.object({
        entityTable: z.string(),
        count: z.number().int(),
      }),
    ),
  })
  .openapi('AuditLogStats');

export const auditListQuerySchema = z.object({
  q: z.string().optional(),
  actorId: z.string().uuid().optional(),
  entityTable: z.string().optional(),
  /** Exact match on `entity_id` — admins use this to follow a single
   *  object's history ("show me every event on farmer AK012WP01").
   *  Free-form string because `entity_id` is `TEXT` in the schema
   *  (UUIDs, slugs, business codes all flow through). Combined with
   *  `entityTable` from the URL it pins both axes of the
   *  `(entity_table, entity_id)` compound. */
  entityId: z.string().optional(),
  /** Comma-separated list of cooperative UUIDs. Filters audit rows
   *  by `cooperativeId` (the coop the event happened in / against).
   *  Empty / missing = no filter. Used by the FE multi-select. */
  cooperativeId: z.string().optional(),
  action: z.string().optional(),
  /** Comma-separated list of statuses (e.g. `success,failed`) — empty
   *  / missing means "no status filter". Single-value is just a list
   *  of one. Validated downstream against `STATUS_VALUES`. */
  status: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /**
   * Convenience: filter to "events from the last N days". When set,
   * computes `from = now - days*86400000` server-side and overrides
   * any explicit `from`. Lets URL state stay readable
   * (`?days=30`) instead of leaking an ISO timestamp.
   */
  days: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  /**
   * JSON:API-style sort: comma-separated list of fields, with
   * a leading `-` for descending. Examples:
   *   ?sort=-createdAt     (newest first — same as default)
   *   ?sort=createdAt      (oldest first)
   *   ?sort=-createdAt,id  (multi-column; reserved for future)
   *
   * Unknown columns are ignored — BE keeps its desc-createdAt
   * default rather than 400ing on unfamiliar input.
   */
  sort: z.string().optional(),
});

export const auditStatsQuerySchema = z.object({
  days: z.string().optional(),
});

export const errorResponse = z.object({ error: z.string() }).openapi('Error');
