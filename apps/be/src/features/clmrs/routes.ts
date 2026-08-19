/**
 * CLMRS — HTTP wiring (read-only).
 *
 *   GET /api/clmrs-records            — child-labour register for the
 *                                       active coop (clmrs:read)
 *   GET /api/clmrs-records/:childId   — single record
 *
 * Records are derived from `coaching.coaching_visits` (see service).
 * Tenant-scoped to the active cooperative cookie.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { createClmrsCase, getClmrsRecord, listClmrsRecords, setClmrsCaseStatus } from './service';

export const clmrsRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

clmrsRoutes.use('/api/clmrs-records', requireAuth);
clmrsRoutes.use('/api/clmrs-records/*', requireAuth);
clmrsRoutes.use('/api/clmrs-records', requireActiveCoop);
clmrsRoutes.use('/api/clmrs-records/*', requireActiveCoop);

const flagSchema = z.object({
  childId: z.string(),
  farmerId: z.string(),
  farmerName: z.string(),
  cooperativeCode: z.string(),
  cooperativeName: z.string(),
  childNameNormalised: z.string(),
  childNameDisplay: z.string(),
  childDob: z.string(),
  childSex: z.enum(['M', 'F']),
  source: z.enum(['household_visit', 'farm_visit']),
  flaggedActivities: z.array(z.string()),
  hasCase: z.boolean(),
  lastKoboSubmissionId: z.string(),
  lastChildIndex: z.number(),
  lastObservedAt: z.string(),
  createdAt: z.string(),
});
const caseSchema = z.object({
  id: z.string(),
  clmrsCode: z.string(),
  childId: z.string(),
  status: z.enum(['open', 'processing', 'closed']),
  lastVisitDate: z.string().nullable(),
  followUpDate: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
const recordSchema = z.object({ flag: flagSchema, case: caseSchema.nullable() });
const listResponse = z.object({ records: z.array(recordSchema) });
const errorResponse = z.object({ error: z.string() });

clmrsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/clmrs-records',
    tags: ['CLMRS'],
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('clmrs:read')],
  }),
  async (c) => {
    const records = await listClmrsRecords(c.get('activeCoopId'));
    return c.json({ records }, 200);
  },
);

clmrsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/clmrs-records/{childId}',
    tags: ['CLMRS'],
    request: { params: z.object({ childId: z.string() }) },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: recordSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('clmrs:read')],
  }),
  async (c) => {
    const { childId } = c.req.valid('param');
    const record = await getClmrsRecord(childId);
    if (!record) return c.json({ error: 'CLMRS record not found' }, 404);
    return c.json(record, 200);
  },
);

clmrsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/clmrs-records/{childId}/case',
    tags: ['CLMRS'],
    request: {
      params: z.object({ childId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({ followUpDate: z.string().nullable().optional() }),
          },
        },
      },
    },
    responses: {
      201: { description: 'Created', content: { 'application/json': { schema: caseSchema } } },
      404: {
        description: 'Flag not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('clmrs:create')],
  }),
  async (c) => {
    const { childId } = c.req.valid('param');
    const { followUpDate } = c.req.valid('json');
    const created = await createClmrsCase(childId, followUpDate ?? null);
    if (!created) return c.json({ error: 'CLMRS flag not found' }, 404);
    return c.json(created, 201);
  },
);

clmrsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/clmrs-records/{childId}/case',
    tags: ['CLMRS'],
    request: {
      params: z.object({ childId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              status: z.enum(['open', 'processing', 'closed']),
              followUpDate: z.string().nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: caseSchema } } },
      404: {
        description: 'Case not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('clmrs:update')],
  }),
  async (c) => {
    const { childId } = c.req.valid('param');
    const { status, followUpDate } = c.req.valid('json');
    const updated = await setClmrsCaseStatus(childId, status, followUpDate ?? null);
    if (!updated) return c.json({ error: 'CLMRS case not found' }, 404);
    return c.json(updated, 200);
  },
);
