/**
 * Training — HTTP wiring.
 *
 *   GET /api/training-sessions       — paginated list (training:read)
 *   GET /api/training-sessions/stats — stats card aggregates (training:read)
 *
 * Tenant-scoped to the active cooperative cookie.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { getTrainingSession, getTrainingStats, listTrainingSessions } from './service';

export const trainingRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

trainingRoutes.use('/api/training-sessions', requireAuth);
trainingRoutes.use('/api/training-sessions/*', requireAuth);
trainingRoutes.use('/api/training-sessions', requireActiveCoop);
trainingRoutes.use('/api/training-sessions/*', requireActiveCoop);

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
  programs: z.string().optional(),
  topics: z.string().optional(),
  societies: z.string().optional(),
  sort: z.string().optional(),
});

const listItem = z.object({
  id: z.string(),
  koboUuid: z.string(),
  trainingDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  program: z.string().nullable(),
  trainingType: z.string().nullable(),
  trainingTopics: z.array(z.string()).nullable(),
  participantCategory: z.string().nullable(),
  district: z.string().nullable(),
  society: z.string().nullable(),
  venue: z.string().nullable(),
  trainerName: z.string().nullable(),
  numMale: z.number().nullable(),
  numFemale: z.number().nullable(),
  totalParticipants: z.number().nullable(),
  consentCount: z.number().nullable(),
  consentRate: z.number().nullable(),
  participantEngagement: z.string().nullable(),
  submittedAt: z.string(),
});

const listResponse = z.object({
  items: z.array(listItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const statsResponse = z.object({
  totalSessions: z.number(),
  sessionsLast30Days: z.number(),
  totalParticipants: z.number(),
  uniqueFarmers: z.number(),
  avgAttendance: z.number().nullable(),
  consentRate: z.number().nullable(),
  programs: z.array(z.string()),
  topics: z.array(z.string()),
  societies: z.array(z.string()),
});

trainingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/training-sessions/stats',
    tags: ['Training'],
    responses: {
      200: { description: 'Stats', content: { 'application/json': { schema: statsResponse } } },
    },
    middleware: [requirePermission('training:read')],
  }),
  async (c) => {
    const stats = await getTrainingStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

const attendeeItem = z.object({
  id: z.string(),
  farmerId: z.string().nullable(),
  farmerCode: z.string(),
  farmerName: z.string().nullable(),
  gender: z.string().nullable(),
  cooperative: z.string().nullable(),
  phone: z.string().nullable(),
  consent: z.boolean(),
  signatureUrl: z.string().nullable(),
  isOrphan: z.boolean(),
});

const detailResponse = listItem.extend({
  formVersion: z.string(),
  koboId: z.number(),
  trainerPhone: z.string().nullable(),
  sessionObjectivesMet: z.boolean().nullable(),
  trainerRemarks: z.string().nullable(),
  trainerSignatureUrl: z.string().nullable(),
  snapshotUrl: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attendance: z.array(attendeeItem),
});

const errorResponse = z.object({ error: z.string() });

trainingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/training-sessions/{id}',
    tags: ['Training'],
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      200: { description: 'Detail', content: { 'application/json': { schema: detailResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('training:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getTrainingSession(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Training session not found' }, 404);
    return c.json(row, 200);
  },
);

trainingRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/training-sessions',
    tags: ['Training'],
    request: { query: listQuery },
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('training:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const result = await listTrainingSessions({
      activeCoopId: c.get('activeCoopId'),
      q: q.q,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      programs: splitCsv(q.programs),
      topics: splitCsv(q.topics),
      societies: splitCsv(q.societies),
      page,
      pageSize,
      sort: q.sort,
    });
    return c.json(result, 200);
  },
);
