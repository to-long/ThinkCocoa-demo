/**
 * Permissions CRUD — HTTP wiring layer.
 *
 * Permissions are mostly static (managed by migrations / seeds). This API
 * exists so the admin UI can list them and create one-off entries when a
 * new resource is introduced mid-cycle.
 *
 * Gated by the `permissions:*` resource — separate from `roles:*` so a
 * "role manager" can assign existing permissions to roles without also
 * having authority to mint new permission codes or delete entries from
 * the underlying catalog. Per-route:
 *   GET    /api/permissions[...]     → permissions:read
 *   POST   /api/permissions           → permissions:create
 *   POST   /api/permissions/groups    → permissions:create
 *   PATCH  /api/permissions/:id       → permissions:update
 *   DELETE /api/permissions/:id       → permissions:delete
 *
 * Handlers do three things only: parse params/body, call into
 * `./service`, and `c.json` the result through `./projection.toRowResponse`.
 * Schemas live in `./schemas`, DB queries + audit writes in `./service`.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { toRowResponse } from './projection';
import {
  createPermissionBody,
  createPermissionGroupsBody,
  errorResponse,
  permissionGroupsListQuerySchema,
  permissionGroupsPageSchema,
  permissionGroupsResultSchema,
  permissionSchema,
  permissionsStatsSchema,
  setPermissionGroupActionsBody,
  setPermissionGroupActionsResultSchema,
  updatePermissionBody,
} from './schemas';
import {
  type Actor,
  createPermission,
  createPermissionGroups,
  deletePermission,
  deletePermissionGroup,
  getPermission,
  getPermissionsStats,
  listPermissionGroups,
  listPermissions,
  setPermissionGroupActions,
  updatePermission,
} from './service';

export const permissionsRoutes = new OpenAPIHono<AuthedContext>({ defaultHook: validationHook });

permissionsRoutes.use('/api/permissions/*', requireAuth);
// Per-route permission gates live on each `createRoute(...)` below. The old
// blanket gate was `role:manage | user:manage`; we now scope each method to
// the matching `permissions:*` CRUD permission so the catalog is managed
// independently of roles.

/**
 * Pull the actor envelope (id + transport metadata) out of the Hono
 * context so the service layer can record audit rows without having
 * to import Hono. Mirrors the IP-resolution priority that `writeAudit`
 * applies internally — kept in sync so the JSONB shape on disk doesn't
 * change after this refactor.
 */
function extractActor(c: Context<AuthedContext>): Actor {
  const headers = c.req.raw.headers;
  // IP resolution priority:
  //   1. `X-Forwarded-For` first hop (set by reverse proxy / dev
  //      proxy when `xfwd` is on)
  //   2. `X-Real-IP` (alternate proxy header)
  //   3. node-server conninfo socket address (works without any
  //      proxy headers — covers `bun test` via app.fetch + bare
  //      localhost dev). IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is
  //      stripped so the value matches the X-Forwarded-For format.
  let ip: string | null =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
  if (!ip) {
    try {
      const info = getConnInfo(c);
      const raw = info.remote.address ?? null;
      ip = raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
    } catch {
      // getConnInfo throws when there's no underlying socket
      // (e.g. tests via `app.fetch(new Request(...))`). Leave
      // ip null and let the metadata reflect that.
    }
  }
  return {
    id: c.get('user').id,
    ip,
    userAgent: headers.get('user-agent') ?? null,
    sessionId: c.get('sessionId') ?? null,
  };
}

// ── LIST ─────────────────────────────────────────────────────
permissionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/permissions',
    tags: ['Permissions'],
    responses: {
      200: {
        description: 'All permissions',
        content: { 'application/json': { schema: z.array(permissionSchema) } },
      },
    },
    middleware: [requirePermission('permission:read')],
  }),
  async (c) => {
    const rows = await listPermissions();
    return c.json(
      rows.map((r) => toRowResponse(r)),
      200,
    );
  },
);

// ── STATS ────────────────────────────────────────────────────
// Powers the slim stats row at the top of /admin/permissions (Pencil
// `GYxeF`):
//   • Left card  — total permission count + "<N> Groups" pill
//   • Right card — chip per action verb across all permissions
//
// Like every other `/.../stats` route on the BE, this MUST be
// declared before any `:id`-style route so the regex router doesn't
// swallow `stats` into the param.
permissionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/permissions/stats',
    tags: ['Permissions'],
    responses: {
      200: {
        description: 'Permissions stats',
        content: { 'application/json': { schema: permissionsStatsSchema } },
      },
    },
    middleware: [requirePermission('permission:read')],
  }),
  async (c) => {
    const stats = await getPermissionsStats();
    return c.json(stats, 200);
  },
);

// ── LIST PERMISSION GROUPS (paginated, grouped by resource) ─
//
// NOTE: this route must be registered BEFORE `GET /api/permissions/{id}` —
// otherwise the `{id}` path param swallows the literal `groups` segment
// and the router dispatches the wrong handler.
permissionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/permissions/groups',
    tags: ['Permissions'],
    request: { query: permissionGroupsListQuerySchema },
    responses: {
      200: {
        description: 'Paginated permission groups',
        content: { 'application/json': { schema: permissionGroupsPageSchema } },
      },
    },
    middleware: [requirePermission('permission:read')],
  }),
  async (c) => {
    const { page: pageStr, pageSize: pageSizeStr, q, sort } = c.req.valid('query');
    const page = Math.max(1, Number(pageStr) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeStr) || 10));

    const result = await listPermissionGroups({ page, pageSize, q, sort });
    return c.json(result, 200);
  },
);

// ── GET ──────────────────────────────────────────────────────
permissionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/permissions/{id}',
    tags: ['Permissions'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Permission',
        content: { 'application/json': { schema: permissionSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('permission:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getPermission(id);
    if (!row) return c.json({ error: 'Permission not found' }, 404);
    return c.json(toRowResponse(row), 200);
  },
);

// ── CREATE ───────────────────────────────────────────────────
permissionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/permissions',
    tags: ['Permissions'],
    request: {
      body: {
        content: { 'application/json': { schema: createPermissionBody } },
      },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: permissionSchema } },
      },
      409: {
        description: 'Code already exists',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('permission:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const result = await createPermission(body, extractActor(c));
    if (result.status === 'conflict') {
      return c.json({ error: `Permission '${result.code}' already exists` }, 409);
    }
    return c.json(toRowResponse(result.row), 201);
  },
);

// ── BATCH CREATE (GROUPED BY RESOURCE) ──────────────────────
// Accepts `{ resource: [action, action, ...] }` and reassembles them into
// `resource:action` codes. Idempotent per code (ON CONFLICT DO NOTHING).
// Returns which codes were created fresh vs which already existed, so the
// caller can feed the UI without making an extra list query.
permissionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/permissions/groups',
    tags: ['Permissions'],
    request: {
      body: {
        content: { 'application/json': { schema: createPermissionGroupsBody } },
      },
    },
    responses: {
      201: {
        description: 'Created (and/or already-existing) permissions',
        content: {
          'application/json': { schema: permissionGroupsResultSchema },
        },
      },
      409: {
        description: 'Every submitted permission already exists',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('permission:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const result = await createPermissionGroups(body, extractActor(c));
    if (result.status === 'conflict') {
      // Plural form — the BE fans a single resource into several
      // `resource:action` rows and the conflict is "all of them
      // already exist", not just one.
      return c.json(
        {
          error: `Permission group already exists: ${result.existed.join(', ')}`,
        },
        409,
      );
    }
    return c.json(
      {
        created: result.created.map((r) => toRowResponse(r)),
        existed: result.existed,
      },
      201,
    );
  },
);

// ── SET GROUP STATE (edit-group) ─────────────────────────────
// "Set the group's actions to exactly this list" — BE figures out
// add + remove diffs and writes a SINGLE audit row capturing both.
// Replaces the FE's old "create-then-loop-delete" edit flow which
// produced one audit entry for adds plus one per removed action.
permissionsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/permissions/groups/{resource}',
    tags: ['Permissions'],
    request: {
      params: z.object({ resource: z.string().min(1) }),
      body: {
        content: {
          'application/json': { schema: setPermissionGroupActionsBody },
        },
      },
    },
    responses: {
      200: {
        description: 'Group actions updated',
        content: {
          'application/json': { schema: setPermissionGroupActionsResultSchema },
        },
      },
    },
    // Edits can both create AND delete permissions, so require both
    // capabilities. Admins with only `permissions:create` are not
    // expected to be able to remove rows from a group.
    middleware: [requirePermission('permission:create'), requirePermission('permission:delete')],
  }),
  async (c) => {
    const { resource } = c.req.valid('param');
    const { actions } = c.req.valid('json');
    const result = await setPermissionGroupActions(resource, actions, extractActor(c));
    return c.json(result, 200);
  },
);

// ── DELETE GROUP ─────────────────────────────────────────────
// One BE call → one audit row. The FE used to loop `DELETE /:id` per
// permission in the group, producing N audit entries for what's
// semantically a single admin action ("delete the 'roles' permission
// group"). This endpoint matches the create-group pattern: batch op,
// single audit row with `entityId: null` + `before: { codes: [...] }`.
permissionsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/permissions/groups/{resource}',
    tags: ['Permissions'],
    // `resource` is the group key (e.g. `roles`, `permissions`) — the
    // bit before `:` in a permission code. Service does a strict
    // `LIKE 'resource:%'` so siblings sharing a name fragment can't
    // collide. Don't constrain to a UUID regex — these are short
    // tokens like `roles` / `farmers`.
    request: { params: z.object({ resource: z.string().min(1) }) },
    responses: {
      204: { description: 'Group deleted' },
      404: {
        description: 'No permissions found for the group',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('permission:delete')],
  }),
  async (c) => {
    const { resource } = c.req.valid('param');
    const result = await deletePermissionGroup(resource, extractActor(c));
    if (result.status === 'not-found') {
      return c.json({ error: `Permission group '${resource}' not found` }, 404);
    }
    return c.body(null, 204);
  },
);

// ── UPDATE ───────────────────────────────────────────────────
permissionsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/permissions/{id}',
    tags: ['Permissions'],
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: updatePermissionBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: permissionSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('permission:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await updatePermission(id, body, extractActor(c));
    // 400 for empty patch (client sent valid-but-empty payload), 404
    // for missing row. Pre-refactor returned 404 for both — corrected
    // here to match HTTP semantics. FE only displays the error string,
    // so no client-side breakage.
    if (result.status === 'no-fields') return c.json({ error: 'No fields to update' }, 400);
    if (result.status === 'not-found') return c.json({ error: 'Permission not found' }, 404);
    return c.json(toRowResponse(result.row), 200);
  },
);

// ── DELETE ───────────────────────────────────────────────────
permissionsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/permissions/{id}',
    tags: ['Permissions'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      204: { description: 'Deleted' },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('permission:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await deletePermission(id, extractActor(c));
    if (result.status === 'not-found') return c.json({ error: 'Permission not found' }, 404);
    return c.body(null, 204);
  },
);
