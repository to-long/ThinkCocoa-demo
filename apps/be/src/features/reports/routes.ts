/**
 * Reports — HTTP wiring.
 *
 *   POST /api/reports/run                     — enqueue (report:export)
 *   GET  /api/reports/runs                    — history (report:read)
 *   GET  /api/reports/runs/{id}               — poll one (report:read)
 *   GET  /api/reports/runs/{id}/download      — 302 → presigned URL
 *
 * All routes are tenant-scoped via the active-coop cookie. Permissions
 * `report:export` and `report:read` already exist in the catalog.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { readReportFile } from '../../lib/reports-storage';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import {
  enqueueReport,
  getRunFile,
  getRunStatus,
  listReportSocieties,
  listRuns,
  type ReportCode,
  type ReportFormat,
} from './service';

export const reportsRoutes = new OpenAPIHono<ActiveCoopContext>({
  defaultHook: validationHook,
});

reportsRoutes.use('/api/reports', requireAuth);
reportsRoutes.use('/api/reports/*', requireAuth);
reportsRoutes.use('/api/reports', requireActiveCoop);
reportsRoutes.use('/api/reports/*', requireActiveCoop);

// ── Schemas ────────────────────────────────────────────────────

const SUPPORTED_REPORT_CODES = [
  'farmer_coaching_v3',
  'traceability_report',
  'certification_status',
  'corrective_actions',
  'gmr_template',
  'eudr_compliance',
  'training_attendance',
] as const;
const SUPPORTED_FORMATS = ['excel', 'csv', 'pdf'] as const;

const runBody = z.object({
  reportCode: z.enum(SUPPORTED_REPORT_CODES),
  outputFormat: z.enum(SUPPORTED_FORMATS),
  parameters: z
    .object({
      // Legacy season string (e.g. `"2024/25"`). Kept for backwards
      // compat with runs pre-dating the date-range rollout.
      season: z.string().min(1).optional(),
      // ISO date strings — inclusive lower / upper bound of the report
      // window. Supersedes `season` when both are present.
      dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom must be YYYY-MM-DD')
        .optional(),
      dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo must be YYYY-MM-DD')
        .optional(),
      districtId: z.string().nullable().optional(),
      societyId: z.string().nullable().optional(),
      fieldOfficerUserId: z.string().nullable().optional(),
    })
    .refine((p) => p.season || (p.dateFrom && p.dateTo), {
      message: 'parameters must include either `season` or both `dateFrom` and `dateTo`',
    }),
});

const fileSchema = z
  .object({
    storageKey: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  })
  .nullable();

const runSummary = z.object({
  id: z.string(),
  reportCode: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  outputFormat: z.string(),
  parameters: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  generatedAt: z.string().nullable(),
  createdAt: z.string(),
  file: fileSchema,
});

const enqueueResponse = z.object({ runId: z.string(), status: z.literal('queued') });
const listResponse = z.object({ items: z.array(runSummary) });
const societiesResponse = z.object({ items: z.array(z.string()) });
const errorResponse = z.object({ error: z.string() });

// ── Routes ─────────────────────────────────────────────────────

reportsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/reports/run',
    tags: ['Reports'],
    request: { body: { content: { 'application/json': { schema: runBody } } } },
    responses: {
      202: {
        description: 'Run enqueued',
        content: { 'application/json': { schema: enqueueResponse } },
      },
    },
    middleware: [requirePermission('report:export')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user');
    const result = await enqueueReport({
      reportCode: body.reportCode as ReportCode,
      outputFormat: body.outputFormat as ReportFormat,
      parameters: {
        season: body.parameters.season,
        dateFrom: body.parameters.dateFrom ?? null,
        dateTo: body.parameters.dateTo ?? null,
        districtId: body.parameters.districtId ?? null,
        societyId: body.parameters.societyId ?? null,
        fieldOfficerUserId: body.parameters.fieldOfficerUserId ?? null,
      },
      requestedByUserId: user.id,
      cooperativeId: c.get('activeCoopId'),
    });
    return c.json({ runId: result.runId, status: 'queued' as const }, 202);
  },
);

reportsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/reports/runs',
    tags: ['Reports'],
    request: {
      query: z.object({
        reportCode: z.string().optional(),
        limit: z.string().optional(),
      }),
    },
    responses: {
      200: { description: 'History', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('report:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const items = await listRuns({
      cooperativeId: c.get('activeCoopId'),
      reportCode: q.reportCode,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return c.json({ items }, 200);
  },
);

reportsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/reports/societies',
    tags: ['Reports'],
    request: {
      query: z.object({ reportCode: z.enum(SUPPORTED_REPORT_CODES) }),
    },
    responses: {
      200: {
        description: 'Distinct societies for this report type',
        content: { 'application/json': { schema: societiesResponse } },
      },
    },
    middleware: [requirePermission('report:read')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const items = await listReportSocieties({
      cooperativeId: c.get('activeCoopId'),
      reportCode: q.reportCode,
    });
    return c.json({ items }, 200);
  },
);

reportsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/reports/runs/{id}',
    tags: ['Reports'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: { description: 'Run', content: { 'application/json': { schema: runSummary } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('report:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const run = await getRunStatus(id, c.get('activeCoopId'));
    if (!run) return c.json({ error: 'Report run not found' }, 404);
    return c.json(run, 200);
  },
);

reportsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/reports/runs/{id}/download',
    tags: ['Reports'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: { description: 'Report file bytes (attachment)' },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('report:export')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const file = await getRunFile(id, c.get('activeCoopId'));
    if (!file) return c.json({ error: 'Report file not found' }, 404);
    // Demo: files live on local disk (no Spaces), so stream the bytes back
    // directly as an attachment instead of redirecting to a presigned URL.
    const bytes = await readReportFile(file.storageKey);
    if (!bytes) return c.json({ error: 'Report file not found' }, 404);
    c.header('Content-Type', file.mimeType);
    c.header('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    // Buffer → a standalone ArrayBuffer (Hono's c.body doesn't type Node Buffer).
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return c.body(ab as ArrayBuffer);
  },
);
