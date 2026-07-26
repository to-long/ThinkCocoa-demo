/**
 * Audit log — read-only admin endpoints (HTTP wiring layer).
 *
 * Endpoints (all gated on any `:notification` perm):
 *   GET /api/audit-logs           — paginated list with filters
 *   GET /api/audit-logs/stats     — slim stats row (totals + by status + by scope)
 *   GET /api/audit-logs/:id       — single event incl. entity_changes
 *
 * Handlers do three things only: parse query params, call into
 * `./service`, and `c.json` the result through `./projection.toRowResponse`.
 * Schemas live in `./schemas`, DB queries in `./service`.
 *
 * No mutation endpoints: audit log is append-only and writes are
 * triggered by domain mutations (a follow-up integration). The seed
 * file `db/seed/audit-logs.ts` populates demo data when
 * `SEED_AUDIT_LOGS=true`.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { userCooperativeAssignments } from '../../db/schema/iam';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermissionSuffix } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { resourceFromEntityTable } from '../notifications/service';
import { toRowResponse } from './projection';
import {
  auditListQuerySchema,
  auditLogDetailSchema,
  auditLogListResponseSchema,
  auditLogStatsSchema,
  auditStatsQuerySchema,
  errorResponse,
  STATUS_VALUES,
} from './schemas';
import { getAuditLogChanges, getAuditLogRow, getAuditLogStats, listAuditLogs } from './service';

export const auditRoutes = new OpenAPIHono<AuthedContext>({
  defaultHook: validationHook,
});

auditRoutes.use('/api/audit-logs', requireAuth);
auditRoutes.use('/api/audit-logs/*', requireAuth);

// ── LIST ─────────────────────────────────────────────────────
auditRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/audit-logs',
    tags: ['Audit'],
    request: { query: auditListQuerySchema },
    responses: {
      200: {
        description: 'Audit log list',
        content: { 'application/json': { schema: auditLogListResponseSchema } },
      },
    },
    middleware: [requirePermissionSuffix(':notification')],
  }),
  async (c) => {
    const q = c.req.valid('query');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));

    // entityTable / action / status accept comma-separated lists so
    // the FE multi-select can stuff several filters into one param.
    const splitCsv = (raw: string | undefined): string[] =>
      raw
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const entityTables = splitCsv(q.entityTable);
    const actions = splitCsv(q.action);
    // Coop scope — intersect any caller-supplied `cooperativeId`
    // CSV with the user's accessible coops so a tampered URL or
    // stale cookie can't list rows for a coop the user doesn't
    // belong to. Org-wide users (`is_all_cooperative`) bypass the
    // intersection. When the caller asks for nothing explicitly,
    // pass empty so `listAuditLogs` falls back to its no-filter
    // behaviour (still bounded by `scopeResources`).
    const user = c.get('user');
    const requested = splitCsv(q.cooperativeId);
    let cooperativeIds: string[] = [];
    if (user.isAllCooperative) {
      cooperativeIds = requested;
    } else if (requested.length > 0) {
      const accessible = new Set(
        (
          await db
            .select({ id: userCooperativeAssignments.cooperativeId })
            .from(userCooperativeAssignments)
            .where(eq(userCooperativeAssignments.userId, user.id))
        ).map((r) => r.id),
      );
      cooperativeIds = requested.filter((id) => accessible.has(id));
    }
    // Drop unknown statuses silently — admins might have stale URL
    // state from a deploy that changed the enum.
    const statuses = splitCsv(q.status).filter((s): s is (typeof STATUS_VALUES)[number] =>
      (STATUS_VALUES as readonly string[]).includes(s),
    );

    // Clamp days to [1, 365] so a typo can't trigger a full-table scan.
    const daysNum = q.days != null ? Number(q.days) : NaN;
    const daysClamped =
      Number.isFinite(daysNum) && daysNum > 0
        ? Math.min(365, Math.max(1, Math.floor(daysNum)))
        : undefined;

    // Restrict the result set to resources the caller can subscribe
    // to via a `:notification` permission. This is what the page
    // semantically *is* — a notification feed — so admins seeing
    // audit-only rows would be a perm leak.
    const perms = c.get('permissions');
    const scopeResources: string[] = [];
    for (const code of perms) {
      if (code.endsWith(':notification')) {
        scopeResources.push(code.slice(0, -':notification'.length));
      }
    }

    const result = await listAuditLogs({
      q: q.q,
      actorId: q.actorId,
      entityId: q.entityId,
      entityTables,
      cooperativeIds,
      actions,
      statuses,
      daysClamped,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page,
      pageSize,
      sort: q.sort,
      scopeResources,
    });

    return c.json(
      {
        data: result.rows.map((r) => toRowResponse(r, result.changesById.get(r.id) ?? null)),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
      200,
    );
  },
);

// ── STATS ────────────────────────────────────────────────────
// Powers the slim stats row at the top of the list page. Window
// defaults to 30 days but is overridable via `?days=` so a future
// "last 7 days" toggle is one query change away.
auditRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/audit-logs/stats',
    tags: ['Audit'],
    request: { query: auditStatsQuerySchema },
    responses: {
      200: {
        description: 'Audit log stats',
        content: { 'application/json': { schema: auditLogStatsSchema } },
      },
    },
    middleware: [requirePermissionSuffix(':notification')],
  }),
  async (c) => {
    const { days } = c.req.valid('query');
    const windowDays = Math.max(1, Math.min(365, Number(days) || 30));
    const stats = await getAuditLogStats(windowDays);
    return c.json(stats, 200);
  },
);

// ── DETAIL ───────────────────────────────────────────────────
auditRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/audit-logs/{id}',
    tags: ['Audit'],
    request: {
      params: z.object({
        id: z.string().regex(/^\d+$/, 'Audit log id must be numeric'),
      }),
    },
    responses: {
      200: {
        description: 'Audit log detail',
        content: { 'application/json': { schema: auditLogDetailSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermissionSuffix(':notification')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    // Two-step fetch so the perm-check fires BEFORE the
    // entity_changes query — avoids a side-channel where a
    // non-eligible caller can tell "row exists" from "row missing"
    // by measuring response latency. Both code paths now run a
    // single SELECT (the row lookup) before deciding.
    const row = await getAuditLogRow(Number(id));
    if (!row) return c.json({ error: 'Audit log not found' }, 404);

    // Resource-scope guard — return 404 (not 403) so non-eligible
    // viewers can't probe the audit_logs id space for the existence
    // of rows they can't see.
    const perms = c.get('permissions');
    // Plural entity_table → singular resource. Use the shared
    // `resourceFromEntityTable` so any new entity_table (e.g.
    // `sync_settings`) doesn't have to be added in two places — this
    // route's inline map drifted before and dropped the bell row +
    // returned 404 for sync detail pages.
    const resource = resourceFromEntityTable(row.entityTable);
    if (!resource || !perms.has(`${resource}:notification`)) {
      return c.json({ error: 'Audit log not found' }, 404);
    }

    // Caller is eligible — fetch entity_changes only now, after the
    // perm gate.
    const changes = await getAuditLogChanges(Number(id));
    return c.json({ ...toRowResponse(row), changes }, 200);
  },
);
