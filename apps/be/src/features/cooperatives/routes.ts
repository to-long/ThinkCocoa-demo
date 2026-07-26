/**
 * Cooperatives — admin CRUD (HTTP wiring layer).
 *
 * Endpoints (all gated on the `cooperative:*` resource):
 *   GET    /api/cooperatives           — list (cooperative:read)
 *   GET    /api/cooperatives/:id       — detail (cooperative:read)
 *   POST   /api/cooperatives           — create (cooperative:create)
 *   PATCH  /api/cooperatives/:id       — update (cooperative:update)
 *   DELETE /api/cooperatives/:id       — soft delete (cooperative:delete)
 *
 * Handlers do three things only: parse the request, call into
 * `./service`, and `c.json` the result through
 * `./projection.toCooperativeResponse`. Schemas live in `./schemas`,
 * DB queries + audit writes live in `./service`.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { parseBoolFlag } from '../../lib/query-flags';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { toCooperativeResponse } from './projection';
import {
  cooperativeCoreSchema,
  cooperativeIdParamSchema,
  cooperativeListQuerySchema,
  cooperativeListResponseSchema,
  cooperativeMemberParamSchema,
  cooperativeMembersResponseSchema,
  createCooperativeBodySchema,
  errorResponse,
  updateCooperativeBodySchema,
} from './schemas';
import {
  type AuditActor,
  createCooperative,
  getCooperative,
  listCooperativeMembers,
  listCooperatives,
  removeCooperativeMember,
  restoreCooperative,
  softDeleteCooperative,
  updateCooperative,
} from './service';

export const cooperativesRoutes = new OpenAPIHono<AuthedContext>({
  defaultHook: validationHook,
});

cooperativesRoutes.use('/api/cooperatives', requireAuth);
cooperativesRoutes.use('/api/cooperatives/*', requireAuth);

/**
 * Pull request-scoped fields the audit writer needs (IP, user-agent,
 * session id) out of the Hono context so the service stays Hono-free.
 *
 * Mirrors the resolution order in `lib/audit.ts`:
 *   1. `X-Forwarded-For` first hop
 *   2. `X-Real-IP`
 *   3. node-server conninfo socket address (works without proxy
 *      headers — covers `bun test` via app.fetch + bare localhost
 *      dev). IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is stripped.
 */
function actorFromContext(c: Context<AuthedContext>): AuditActor {
  const user = c.get('user');
  const headers = c.req.raw.headers;
  let ipAddress: string | null =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
  if (!ipAddress) {
    try {
      const info = getConnInfo(c);
      const raw = info.remote.address ?? null;
      ipAddress = raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
    } catch {
      // getConnInfo throws when there's no underlying socket
      // (e.g. tests via `app.fetch(new Request(...))`). Leave
      // ipAddress null and let the metadata reflect that.
    }
  }
  return {
    id: user.id,
    ipAddress,
    userAgent: headers.get('user-agent') ?? null,
    sessionId: c.get('sessionId') ?? null,
  };
}

// ── LIST ─────────────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/cooperatives',
    tags: ['Cooperatives'],
    request: { query: cooperativeListQuerySchema },
    responses: {
      200: {
        description: 'Cooperatives list',
        content: {
          'application/json': { schema: cooperativeListResponseSchema },
        },
      },
    },
    middleware: [requirePermission('cooperative:read')],
  }),
  async (c) => {
    const { q, includeDeleted, page: pageStr, pageSize: pageSizeStr } = c.req.valid('query');
    const page = Math.max(1, Number(pageStr) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeStr) || 20));
    const result = await listCooperatives({
      q,
      includeDeleted: parseBoolFlag(includeDeleted),
      page,
      pageSize,
    });
    return c.json(
      {
        data: result.rows.map(toCooperativeResponse),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
      200,
    );
  },
);

// ── DETAIL ───────────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/cooperatives/{id}',
    tags: ['Cooperatives'],
    request: { params: cooperativeIdParamSchema },
    responses: {
      200: {
        description: 'Cooperative detail',
        content: { 'application/json': { schema: cooperativeCoreSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getCooperative(id);
    if (!row) return c.json({ error: 'Cooperative not found' }, 404);
    return c.json(toCooperativeResponse(row), 200);
  },
);

// ── CREATE ───────────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/cooperatives',
    tags: ['Cooperatives'],
    request: {
      body: {
        content: { 'application/json': { schema: createCooperativeBodySchema } },
      },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: cooperativeCoreSchema } },
      },
      409: {
        description: 'Code conflict',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const result = await createCooperative(body, actorFromContext(c));
    if (result.kind === 'code-conflict') {
      return c.json({ error: `Code '${result.code}' already exists` }, 409);
    }
    return c.json(toCooperativeResponse(result.row), 201);
  },
);

// ── UPDATE ───────────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/cooperatives/{id}',
    tags: ['Cooperatives'],
    request: {
      params: cooperativeIdParamSchema,
      body: {
        content: { 'application/json': { schema: updateCooperativeBodySchema } },
      },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: cooperativeCoreSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
      409: {
        description: 'Code conflict',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await updateCooperative(id, body, actorFromContext(c));
    if (result.kind === 'code-conflict') {
      return c.json({ error: `Code '${result.code}' already exists` }, 409);
    }
    if (result.kind === 'not-found') {
      return c.json({ error: 'Cooperative not found' }, 404);
    }
    return c.json(toCooperativeResponse(result.row), 200);
  },
);

// ── MEMBERS (users with explicit access) ─────────────────────
// Lists users with a row in `user_cooperative_assignments` for this
// coop. Org-wide admins (access via `users.is_all_cooperative`) are
// NOT included — there's nothing to un-assign on them.
cooperativesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/cooperatives/{id}/users',
    tags: ['Cooperatives'],
    request: { params: cooperativeIdParamSchema },
    responses: {
      200: {
        description: 'Users with explicit assignment to this cooperative',
        content: {
          'application/json': { schema: cooperativeMembersResponseSchema },
        },
      },
      404: {
        description: 'Cooperative not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const coop = await getCooperative(id);
    if (!coop) return c.json({ error: 'Cooperative not found' }, 404);
    const data = await listCooperativeMembers(id);
    return c.json({ data }, 200);
  },
);

// Remove ONE user's assignment to this cooperative. Gated by
// `user:update` since the mutation lives on the user side
// (`iam.user_cooperative_assignments`); the FE surfaces it from the
// coop detail for convenience but the underlying right is the same.
cooperativesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/cooperatives/{id}/users/{userId}',
    tags: ['Cooperatives'],
    request: { params: cooperativeMemberParamSchema },
    responses: {
      204: { description: 'Assignment removed' },
      404: {
        description: 'Assignment not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:update')],
  }),
  async (c) => {
    const { id, userId } = c.req.valid('param');
    const result = await removeCooperativeMember(id, userId, actorFromContext(c));
    if (result.kind === 'not-found') {
      return c.json({ error: 'Assignment not found' }, 404);
    }
    return c.body(null, 204);
  },
);

// ── SOFT DELETE ──────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/cooperatives/{id}',
    tags: ['Cooperatives'],
    request: { params: cooperativeIdParamSchema },
    responses: {
      204: { description: 'Soft-deleted (cascades to farmers + parcels)' },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await softDeleteCooperative(id, actorFromContext(c));
    if (result.kind === 'not-found') {
      return c.json({ error: 'Cooperative not found' }, 404);
    }
    return c.body(null, 204);
  },
);

// ── RESTORE ──────────────────────────────────────────────────
cooperativesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/cooperatives/{id}/restore',
    tags: ['Cooperatives'],
    request: { params: cooperativeIdParamSchema },
    responses: {
      204: { description: 'Restored (cascades to cascade-deleted farmers + parcels)' },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      409: {
        description: 'Cooperative is not deleted',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('cooperative:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await restoreCooperative(id, actorFromContext(c));
    if (result.kind === 'not-found') return c.json({ error: 'Cooperative not found' }, 404);
    if (result.kind === 'not-deleted') {
      return c.json({ error: 'Cooperative is not deleted' }, 409);
    }
    return c.body(null, 204);
  },
);
