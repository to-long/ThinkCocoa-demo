/**
 * Zod schemas for inspection API request/response shapes. Wired into
 * `@hono/zod-openapi` routes for typed request validation + OpenAPI
 * spec generation.
 */

import { updateCorrectiveActionSchema } from '@thinkcocoa/shared';
import { z } from '@hono/zod-openapi';

export const errorResponse = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('ErrorResponse');

/** PATCH body for a corrective action (status transition + reschedule).
 *  Reuses the shared validator; `.openapi()` is applied at use site. */
export const updateCorrectiveActionBody =
  updateCorrectiveActionSchema.openapi('UpdateCorrectiveAction');

/** The updated corrective action returned by the PATCH endpoint. */
export const correctiveActionResponseSchema = z
  .object({
    id: z.string(),
    // Nullable since corrective_actions went multi-source: a coaching-sourced
    // action has no inspection_id (coaching_visit_id instead).
    inspectionId: z.number().nullable(),
    topic: z.string(),
    action: z.string(),
    actionDate: z.string().nullable(),
    status: z.enum(['open', 'reopen', 'processing', 'done']),
    lastComment: z.string().nullable(),
  })
  .openapi('CorrectiveAction');

/** Query for listing a parcel's / farmer's corrective actions across sources. */
export const correctiveActionListQuery = z.object({
  parcelId: z.string().optional(),
  farmerId: z.string().optional(),
});

/** One corrective action with its source, for the aggregated parcel/farmer card. */
export const correctiveActionListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      source: z.enum(['inspection', 'coaching']),
      topic: z.string(),
      action: z.string(),
      actionDate: z.string().nullable(),
      status: z.enum(['open', 'reopen', 'processing', 'done']),
      lastComment: z.string().nullable(),
    }),
  ),
});

/** Corrective-action analytics for the dashboard Farms tab. */
export const correctiveActionStatsSchema = z
  .object({
    total: z.number(),
    outstanding: z.number(),
    byStatus: z.object({
      open: z.number(),
      reopen: z.number(),
      processing: z.number(),
      done: z.number(),
    }),
    byTopic: z.array(z.object({ topic: z.string(), count: z.number() })),
    overdue: z.number(),
  })
  .openapi('CorrectiveActionStats');

export const eudrStatusEnum = z.enum(['unknown', 'compliant', 'non_compliant', 'needs_review']);

export const listInspectionsQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  eudr: z.string().optional(), // comma separated
  compliance: z.string().optional(), // comma 'high'/'mid'/'low'
  inspector: z.string().optional(),
  farmerId: z.string().optional(),
  parcelId: z.string().optional(),
  sort: z.string().optional(),
});

export const attachmentSchema = z
  .object({
    id: z.string(),
    koboUid: z.string(),
    questionXpath: z.string(),
    filename: z.string().nullable(),
    mimetype: z.string().nullable(),
    koboUrl: z.string().nullable(),
    spacesUrl: z.string().nullable(),
  })
  .openapi('InspectionAttachment');

export const inspectionListItemSchema = z
  .object({
    // PK = Kobo `_id` (numeric, e.g. 757860568) since migration 0024.
    id: z.number(),
    koboUuid: z.string(),
    formVersion: z.string(),
    cooperativeId: z.string().nullable(),
    farmerId: z.string().nullable(),
    parcelId: z.string().nullable(),
    dateInspection: z.string(),
    inspectorCode: z.string().nullable(),
    eudrStatus: eudrStatusEnum.nullable(),
    complianceScore: z.number().nullable(),
    complianceMax: z.number().nullable(),
    compliancePct: z.number().nullable(),
    programYear: z.number().int().nullable(),
    certificationOutcome: z
      .enum(['certified', 'certified_with_ca', 'not_certified', 'disqualified'])
      .nullable(),
    submittedAt: z.string(),
    syncedAt: z.string(),
    followUps: z
      .array(
        z.object({
          id: z.string(),
          topic: z.string(),
          action: z.string(),
          actionDate: z.string().nullable(),
          status: z.enum(['open', 'reopen', 'processing', 'done']),
          lastComment: z.string().nullable(),
        }),
      )
      .default([]),
    farmerName: z.string().nullable().optional(),
    society: z.string().nullable().optional(),
  })
  .openapi('InspectionListItem');

export const inspectionListResponseSchema = z
  .object({
    items: z.array(inspectionListItemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  })
  .openapi('InspectionListResponse');

export const inspectionDetailSchema = inspectionListItemSchema
  .extend({
    // (no `koboId` — `id` IS the Kobo `_id` since migration 0024)
    eudrScore: z.number().nullable(),
    eudrNoDeforestation: z.boolean().nullable(),
    eudrNoForestConversion: z.boolean().nullable(),
    eudrOutsideHcva: z.boolean().nullable(),
    eudrLegalRights: z.boolean().nullable(),
    eudrAssessedAt: z.string().nullable(),
    submittedBy: z.string().nullable(),
    snapshotUrl: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    attachments: z.array(attachmentSchema),
  })
  .openapi('InspectionDetail');

export const inspectionStatsSchema = z
  .object({
    total: z.number(),
    thisMonth: z.number(),
    avgCompliancePct: z.number().nullable(),
    eudr: z.object({
      compliant: z.number(),
      needs_review: z.number(),
      non_compliant: z.number(),
      unknown: z.number(),
    }),
    certificate: z.object({
      certified: z.number(),
      certified_with_ca: z.number(),
      not_certified: z.number(),
      disqualified: z.number(),
    }),
  })
  .openapi('InspectionStats');
