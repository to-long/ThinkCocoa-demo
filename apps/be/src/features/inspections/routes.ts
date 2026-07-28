/**
 * Inspections — HTTP wiring.
 *
 *   GET /api/inspections            — paginated list (inspection:read)
 *   GET /api/inspections/stats      — aggregates for stats card (inspection:read)
 *   GET /api/inspections/:id        — detail (inspection:read)
 *
 * All routes are tenant-scoped to the active cooperative cookie via
 * `requireActiveCoop`. A user that hasn't picked a coop yet gets 412
 * from the middleware — no inspection leakage across coops.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { writeAudit } from '../../lib/audit';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import {
  correctiveActionListQuery,
  correctiveActionListResponseSchema,
  correctiveActionResponseSchema,
  correctiveActionStatsSchema,
  errorResponse,
  inspectionDetailSchema,
  inspectionListResponseSchema,
  inspectionStatsSchema,
  listInspectionsQuery,
  updateCorrectiveActionBody,
} from './schemas';
import {
  applyInspectionChanges,
  getCorrectiveActionStats,
  getInspection,
  getInspectionComparison,
  getInspectionStats,
  getLatestInspectionForParcel,
  listCorrectiveActions,
  listInspections,
  updateCorrectiveAction,
} from './service';

export const inspectionsRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

inspectionsRoutes.use('/api/inspections', requireAuth);
inspectionsRoutes.use('/api/inspections/*', requireAuth);
inspectionsRoutes.use('/api/inspections', requireActiveCoop);
inspectionsRoutes.use('/api/inspections/*', requireActiveCoop);

const splitCsv = (raw: string | undefined): string[] =>
  raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

// ── STATS ───────────────────────────────────────────────────────
// Registered BEFORE `/:id` so the `stats` path doesn't get matched
// as an id parameter.
inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections/stats',
    tags: ['Inspections'],
    responses: {
      200: {
        description: 'Aggregate counts and averages',
        content: { 'application/json': { schema: inspectionStatsSchema } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const stats = await getInspectionStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

// Corrective-action analytics (status mix + topic breakdown + overdue).
// Registered before `/:id` so `corrective-actions` isn't read as an id.
inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections/corrective-actions/stats',
    tags: ['Inspections'],
    responses: {
      200: {
        description: 'Corrective-action analytics',
        content: { 'application/json': { schema: correctiveActionStatsSchema } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const stats = await getCorrectiveActionStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

// Corrective actions for a parcel / farmer across BOTH sources
// (inspection + coaching). Registered before `/:id` so the literal
// `corrective-actions` segment isn't matched as an inspection id.
inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections/corrective-actions',
    tags: ['Inspections'],
    request: { query: correctiveActionListQuery },
    responses: {
      200: {
        description: 'Corrective actions for a parcel / farmer (all sources)',
        content: { 'application/json': { schema: correctiveActionListResponseSchema } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const items = await listCorrectiveActions(
      { parcelId: q.parcelId, farmerId: q.farmerId },
      c.get('activeCoopId'),
    );
    return c.json({ items }, 200);
  },
);

// ── LIST ────────────────────────────────────────────────────────
inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections',
    tags: ['Inspections'],
    request: { query: listInspectionsQuery },
    responses: {
      200: {
        description: 'Paginated inspection list',
        content: { 'application/json': { schema: inspectionListResponseSchema } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const query = c.req.valid('query');
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20));

    const result = await listInspections({
      activeCoopId: c.get('activeCoopId'),
      q: query.q,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      eudrStatuses: splitCsv(query.eudr),
      certificationOutcomes: splitCsv(query.compliance).filter(
        (s): s is 'certified' | 'certified_with_ca' | 'not_certified' | 'disqualified' =>
          s === 'certified' ||
          s === 'certified_with_ca' ||
          s === 'not_certified' ||
          s === 'disqualified',
      ),
      inspectorCodes: splitCsv(query.inspector),
      farmerId: query.farmerId,
      parcelId: query.parcelId,
      page,
      pageSize,
      sort: query.sort,
    });

    return c.json(result, 200);
  },
);

// ── UPDATE CORRECTIVE ACTION (status transition + reschedule) ─────
inspectionsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/inspections/corrective-actions/{id}',
    tags: ['Inspections'],
    middleware: [requirePermission('inspection:update')],
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: updateCorrectiveActionBody } },
      },
    },
    responses: {
      200: {
        description: 'Updated corrective action',
        content: { 'application/json': { schema: correctiveActionResponseSchema } },
      },
      404: {
        description: 'Corrective action not found in active coop',
        content: { 'application/json': { schema: errorResponse } },
      },
      422: {
        description: 'Invalid status transition',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const user = c.get('user');
    const activeCoopId = c.get('activeCoopId');

    const result = await updateCorrectiveAction(
      id,
      { status: body.status, actionDate: body.actionDate, lastComment: body.lastComment },
      activeCoopId,
    );
    if (result.kind === 'not-found') {
      return c.json({ error: 'Corrective action not found', code: 'NOT_FOUND' }, 404);
    }
    if (result.kind === 'invalid-transition') {
      return c.json(
        {
          error: `Cannot move corrective action from '${result.from}' to '${result.to}'`,
          code: 'INVALID_TRANSITION',
        },
        422,
      );
    }

    await writeAudit({
      actorUserId: user.id,
      entitySchema: 'inspection',
      entityTable: 'corrective_actions',
      entityId: result.row.id,
      action: 'update',
      cooperativeId: activeCoopId,
      summary: `${user.name ?? user.email} updated corrective action ${result.row.topic}${
        body.status ? ` → ${body.status}` : ''
      }`,
      ctx: c,
    });

    return c.json(result.row, 200);
  },
);

// ── LATEST FOR PARCEL ──────────────────────────────────────────
inspectionsRoutes.get(
  '/api/parcels/:parcelId/latest-inspection',
  requirePermission('inspection:read'),
  async (c) => {
    const parcelId = c.req.param('parcelId');
    const row = await getLatestInspectionForParcel(parcelId, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'No inspection for this parcel', code: 'NOT_FOUND' }, 404);
    return c.json(row, 200);
  },
);

// ── DETAIL ─────────────────────────────────────────────────────
inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections/{id}',
    tags: ['Inspections'],
    responses: {
      200: {
        description: 'Inspection detail',
        content: { 'application/json': { schema: inspectionDetailSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    }
    const detail = await getInspection(id, c.get('activeCoopId'));
    if (!detail) return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    return c.json(detail, 200);
  },
);

// ── SNAPSHOT vs MASTER ─────────────────────────────────────────
// Field-by-field diff between what the inspector recorded and the
// current farmer / parcel row, plus an endpoint to copy chosen values
// onto the master. Drives the "Compare" buttons on the detail page.
const diffFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  inspection: z.string().nullable(),
  master: z.string().nullable(),
  isDiff: z.boolean(),
});
const comparisonSectionSchema = z.object({
  fields: z.array(diffFieldSchema),
  diffs: z.number().int(),
  matches: z.number().int(),
  missing: z.boolean(),
});
const comparisonSchema = z
  .object({
    inspectionId: z.number().int(),
    farmer: comparisonSectionSchema,
    parcel: comparisonSectionSchema,
  })
  .openapi('InspectionComparison');

inspectionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/inspections/{id}/comparison',
    tags: ['Inspections'],
    responses: {
      200: {
        description: 'Snapshot vs master diff',
        content: { 'application/json': { schema: comparisonSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('inspection:read')],
  }),
  async (c) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    }
    const cmp = await getInspectionComparison(id, c.get('activeCoopId'));
    if (!cmp) return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    return c.json(cmp, 200);
  },
);

inspectionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/inspections/{id}/apply-changes',
    tags: ['Inspections'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              section: z.enum(['farmer', 'parcel']),
              keys: z.array(z.string()).min(1),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Applied / skipped keys + the refreshed comparison',
        content: {
          'application/json': {
            schema: z.object({
              applied: z.array(z.string()),
              skipped: z.array(z.string()),
              comparison: comparisonSchema,
            }),
          },
        },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    // Writing to the master row needs the master's own update right.
    middleware: [requirePermission('farmer:update', 'parcel:update')],
  }),
  async (c) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id)) {
      return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    }
    const { section, keys } = c.req.valid('json');
    const res = await applyInspectionChanges(id, section, keys, c.get('activeCoopId'));
    if (!res) return c.json({ error: 'Inspection not found', code: 'NOT_FOUND' }, 404);
    return c.json(res, 200);
  },
);
