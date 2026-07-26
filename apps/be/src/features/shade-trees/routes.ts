/**
 * Shade Trees HTTP wiring.
 *   GET /api/shade-trees           — paginated list of tree profiles
 *   GET /api/shade-trees/stats     — stats card aggregates
 *   GET /api/shade-trees/:id       — single profile detail
 *
 * Reuses `farmer:read` — anyone who can view farmers can view their
 * shade tree profiles.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getShadeTreeProfile, getShadeTreeStats, listShadeTreeProfiles } from './service';

export const shadeTreesRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

shadeTreesRoutes.use('/api/shade-trees', requireAuth);
shadeTreesRoutes.use('/api/shade-trees/*', requireAuth);
shadeTreesRoutes.use('/api/shade-trees', requireActiveCoop);
shadeTreesRoutes.use('/api/shade-trees/*', requireActiveCoop);

const splitCsv = (raw: string | undefined): string[] =>
  raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const listQuery = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().optional(),
  farmerId: z.string().optional(),
  parcelId: z.string().optional(),
  species: z.string().optional(),
  condition: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  cooperativeId: z.string().nullable(),
  farmerId: z.string().nullable(),
  farmerName: z.string().nullable(),
  parcelId: z.string().nullable(),
  district: z.string().nullable(),
  society: z.string().nullable(),
  dateObserved: z.string(),
  species: z.string(),
  treeTagNum: z.string().nullable(),
  heightClass: z.string().nullable(),
  treeCondition: z.string().nullable(),
  isAlive: z.boolean(),
  photoFilename: z.string().nullable(),
  submittedAt: z.string(),
});

const listResponse = z.object({
  items: z.array(listItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const speciesBreakdown = z.object({
  species: z.string(),
  count: z.number(),
  aliveCount: z.number(),
});

const statsResponse = z.object({
  totalTrees: z.number(),
  aliveTrees: z.number(),
  deadTrees: z.number(),
  parcelsWithShade: z.number(),
  farmersWithShade: z.number(),
  avgSurvivalPct: z.number().nullable(),
  speciesBreakdown: z.array(speciesBreakdown),
});

const detailResponse = listItem.extend({
  cooperativeName: z.string().nullable(),
  cooperativeCode: z.string().nullable(),
  enumerator: z.string().nullable(),
  dbhCm: z.number().nullable(),
  gpsPoint: z.string().nullable(),
  formVersion: z.string(),
  koboId: z.number(),
  snapshotUrl: z.string().nullable(),
  submittedBy: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponse = z.object({ error: z.string() });

shadeTreesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/shade-trees/stats',
    tags: ['Shade Trees'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const stats = await getShadeTreeStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

shadeTreesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/shade-trees/{id}',
    tags: ['Shade Trees'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getShadeTreeProfile(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Shade tree profile not found' }, 404);
    return c.json(row, 200);
  },
);

shadeTreesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/shade-trees',
    tags: ['Shade Trees'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listShadeTreeProfiles({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      farmerId: q.farmerId,
      parcelId: q.parcelId,
      species: splitCsv(q.species),
      condition: splitCsv(q.condition),
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
