/**
 * Farmers CRUD (HTTP wiring layer).
 *
 *   GET    /api/farmers             — paginated list (farmer:read)
 *   GET    /api/farmers/stats       — slim stats (farmer:read)
 *   GET    /api/farmers/full-stats  — full stats (farmer:read)
 *   GET    /api/farmers/:id         — detail (farmer:read)
 *   POST   /api/farmers             — create (farmer:create)
 *   PATCH  /api/farmers/:id         — update (farmer:update)
 *   DELETE /api/farmers/:id         — soft delete (farmer:delete)
 *   POST   /api/farmers/:id/restore — undo soft delete (farmer:delete)
 *
 * Shape parallels the users feature: per-method gating, `deletedAt`
 * always exposed on responses, soft-delete decouples status from
 * the tombstone flag, restore clears `deletedAt` only.
 *
 * Handlers do three things only: parse request input, call into
 * `./service`, and `c.json` the result through `./projection.toFarmerResponse`.
 * Schemas live in `./schemas`, DB queries + audit writes in `./service`.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { db } from '../../db/client';
import { writeAudit } from '../../lib/audit';
import { parseBoolFlag } from '../../lib/query-flags';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { exportFarmersCsv } from './csv-export';
import { importFarmersCsv } from './csv-import';
import { toFarmerResponse } from './projection';
import {
  createFarmerBody,
  errorResponse,
  farmerDetailSchema,
  farmerFullStatsSchema,
  farmerListResponseSchema,
  farmerStatsSchema,
  listFarmersQuery,
  updateFarmerBody,
} from './schemas';
import {
  createFarmer,
  getCachedFullStats,
  getFarmer,
  listFarmers,
  restoreFarmer,
  softDeleteFarmer,
  toSlim,
  updateFarmer,
} from './service';

export const farmersRoutes = new OpenAPIHono<ActiveCoopContext>({ defaultHook: validationHook });

// Tenant scoping is mandatory for every farmer endpoint. `requireAuth`
// hydrates the user; `requireActiveCoop` reads the `active-coop-id`
// cookie, validates it against the user's allowed coop set, and sets
// `c.get('activeCoopId')` for the handlers + service to filter on.
farmersRoutes.use('/api/farmers/*', requireAuth);
farmersRoutes.use('/api/farmers/*', requireActiveCoop);

// ── EXPORT (CSV) ─────────────────────────────────────────────
// MUST be registered BEFORE `GET /api/farmers/{id}` — the param
// matcher would otherwise treat "export-csv" as an id and 404.
// Streams the CURRENT filtered farmer set in the 2025-2026 dataset
// layout (round-trips through import-csv). Same query params as the
// list endpoint so the export mirrors what the user sees.
farmersRoutes.get('/api/farmers/export-csv', requirePermission('farmer:read'), async (c) => {
  const splitCsv = (raw: string | undefined): string[] =>
    raw
      ? raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const isActiveRaw = c.req.query('isActive');
  const csv = await exportFarmersCsv({
    activeCoopId: c.get('activeCoopId'),
    q: c.req.query('q') || undefined,
    cooperativeCodes: splitCsv(c.req.query('cooperativeCode')),
    societies: splitCsv(c.req.query('society')),
    certificationStatuses: splitCsv(c.req.query('certificationStatus')),
    certExpiryBands: splitCsv(c.req.query('certExpiry')),
    isActive: isActiveRaw === 'true' || isActiveRaw === 'false' ? isActiveRaw : undefined,
    includeDeleted: parseBoolFlag(c.req.query('includeDeleted')),
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="farmers-${stamp}.csv"`,
  });
});

// ── STATS ────────────────────────────────────────────────────
// MUST be registered BEFORE `GET /api/farmers/{id}` — otherwise the
// UUID param matcher swallows the literal "stats" / "full-stats"
// segment and rejects the request with a validation error.
//
// Two endpoints sharing one cached computation:
//   - `/api/farmers/stats`      — Pencil-matched slim payload
//                                 (headline counters the list page
//                                 surfaces inline, plus cooperative +
//                                 tenure breakdowns).
//   - `/api/farmers/full-stats` — every metric (adds consent / phone /
//                                 national-id coverage + district +
//                                 village breakdowns). Used by the
//                                 dashboard's detailed view.
//
// Counts are GLOBAL (unfiltered). Scoped variants can land later as a
// `?cooperativeCode=` query param on either endpoint.

farmersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/farmers/stats',
    tags: ['Farmers'],
    responses: {
      200: {
        description: 'Slim farmer statistics (Pencil-matched subset)',
        content: { 'application/json': { schema: farmerStatsSchema } },
      },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const { payload, cacheStatus } = await getCachedFullStats(c.get('activeCoopId'));
    c.header('X-Cache', cacheStatus);
    return c.json(toSlim(payload), 200);
  },
);

farmersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/farmers/full-stats',
    tags: ['Farmers'],
    responses: {
      200: {
        description: 'Full farmer statistics — every computed metric',
        content: { 'application/json': { schema: farmerFullStatsSchema } },
      },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const { payload, cacheStatus } = await getCachedFullStats(c.get('activeCoopId'));
    c.header('X-Cache', cacheStatus);
    return c.json(payload, 200);
  },
);

// ── LIST ─────────────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/farmers',
    tags: ['Farmers'],
    request: { query: listFarmersQuery },
    responses: {
      200: {
        description: 'Paginated farmers',
        content: {
          'application/json': {
            schema: farmerListResponseSchema,
          },
        },
      },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const query = c.req.valid('query');
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const includeDeleted = parseBoolFlag(query.includeDeleted);

    // Multi-select filters arrive as comma-separated strings
    // (`?cooperativeCode=A,B,C`) — split + trim + drop empties so the
    // service builds an `IN (...)` clause when there are 2+ values.
    const splitCsv = (raw: string | undefined): string[] =>
      raw
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const result = await listFarmers({
      activeCoopId: c.get('activeCoopId'),
      q: query.q,
      cooperativeCodes: splitCsv(query.cooperativeCode),
      societies: splitCsv(query.society),
      certificationStatuses: splitCsv(query.certificationStatus),
      certExpiryBands: splitCsv(query.certExpiry),
      isActive: query.isActive,
      includeDeleted,
      page,
      pageSize,
      sort: query.sort,
    });

    return c.json(
      {
        items: result.rows.map((r) =>
          toFarmerResponse(
            r.farmer,
            r.coopCode,
            r.coopName,
            r.districtName,
            r.latestCertification,
            r.correctiveActions ?? 0,
          ),
        ),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
      200,
    );
  },
);

// ── GET detail ───────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/farmers/{id}',
    tags: ['Farmers'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Farmer detail',
        content: { 'application/json': { schema: farmerDetailSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('farmer:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getFarmer(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Farmer not found' }, 404);
    return c.json(
      toFarmerResponse(
        row.farmer,
        row.coopCode,
        row.coopName,
        row.districtName,
        row.latestCertification,
      ),
      200,
    );
  },
);

// ── CREATE ───────────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/farmers',
    tags: ['Farmers'],
    request: { body: { content: { 'application/json': { schema: createFarmerBody } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: farmerDetailSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      409: {
        description: 'Duplicate code',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('farmer:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    // Force the new farmer's `cooperativeId` to the active coop —
    // ignore whatever the FE sent so a tampered body can't escape
    // the current scope. Admins switch coops via the header
    // CoopSwitcher before creating.
    const activeCoopId = c.get('activeCoopId');
    const result = await createFarmer(
      { ...body, cooperativeId: activeCoopId },
      {
        userId: c.get('user').id,
        ctx: c,
      },
    );

    if (result.kind === 'cooperative-not-found') {
      return c.json({ error: 'Cooperative not found' }, 400);
    }
    if (result.kind === 'duplicate') {
      return c.json(
        { error: `Farmer code '${result.farmerCode}' already exists in this cooperative` },
        409,
      );
    }

    const { farmer, coopCode, coopName, districtName } = result.row;
    return c.json(toFarmerResponse(farmer, coopCode, coopName, districtName), 201);
  },
);

// ── UPDATE ───────────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/farmers/{id}',
    tags: ['Farmers'],
    request: {
      params: z.object({ id: z.string().min(1) }),
      body: { content: { 'application/json': { schema: updateFarmerBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: farmerDetailSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('farmer:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const result = await updateFarmer(
      id,
      body,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );

    if (result.kind === 'no-fields') {
      // 400 for empty patch (valid-but-empty payload). FE only
      // displays the error string, so the status-code correction is
      // safe.
      return c.json({ error: 'No fields to update' }, 400);
    }
    if (result.kind === 'not-found') {
      return c.json({ error: 'Farmer not found' }, 404);
    }

    const { farmer, coopCode, coopName, districtName } = result.row;
    return c.json(toFarmerResponse(farmer, coopCode, coopName, districtName), 200);
  },
);

// ── SOFT DELETE ──────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/farmers/{id}',
    tags: ['Farmers'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      204: { description: 'Soft-deleted' },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('farmer:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await softDeleteFarmer(
      id,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );
    if (result.kind === 'not-found') {
      return c.json({ error: 'Farmer not found' }, 404);
    }
    return c.body(null, 204);
  },
);

// ── BULK IMPORT (CSV) ────────────────────────────────────────
// Non-OpenAPI route — multipart/form-data body schemas don't play
// nicely with `@hono/zod-openapi`'s type inference, and the CSV
// import is admin-only + rarely called so the missing OpenAPI entry
// is an acceptable tradeoff. The route still lives inside the
// per-farmer permission scope via `requirePermission('farmer:create')`.
farmersRoutes.post('/api/farmers/import-csv', requirePermission('farmer:create'), async (c) => {
  // Hono normalises multipart bodies to `Record<string, File | string>`.
  // The FE dialog sends the file under the key `file` — see
  // shared/api/farmers.ts::importFarmersCsv.
  let body: Record<string, File | string>;
  try {
    body = (await c.req.parseBody()) as Record<string, File | string>;
  } catch {
    return c.json({ error: 'Malformed multipart body' }, 400);
  }
  const file = body.file;
  if (!file || typeof file === 'string') {
    return c.json({ error: 'Expected a `file` field carrying the CSV upload' }, 400);
  }
  // Cap the upload at 10 MB so a runaway browser session can't
  // OOM the BE. 10 MB comfortably fits the reference 2025-2026
  // dataset (~500 KB) plus 20× headroom.
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return c.json({ error: `File exceeds ${MAX_BYTES} bytes` }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await importFarmersCsv(db, buf);

  // Audit — one row per import, entity = the whole batch. The
  // per-farmer/per-parcel upserts run inside importFarmersCsv and
  // aren't audited individually (too noisy for a 3k-row upload).
  await writeAudit({
    actorUserId: c.get('user').id,
    entitySchema: 'farmer',
    entityTable: 'farmers',
    action: 'import-csv',
    cooperativeId: c.get('activeCoopId'),
    summary: `Imported ${result.summary.farmersUpserted} farmers + ${result.summary.parcelsUpserted} parcels from CSV (${result.summary.totalRows} rows, ${result.summary.skipped.length} skipped)`,
    metadata: {
      totalRows: result.summary.totalRows,
      farmersUpserted: result.summary.farmersUpserted,
      parcelsUpserted: result.summary.parcelsUpserted,
      skippedCount: result.summary.skipped.length,
      unknownCoops: result.unknownCoops ?? [],
    },
    ctx: c,
  });

  return c.json({
    kind: result.kind,
    summary: result.summary,
    unknownCoops: result.unknownCoops ?? [],
  });
});

// ── RESTORE ──────────────────────────────────────────────────
farmersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/farmers/{id}/restore',
    tags: ['Farmers'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: farmerDetailSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      409: {
        description: 'Not deleted',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('farmer:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await restoreFarmer(
      id,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );

    if (result.kind === 'not-found') {
      return c.json({ error: 'Farmer not found' }, 404);
    }
    if (result.kind === 'not-deleted') {
      return c.json({ error: 'Farmer is not deleted' }, 409);
    }

    const { farmer, coopCode, coopName, districtName } = result.row;
    return c.json(toFarmerResponse(farmer, coopCode, coopName, districtName), 200);
  },
);
