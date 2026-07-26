/**
 * Secondary Evacuation HTTP wiring.
 *   GET /api/secondary-evac        — paginated list (secondary_evac:read)
 *   GET /api/secondary-evac/stats  — stats card aggregates
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getSecondaryEvacLot, getSecondaryEvacStats, listSecondaryEvacLots } from './service';

export const secondaryEvacRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

secondaryEvacRoutes.use('/api/secondary-evac', requireAuth);
secondaryEvacRoutes.use('/api/secondary-evac/*', requireAuth);
secondaryEvacRoutes.use('/api/secondary-evac', requireActiveCoop);
secondaryEvacRoutes.use('/api/secondary-evac/*', requireActiveCoop);

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
  depot: z.string().optional(),
  port: z.string().optional(),
  partner: z.string().optional(),
  grade: z.string().optional(),
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  secondaryWaybillNumber: z.string(),
  evacuationDate: z.string(),
  cooperativeId: z.string().nullable(),
  district: z.string(),
  depotOrigin: z.string(),
  beanGrade: z.string(),
  beanCategory: z.string(),
  sealNumber: z.string(),
  sourcingPartner: z.string(),
  bagsLoaded: z.number(),
  portDestination: z.string(),
  driverName: z.string().nullable(),
  truckRegistration: z.string().nullable(),
  primaryLotCount: z.number(),
  primaryLotMatched: z.number(),
  ddsStatus: z.enum(['draft', 'ready', 'submitted', 'accepted', 'rejected', 'withdrawn']),
  ddsReference: z.string().nullable(),
  eudrStatus: z.enum(['compliant', 'in_review', 'at_risk', 'non_compliant', 'not_assessed']),
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
  totalPrimaryLinked: z.number(),
  totalPrimaryMatched: z.number(),
  activeTrucks: z.number(),
  activePartners: z.number(),
  ports: z.array(z.object({ port: z.string(), lots: z.number(), bags: z.number() })),
  grades: z.array(z.object({ grade: z.string(), lots: z.number() })),
  monthlyLots: z.array(z.object({ month: z.string(), count: z.number() })),
});

const purchaseRow = z.object({
  id: z.string(),
  purchaseId: z.string(),
  matched: z.boolean(),
  farmerName: z.string().nullable(),
  fieldId: z.string().nullable(),
  purchaseDate: z.string().nullable(),
  weightKg: z.number().nullable(),
});

const primaryLotRow = z.object({
  id: z.string().nullable(),
  primaryWaybillRaw: z.string(),
  primaryWaybillNumber: z.string().nullable(),
  kgReceived: z.number().nullable(),
  bagsReceived: z.number().nullable(),
  evacuationDate: z.string().nullable(),
  driverName: z.string().nullable(),
  truckRegistration: z.string().nullable(),
  sealNumber: z.string().nullable(),
  purchases: z.array(purchaseRow),
  purchaseCount: z.number(),
  farmerCount: z.number(),
  plotCount: z.number(),
});

const detailResponse = listItem.extend({
  cooperativeName: z.string().nullable(),
  cooperativeCode: z.string().nullable(),
  depotGps: z.string().nullable(),
  driverFirstName: z.string().nullable(),
  driverLastName: z.string().nullable(),
  driverLicenceNumber: z.string().nullable(),
  qccImageUrl: z.string().nullable(),
  ddsSubmittedAt: z.string().nullable(),
  chainDepth: z.object({ primaryLots: z.number(), purchases: z.number() }),
  linkedFarms: z.object({ farmers: z.number(), plots: z.number() }),
  primaryLots: z.array(primaryLotRow),
  custody: z.object({
    totalPrimary: z.number(),
    matchedPrimary: z.number(),
    orphans: z.number(),
  }),
  formVersion: z.string(),
  koboId: z.number(),
  snapshotUrl: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponse = z.object({ error: z.string() });

secondaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/secondary-evac/stats',
    tags: ['Secondary Evacuation'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('secondary_evac:read')],
  }),
  async (c) => {
    const stats = await getSecondaryEvacStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

secondaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/secondary-evac/{id}',
    tags: ['Secondary Evacuation'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('secondary_evac:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getSecondaryEvacLot(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Secondary evacuation lot not found' }, 404);
    return c.json(row, 200);
  },
);

secondaryEvacRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/secondary-evac',
    tags: ['Secondary Evacuation'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('secondary_evac:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listSecondaryEvacLots({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      depots: splitCsv(q.depot),
      ports: splitCsv(q.port),
      partners: splitCsv(q.partner),
      beanGrades: splitCsv(q.grade),
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
