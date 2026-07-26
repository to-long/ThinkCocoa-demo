/**
 * Roles CRUD + role-permission assignment (HTTP wiring layer).
 *
 * Endpoints:
 *   GET    /api/roles
 *   GET    /api/roles/stats
 *   GET    /api/roles/:id                      — includes grants
 *   POST   /api/roles
 *   PATCH  /api/roles/:id
 *   DELETE /api/roles/:id
 *   PUT    /api/roles/:id/permissions          — replace full grant list
 *
 * Per-route permissions (no more blanket `role:manage`):
 *   GET    /api/roles                  → roles:read
 *   GET    /api/roles/stats            → roles:read
 *   GET    /api/roles/:id              → roles:read
 *   POST   /api/roles                  → roles:create
 *   PATCH  /api/roles/:id              → roles:update
 *   DELETE /api/roles/:id              → roles:delete
 *   PUT    /api/roles/:id/permissions  → roles:update
 *
 * Handlers do three things only: parse query / body params, call into
 * `./service`, and `c.json` the result. Schemas live in `./schemas`,
 * DB queries + audit-write side effects in `./service`.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { parseBoolFlag } from '../../lib/query-flags';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import {
  createRoleBody,
  errorResponse,
  roleCoreSchema,
  roleDetailSchema,
  roleListResponseSchema,
  rolesListQuerySchema,
  rolesStatsSchema,
  setPermissionsBody,
  updateRoleBody,
} from './schemas';
import {
  type Actor,
  createRole,
  deleteRole,
  getRoleDetail,
  getRolesStats,
  listRoles,
  setRolePermissions,
  updateRole,
} from './service';

export const rolesRoutes = new OpenAPIHono<AuthedContext>({
  defaultHook: validationHook,
});

rolesRoutes.use('/api/roles/*', requireAuth);
// Per-route permission gates live on each `createRoute(...)` below — the
// old blanket `role:manage` gate is gone so read-only callers (e.g. the
// admin users dialog picking a role) don't need write authority.

/**
 * Extract the typed actor (id + connection metadata) from the Hono
 * context so the service layer never has to import `Context`. Mirrors
 * the IP-resolution priority used by `writeAudit`:
 *   1. `X-Forwarded-For` first hop
 *   2. `X-Real-IP`
 *   3. node-server conninfo socket address (IPv4-mapped IPv6 stripped)
 */
function actorFromContext(c: Context<AuthedContext>): Actor {
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
    id: c.get('user').id,
    ipAddress,
    userAgent: headers.get('user-agent') ?? null,
    sessionId: c.get('sessionId') ?? null,
  };
}

// ── LIST (paginated, with grant count) ──────────────────────
// `includePermissions=true` swaps every row to a `RoleDetail` shape
// (each row carries its permission codes inline). Saves the admin
// user-edit dialog from a per-role GET /:id fan-out.
rolesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/roles',
    tags: ['Roles'],
    request: { query: rolesListQuerySchema },
    responses: {
      200: {
        description: 'Paginated roles',
        content: { 'application/json': { schema: roleListResponseSchema } },
      },
    },
    middleware: [requirePermission('role:read')],
  }),
  async (c) => {
    const {
      page: pageStr,
      pageSize: pageSizeStr,
      q,
      includePermissions,
      sort,
    } = c.req.valid('query');
    const page = Math.max(1, Number(pageStr) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeStr) || 20));

    const result = await listRoles({
      q,
      includePermissions: parseBoolFlag(includePermissions),
      sort,
      page,
      pageSize,
    });
    return c.json(result, 200);
  },
);

// ── STATS ────────────────────────────────────────────────────
// Powers the slim stats row at the top of /admin/roles (Pencil
// `uYlw1`):
//   • Left card  — total role count + green "Active <N>" pill
//   • Right card — chip per role with its user count + permissions
//                  assigned/unassigned chips
//
// "Active" = roles that have at least one user assigned. A role with
// zero users is technically defined but unused, so we surface that as
// the inactive count.
//
// MUST sit before `GET /api/roles/{id}` so the regex router doesn't
// swallow `stats` as a uuid param.
rolesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/roles/stats',
    tags: ['Roles'],
    responses: {
      200: {
        description: 'Roles stats',
        content: { 'application/json': { schema: rolesStatsSchema } },
      },
    },
    middleware: [requirePermission('role:read')],
  }),
  async (c) => {
    const stats = await getRolesStats();
    return c.json(stats, 200);
  },
);

// ── GET (with permissions list) ──────────────────────────────
rolesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/roles/{id}',
    tags: ['Roles'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Role detail',
        content: { 'application/json': { schema: roleDetailSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('role:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const role = await getRoleDetail(id);
    if (!role) return c.json({ error: 'Role not found' }, 404);
    return c.json(role, 200);
  },
);

// ── CREATE ───────────────────────────────────────────────────
rolesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/roles',
    tags: ['Roles'],
    request: {
      body: { content: { 'application/json': { schema: createRoleBody } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: roleDetailSchema } },
      },
      409: {
        description: 'Code exists',
        content: { 'application/json': { schema: errorResponse } },
      },
      400: {
        description: 'Bad permission code(s)',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('role:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const result = await createRole(body, actorFromContext(c));
    if (result.kind === 'conflict') {
      return c.json({ error: `Role '${result.code}' already exists` }, 409);
    }
    if (result.kind === 'unknown-permissions') {
      return c.json({ error: `Unknown permissions: ${result.missing.join(', ')}` }, 400);
    }
    return c.json(result.role, 201);
  },
);

// ── UPDATE ───────────────────────────────────────────────────
rolesRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/roles/{id}',
    tags: ['Roles'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: updateRoleBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: roleCoreSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('role:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const role = await updateRole(id, body, actorFromContext(c));
    if (!role) return c.json({ error: 'Role not found' }, 404);
    return c.json(role, 200);
  },
);

// ── DELETE ───────────────────────────────────────────────────
rolesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/roles/{id}',
    tags: ['Roles'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Deleted' },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('role:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await deleteRole(id, actorFromContext(c));
    if (!result) return c.json({ error: 'Role not found' }, 404);
    return c.body(null, 204);
  },
);

// ── REPLACE PERMISSIONS ──────────────────────────────────────
rolesRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/roles/{id}/permissions',
    tags: ['Roles'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: setPermissionsBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: roleDetailSchema } },
      },
      400: {
        description: 'Unknown permission code(s)',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: {
        description: 'Role not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('role:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await setRolePermissions(id, body, actorFromContext(c));
    if (result.kind === 'not-found') {
      return c.json({ error: 'Role not found' }, 404);
    }
    if (result.kind === 'unknown-permissions') {
      return c.json({ error: `Unknown permissions: ${result.missing.join(', ')}` }, 400);
    }
    return c.json(result.role, 200);
  },
);
