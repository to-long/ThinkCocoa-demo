/**
 * Coaching — HTTP wiring.
 *
 *   GET /api/coaching-visits        — paginated list (coaching:read)
 *   GET /api/coaching-visits/stats  — stats card aggregates (coaching:read)
 *
 * All routes tenant-scoped to the active cooperative cookie via
 * `requireActiveCoop`.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getCoachingStats, getCoachingVisit, listCoachingVisits } from './service';

export const coachingRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

coachingRoutes.use('/api/coaching-visits', requireAuth);
coachingRoutes.use('/api/coaching-visits/*', requireAuth);
coachingRoutes.use('/api/coaching-visits', requireActiveCoop);
coachingRoutes.use('/api/coaching-visits/*', requireActiveCoop);

const splitCsv = (raw: string | undefined): string[] =>
  raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

// ── Schemas ────────────────────────────────────────────────────

const listQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  clmrsRisk: z.string().optional(), // CSV: no_risk,at_risk,case
  coaches: z.string().optional(), // CSV of coach_name
  followUpOnly: z.string().optional(), // 'true' | 'false'
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  visitDate: z.string(),
  coachName: z.string().nullable(),
  farmerCode: z.string().nullable(),
  farmerName: z.string().nullable(),
  cooperativeId: z.string().nullable(),
  district: z.string().nullable(),
  society: z.string().nullable(),
  clmrsRiskLevel: z.enum(['no_risk', 'at_risk', 'case']).nullable(),
  gapScore: z.number().nullable(),
  ipmScore: z.number().nullable(),
  gepScore: z.number().nullable(),
  gspScore: z.number().nullable(),
  overallScore: z.number().nullable(),
  gepNoDeforestation: z.boolean().nullable(),
  nChemicalApps: z.number(),
  nFertilizerApps: z.number(),
  nWeedingActs: z.number(),
  nPruningActs: z.number(),
  nHarvestActs: z.number(),
  nOtherActs: z.number(),
  followUpRequired: z.boolean(),
  followUpDate: z.string().nullable(),
  correctiveActions: z.number(),
  isOrphan: z.boolean(),
  submittedAt: z.string(),
});

const listResponse = z.object({
  items: z.array(listItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const statsResponse = z.object({
  total: z.number(),
  visitsLast30Days: z.number(),
  activeFarmers: z.number(),
  atRiskClmrs: z.number(),
  pendingFollowUp: z.number(),
  avgGap: z.number().nullable(),
  avgIpm: z.number().nullable(),
  avgGep: z.number().nullable(),
  avgGsp: z.number().nullable(),
  coaches: z.array(z.string()),
});

// ── Routes ─────────────────────────────────────────────────────

coachingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/coaching-visits/stats',
    tags: ['Coaching'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('coaching:read')],
  }),
  async (c) => {
    const stats = await getCoachingStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

const detailResponse = listItem.extend({
  followUps: z.array(
    z.object({
      id: z.string(),
      topic: z.string(),
      action: z.string(),
      actionDate: z.string().nullable(),
      status: z.enum(['open', 'reopen', 'processing', 'done']),
      lastComment: z.string().nullable(),
    }),
  ),
  formVersion: z.string(),
  koboId: z.number(),
  rawData: z.record(z.string(), z.unknown()).nullable(),
  snapshotUrl: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponse = z.object({ error: z.string() });

coachingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/coaching-visits/{id}',
    tags: ['Coaching'],
    request: {
      params: z.object({
        id: z.string().uuid(),
      }),
    },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('coaching:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getCoachingVisit(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Coaching visit not found' }, 404);
    return c.json(row, 200);
  },
);

coachingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/coaching-visits',
    tags: ['Coaching'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('coaching:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listCoachingVisits({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      clmrsRisks: splitCsv(q.clmrsRisk),
      coaches: splitCsv(q.coaches),
      followUpOnly: q.followUpOnly === 'true',
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
