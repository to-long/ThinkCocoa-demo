/**
 * Purchases — HTTP wiring.
 *
 *   GET /api/purchases        — paginated list (purchase:read)
 *   GET /api/purchases/stats  — stats card aggregates (purchase:read)
 *
 * Tenant-scoped to the active cooperative cookie.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getPurchase, getPurchaseStats, listPurchases } from './service';

export const purchaseRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

purchaseRoutes.use('/api/purchases', requireAuth);
purchaseRoutes.use('/api/purchases/*', requireAuth);
purchaseRoutes.use('/api/purchases', requireActiveCoop);
purchaseRoutes.use('/api/purchases/*', requireActiveCoop);

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
  district: z.string().optional(), // CSV
  society: z.string().optional(), // CSV
  payment: z.string().optional(), // CSV cash,mobile_money,cheque,card
  /** Exact farmer id — the farmer detail page's deliveries tile. `q`
   *  would have worked by accident (purchase ids embed the farmer code)
   *  but would also match any other column it happens to appear in. */
  farmerId: z.string().optional(),
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  purchaseId: z.string(),
  purchaseDate: z.string(),
  cooperativeId: z.string().nullable(),
  district: z.string().nullable(),
  society: z.string().nullable(),
  pcName: z.string().nullable(),
  stationMarkNumber: z.string().nullable(),
  farmerCode: z.string(),
  farmerName: z.string().nullable(),
  purchasingClerkCardNumber: z.string().nullable(),
  fieldId: z.string().nullable(),
  weightKg: z.number(),
  amountReceived: z.number(),
  paymentType: z.enum(['cash', 'mobile_money', 'cheque', 'card']),
  paymentReference: z.string().nullable(),
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
  totalPurchases: z.number(),
  totalWeightKg: z.number(),
  totalAmount: z.number(),
  blendedRateGhsPerKg: z.number().nullable(),
  activePcs: z.number(),
  activeSocieties: z.number(),
  activeFarmers: z.number(),
  paymentBreakdown: z.object({
    cash: z.number(),
    mobile_money: z.number(),
    cheque: z.number(),
    card: z.number(),
  }),
  topDistricts: z.array(z.object({ district: z.string(), count: z.number() })),
  societies: z.array(z.string()),
  monthlyPurchases: z.array(z.object({ month: z.string(), count: z.number() })),
});

const detailResponse = listItem.extend({
  cooperativeName: z.string().nullable(),
  cooperativeCode: z.string().nullable(),
  formVersion: z.string(),
  koboId: z.number(),
  snapshotUrl: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const errorResponse = z.object({ error: z.string() });

purchaseRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/purchases/stats',
    tags: ['Purchases'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('purchase:read')],
  }),
  async (c) => {
    const stats = await getPurchaseStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

purchaseRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/purchases/{id}',
    tags: ['Purchases'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('purchase:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getPurchase(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Purchase not found' }, 404);
    return c.json(row, 200);
  },
);

purchaseRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/purchases',
    tags: ['Purchases'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('purchase:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listPurchases({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      farmerId: q.farmerId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      districts: splitCsv(q.district),
      societies: splitCsv(q.society),
      paymentTypes: splitCsv(q.payment),
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
