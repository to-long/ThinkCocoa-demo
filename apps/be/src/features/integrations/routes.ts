/**
 * Integration — HTTP wiring (sync SETTINGS only).
 *
 *   GET   /api/integrations/sync-settings            — list (sync:config)
 *   GET   /api/integrations/sync-settings/:jobKey    — one
 *   PATCH /api/integrations/sync-settings/:jobKey    — save settings
 *   POST  /api/integrations/reset-demo-data          — wipe + re-seed (sync:reset)
 *
 * The Kobo run job (`POST …/run`) and the sync engine/scheduler were
 * removed — the demo's data is seeded, not synced.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { db } from '../../db/client';
import { writeAudit } from '../../lib/audit';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { resetDemoData } from './reset-demo-data';
import { getSyncSettings, listSyncSettings, updateSyncSettings } from './service';

export const integrationsRoutes = new OpenAPIHono<AuthedContext>({
  defaultHook: validationHook,
});

integrationsRoutes.use('/api/integrations/*', requireAuth);

const settingsSchema = z.object({
  id: z.string(),
  jobKey: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  sourceUrl: z.string(),
  fieldMapping: z.record(z.string(), z.unknown()),
  autoSyncEnabled: z.boolean(),
  intervalMinutes: z.number(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunSummary: z.unknown(),
  snapshotHash: z.string().nullable(),
  snapshotUploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const listResponse = z.object({ items: z.array(settingsSchema) });
const errorResponse = z.object({ error: z.string() });
const updateBody = z.object({
  label: z.string().optional(),
  description: z.string().nullable().optional(),
  sourceUrl: z.string().url().optional(),
  fieldMapping: z.record(z.string(), z.unknown()).optional(),
  autoSyncEnabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(1).max(43200).optional(),
});

integrationsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/integrations/sync-settings',
    tags: ['Integrations'],
    responses: {
      200: { description: 'List', content: { 'application/json': { schema: listResponse } } },
    },
    middleware: [requirePermission('sync:config')],
  }),
  async (c) => c.json({ items: await listSyncSettings() }, 200),
);

integrationsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/integrations/sync-settings/{jobKey}',
    tags: ['Integrations'],
    request: { params: z.object({ jobKey: z.string() }) },
    responses: {
      200: { description: 'One', content: { 'application/json': { schema: settingsSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('sync:config')],
  }),
  async (c) => {
    const row = await getSyncSettings(c.req.valid('param').jobKey);
    if (!row) return c.json({ error: 'Sync settings not found' }, 404);
    return c.json(row, 200);
  },
);

integrationsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/integrations/sync-settings/{jobKey}',
    tags: ['Integrations'],
    request: {
      params: z.object({ jobKey: z.string() }),
      body: { required: true, content: { 'application/json': { schema: updateBody } } },
    },
    responses: {
      200: { description: 'Updated', content: { 'application/json': { schema: settingsSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('sync:config')],
  }),
  async (c) => {
    const row = await updateSyncSettings(c.req.valid('param').jobKey, c.req.valid('json'));
    if (!row) return c.json({ error: 'Sync settings not found' }, 404);
    return c.json(row, 200);
  },
);

// ── RESET DEMO DATA ──────────────────────────────────────────────
// Destructive: truncates every operational schema, then re-seeds. Gated
// on its own permission (`sync:reset`, system_admin only) rather than
// `sync:config` so read/edit access to the sync page doesn't imply the
// ability to wipe the database.
const resetSummarySchema = z.object({
  tablesTruncated: z.number().int(),
  undeleted: z.object({
    users: z.number().int(),
    cooperatives: z.number().int(),
  }),
  durationMs: z.number().int(),
  counts: z.object({
    farmers: z.number().int(),
    parcels: z.number().int(),
    geometries: z.number().int(),
    eudr: z.number().int(),
    inspections: z.number().int(),
    correctiveActions: z.number().int(),
    coaching: z.number().int(),
    clmrsRemediation: z.number().int(),
    training: z.number().int(),
    purchases: z.number().int(),
    primaryLots: z.number().int(),
    secondaryLots: z.number().int(),
    vslaGroups: z.number().int(),
    cooperatives: z.number().int(),
    users: z.number().int(),
    rolePermissions: z.number().int(),
    auditLogs: z.number().int(),
  }),
});

integrationsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/integrations/reset-demo-data',
    tags: ['Integrations'],
    responses: {
      200: {
        description: 'Wipe + re-seed summary',
        content: { 'application/json': { schema: resetSummarySchema } },
      },
      500: {
        description: 'Reset failed — see `error`',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('sync:reset')],
  }),
  async (c) => {
    const user = c.get('user');
    let summary: Awaited<ReturnType<typeof resetDemoData>>;
    try {
      summary = await resetDemoData(db);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Reset failed' }, 500);
    }

    // Written AFTER the reset on purpose — `audit.audit_logs` is one of
    // the truncated tables, so an entry written before the wipe would be
    // erased by the very operation it records.
    await writeAudit({
      actorUserId: user.id,
      entitySchema: 'integration',
      entityTable: 'sync_settings',
      action: 'reset',
      summary: `${user.name ?? user.email} reset all demo data (${summary.counts.farmers} farmers, ${summary.counts.parcels} parcels re-seeded)`,
      metadata: { ...summary },
      ctx: c,
    });

    return c.json(summary, 200);
  },
);
