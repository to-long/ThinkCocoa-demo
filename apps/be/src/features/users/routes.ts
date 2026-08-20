/**
 * Users CRUD + role assignment — HTTP wiring layer.
 *
 * Endpoints:
 *   GET    /api/users                      — paginated list (user:read)
 *   GET    /api/users/stats                — slim stats row (user:read)
 *   GET    /api/users/me                   — self profile (no extra perm)
 *   GET    /api/users/:id                  — detail incl. roles (user:read)
 *   POST   /api/users                      — create via better-auth (user:create)
 *   PATCH  /api/users/:id                  — update domain fields (user:update)
 *   DELETE /api/users/:id                  — soft delete (user:delete)
 *   POST   /api/users/:id/restore          — undo soft-delete (user:delete)
 *   PUT    /api/users/:id/roles            — replace role set (user:update)
 *   POST   /api/users/:id/cooperatives     — assign cooperative + scope (user:update)
 *
 * `email` updates are deliberately NOT exposed here — they flow through
 * better-auth's change-email mechanism so session consistency is preserved.
 *
 * Handlers do three things only: parse params/body, call into `./service`,
 * and `c.json` the result. DB access, better-auth integration, audit
 * writes, and the slim-stats LRU cache all live in `./service`.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import {
  assignCoopBody,
  assignCoopResponseSchema,
  createUserBody,
  errorResponse,
  listUsersQuery,
  setRolesBody,
  setRolesResponseSchema,
  updateUserBody,
  userCoreSchema,
  userDetailSchema,
  userListResponseSchema,
  userStatsSchema,
} from './schemas';
import {
  type Actor,
  assignCooperative,
  createUser,
  getUserStats,
  listUsers,
  loadUserProfile,
  restoreUser,
  setUserRoles,
  softDeleteUser,
  updateUser,
} from './service';

/**
 * Pull ip / user-agent / session-id off the request so the service can
 * call `writeAudit` without depending on hono. Mirrors the resolution
 * order in `lib/audit.ts` (X-Forwarded-For → X-Real-IP → socket addr,
 * stripping the IPv4-mapped IPv6 prefix).
 */
function buildActor(c: Context<AuthedContext>): Actor {
  const headers = c.req.raw.headers;
  let ip: string | null =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
  if (!ip) {
    try {
      const info = getConnInfo(c);
      const raw = info.remote.address ?? null;
      ip = raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
    } catch {
      // No underlying socket (tests via app.fetch). Leave null.
    }
  }
  return {
    id: c.get('user').id,
    ip,
    userAgent: headers.get('user-agent') ?? null,
    sessionId: c.get('sessionId') ?? null,
  };
}

export const usersRoutes = new OpenAPIHono<AuthedContext>({
  defaultHook: validationHook,
});

usersRoutes.use('/api/users/*', requireAuth);

// ── LIST ─────────────────────────────────────────────────────
usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/users',
    tags: ['Users'],
    request: { query: listUsersQuery },
    responses: {
      200: {
        description: 'Paginated users',
        content: { 'application/json': { schema: userListResponseSchema } },
      },
    },
    middleware: [requirePermission('user:read')],
  }),
  async (c) => {
    const result = await listUsers(c.req.valid('query'));
    return c.json(result, 200);
  },
);

// ── GET /api/users/stats ─────────────────────────────────────
// Slim stats row for the user list page (and whoever else wants a quick
// at-a-glance summary). Must be registered BEFORE `GET /api/users/{id}`
// so the UUID matcher doesn't try to parse `"stats"` as a path param.
usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/users/stats',
    tags: ['Users'],
    responses: {
      200: {
        description: 'User slim stats',
        content: { 'application/json': { schema: userStatsSchema } },
      },
    },
    middleware: [requirePermission('user:read')],
  }),
  async (c) => {
    const { payload, cacheHit } = await getUserStats();
    c.header('X-Cache', cacheHit ? 'HIT' : 'MISS');
    return c.json(payload, 200);
  },
);

// ── GET /api/users/me ────────────────────────────────────────
// Self-profile endpoint. Every authenticated user must be able to load
// their own profile + effective permissions — the FE bootstrap relies
// on it to hydrate `currentUser` / `currentUserPermissions` before any
// permission-gated route can render. Gating it behind `user:read` would
// lock field-tier roles out of the shell entirely.
//
// IMPORTANT: must be registered BEFORE `GET /api/users/{id}` — otherwise
// the `{id}` path-param matcher would try to parse `"me"` as a UUID and
// reject the request with a validation error before reaching this route.
usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/users/me',
    tags: ['Users'],
    responses: {
      200: {
        description: 'Current user detail',
        content: { 'application/json': { schema: userDetailSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const profile = await loadUserProfile(c.get('user').id);
    if (!profile) return c.json({ error: 'User not found' }, 404);
    // Never let a browser (heuristically) cache the self-profile: it
    // carries the user's live permission set that the FE bootstrap reads
    // to build the sidebar + route guards. A stale cached copy kept the
    // sidebar showing a pre-change permission set after a role/permission
    // update until a full re-login — exactly the CLMRS-menu-missing bug.
    c.header('Cache-Control', 'no-store');
    return c.json(profile, 200);
  },
);

// ── GET /api/users/{id} ──────────────────────────────────────
// Admin endpoint — reading someone else's profile. For the signed-in
// user's own profile, callers should hit `GET /api/users/me` instead;
// this route's permission gate is meant for admin surfaces.
usersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/users/{id}',
    tags: ['Users'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'User detail',
        content: { 'application/json': { schema: userDetailSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const profile = await loadUserProfile(id);
    if (!profile) return c.json({ error: 'User not found' }, 404);
    return c.json(profile, 200);
  },
);

// ── CREATE (via better-auth so password is hashed correctly) ────
usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/users',
    tags: ['Users'],
    request: {
      body: { content: { 'application/json': { schema: createUserBody } } },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: userDetailSchema } },
      },
      400: {
        description: 'Unknown role(s)',
        content: { 'application/json': { schema: errorResponse } },
      },
      409: {
        description: 'Email exists',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const result = await createUser(body, buildActor(c));
    if (!result.ok) {
      switch (result.reason) {
        case 'email-exists':
          return c.json({ error: `Email '${result.email}' already exists` }, 409);
        case 'unknown-roles':
          return c.json({ error: `Unknown roles: ${result.missing.join(', ')}` }, 400);
        case 'sign-up-failed':
          return c.json({ error: 'Sign-up failed' }, 409);
      }
    }
    return c.json(result.payload, 201);
  },
);

// ── UPDATE ───────────────────────────────────────────────────
usersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/users/{id}',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: updateUserBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: userCoreSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await updateUser(id, body, buildActor(c));
    if (!result.ok) {
      // 400 for empty patch (valid-but-empty payload) and unknown
      // role codes; 404 for missing row.
      if (result.reason === 'no-fields') {
        return c.json({ error: 'No fields to update' }, 400);
      }
      if (result.reason === 'unknown-roles') {
        return c.json({ error: `Unknown role(s): ${result.missing.join(', ')}` }, 400);
      }
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(result.payload, 200);
  },
);

// ── SOFT DELETE ──────────────────────────────────────────────
usersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/users/{id}',
    tags: ['Users'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Soft-deleted' },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: errorResponse } },
      },
      400: {
        description: 'Cannot delete self',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await softDeleteUser(id, buildActor(c));
    if (!result.ok) {
      if (result.reason === 'self') {
        return c.json({ error: 'Cannot delete yourself' }, 400);
      }
      return c.json({ error: 'User not found' }, 404);
    }
    return c.body(null, 204);
  },
);

// ── RESTORE (undo soft-delete) ───────────────────────────────
// Undoes a prior `DELETE /api/users/:id` — clears `deletedAt` / `deletedBy`
// and puts the account back into `active`. Gated on `user:delete` because
// the authority to un-delete is the same authority that can delete; no
// point splitting into a third permission. 404 if the row is missing
// entirely; 409 if the row is already live (not currently deleted) so
// callers don't silently no-op.
usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/users/{id}/restore',
    tags: ['Users'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: userDetailSchema } },
      },
      404: {
        description: 'User not found',
        content: { 'application/json': { schema: errorResponse } },
      },
      409: {
        description: 'Not deleted',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await restoreUser(id, buildActor(c));
    if (!result.ok) {
      if (result.reason === 'not-deleted') {
        return c.json({ error: 'User is not deleted' }, 409);
      }
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(result.payload, 200);
  },
);

// ── REPLACE ROLES ────────────────────────────────────────────
usersRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/users/{id}/roles',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: setRolesBody } } },
    },
    responses: {
      200: {
        description: 'Roles updated',
        content: { 'application/json': { schema: setRolesResponseSchema } },
      },
      400: {
        description: 'Unknown role(s)',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: {
        description: 'User not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await setUserRoles(id, body, buildActor(c));
    if (!result.ok) {
      if (result.reason === 'unknown-roles') {
        return c.json({ error: `Unknown roles: ${result.missing.join(', ')}` }, 400);
      }
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json({ userId: result.userId, roles: result.roles }, 200);
  },
);

// ── ASSIGN COOPERATIVE ───────────────────────────────────────
usersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/users/{id}/cooperatives',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: assignCoopBody } } },
    },
    responses: {
      201: {
        description: 'Assignment created / updated',
        content: {
          'application/json': { schema: assignCoopResponseSchema },
        },
      },
      404: {
        description: 'User or cooperative not found',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('user:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await assignCooperative(id, body, buildActor(c));
    if (!result.ok) {
      if (result.reason === 'user-not-found') {
        return c.json({ error: 'User not found' }, 404);
      }
      return c.json({ error: 'Cooperative not found' }, 404);
    }
    return c.json(
      {
        userId: result.userId,
        cooperativeId: result.cooperativeId,
        scope: result.scope,
        isPrimary: result.isPrimary,
      },
      201,
    );
  },
);
