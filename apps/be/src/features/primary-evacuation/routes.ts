/**
 * Primary Evacuation HTTP wiring.
 *   GET /api/primary-evac           — paginated list (primary_evac:read)
 *   GET /api/primary-evac/stats     — stats card aggregates
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getPrimaryEvacLot, getPrimaryEvacStats, listPrimaryEvacLots } from './service';

export const primaryEvacRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

primaryEvacRoutes.use('/api/primary-evac', requireAuth);
primaryEvacRoutes.use('/api/primary-evac/*', requireAuth);
primaryEvacRoutes.use('/api/primary-evac', requireActiveCoop);
primaryEvacRoutes.use('/api/primary-evac/*', requireActiveCoop);

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
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  warehouse: z.string().optional(), // CSV
  society: z.string().optional(), // CSV
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  primaryWaybillNumber: z.string(),
  evacuationDate: z.string(),
  cooperativeId: z.string().nullable(),
  stationMarkNumber: z.string().nullable(),
  pcName: z.string().nullable(),
  society: z.string().nullable(),
  districtDepot: z.string().nullable(),
  districtWarehouse: z.string(),
  bagsReceived: z.number(),
  kgReceived: z.number(),
  driverName: z.string().nullable(),
  truckRegistration: z.string().nullable(),
  childPurchaseCount: z.number(),
  childPurchaseMatched: z.number(),
  submittedAt: z.string(),
});

const listResponse = z.object({
  items: z.array(listItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const statsResponse = z.object({
  totalLots: z.number(),
  totalBags: z.number(),
  totalKg: z.number(),
  avgBagSizeKg: z.number().nullable(),
  avgLotKg: z.number().nullable(),
  activeStations: z.number(),
  activeDrivers: z.number(),
  activeTrucks: z.number(),
  totalChildPurchases: z.number(),
  warehouses: z.array(z.object({ warehouse: z.string(), lots: z.number(), kg: z.number() })),
  bySociety: z.array(z.object({ society: z.string(), lots: z.number() })),
  societies: z.array(z.string()),
  monthlyLots: z.array(z.object({ month: z.string(), count: z.number() })),
});

const childPurchaseEntry = z.object({
  id: z.string(),
  purchaseIdRaw: z.string(),
  purchaseId: z.string().nullable(),
  matched: z.boolean(),
  purchaseDate: z.string().nullable(),
  farmerId: z.string().nullable(),
  farmerCode: z.string().nullable(),
  farmerName: z.string().nullable(),
  fieldId: z.string().nullable(),
  weightKg: z.number().nullable(),
  amountReceivedGhs: z.number().nullable(),
});

const detailResponse = listItem.extend({
  cooperativeName: z.string().nullable(),
  cooperativeCode: z.string().nullable(),
  driverFirstName: z.string().nullable(),
  driverLastName: z.string().nullable(),
  sealNumber: z.string().nullable(),
  lotPhotoUrl: z.string().nullable(),
  childPurchases: z.array(childPurchaseEntry),
  formVersion: z.string(),
  koboId: z.number(),
  snapshotUrl: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponse = z.object({ error: z.string() });

primaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/primary-evac/stats',
    tags: ['Primary Evacuation'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('primary_evac:read')],
  }),
  async (c) => {
    const stats = await getPrimaryEvacStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

primaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/primary-evac/{id}',
    tags: ['Primary Evacuation'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('primary_evac:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getPrimaryEvacLot(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Primary evacuation lot not found' }, 404);
    return c.json(row, 200);
  },
);

primaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/primary-evac',
    tags: ['Primary Evacuation'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('primary_evac:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listPrimaryEvacLots({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      warehouses: splitCsv(q.warehouse),
      societies: splitCsv(q.society),
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
