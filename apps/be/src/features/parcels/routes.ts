/**
 * Parcels (Farm fields) CRUD — HTTP wiring layer.
 *
 *   GET    /api/parcels             — paginated list (parcel:read)
 *   GET    /api/parcels/:id         — detail (parcel:read)
 *   POST   /api/parcels             — create (parcel:create)
 *   PATCH  /api/parcels/:id         — update (parcel:update)
 *   DELETE /api/parcels/:id         — soft delete (parcel:delete)
 *   POST   /api/parcels/:id/restore — undo soft delete (parcel:delete)
 *
 * Mirrors the farmers feature shape — per-method gating, tenant-scoped
 * via active-coop middleware, audit writes fire inside the service.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { db } from '../../db/client';
import { writeAudit } from '../../lib/audit';
import { type ActiveCoopContext, requireActiveCoop } from '../../middleware/active-coop';
import { requireAuth } from '../../middleware/require-auth';
import { requirePermission } from '../../middleware/require-permission';
import { validationHook } from '../../middleware/validation-hook';
import { toParcelResponse } from './projection';
import {
  createParcelBody,
  errorResponse,
  listParcelsQuery,
  parcelDetailSchema,
  parcelListResponseSchema,
  parcelStatsSchema,
  updateParcelBody,
} from './schemas';
import {
  createParcel,
  getParcel,
  getParcelStats,
  listParcels,
  restoreParcel,
  softDeleteParcel,
  updateParcel,
} from './service';

export const parcelsRoutes = new OpenAPIHono<ActiveCoopContext>({ defaultHook: validationHook });

parcelsRoutes.use('/api/parcels/*', requireAuth);
parcelsRoutes.use('/api/parcels/*', requireActiveCoop);

// ── LIST ─────────────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/parcels',
    tags: ['Parcels'],
    request: { query: listParcelsQuery },
    responses: {
      200: {
        description: 'Parcel list',
        content: { 'application/json': { schema: parcelListResponseSchema } },
      },
    },
    middleware: [requirePermission('parcel:read')],
  }),
  async (c) => {
    const query = c.req.valid('query');
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize ?? '10', 10) || 10));
    const includeDeleted = query.includeDeleted === 'true';

    const splitCsv = (raw: string | undefined): string[] =>
      raw
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const result = await listParcels({
      activeCoopId: c.get('activeCoopId'),
      q: query.q,
      cooperativeCodes: splitCsv(query.cooperativeCode),
      cropTypes: splitCsv(query.cropType),
      parcelStatuses: splitCsv(query.parcelStatus),
      eudrStatuses: splitCsv(query.eudr),
      deforestationRisks: splitCsv(query.deforestation),
      protectedAreaRisks: splitCsv(query.protectedArea),
      overlaps: splitCsv(query.overlap),
      survivalBand: query.survival,
      farmerId: query.farmerId,
      includeDeleted,
      page,
      pageSize,
      sort: query.sort,
    });

    return c.json(
      {
        items: result.rows.map((r) =>
          toParcelResponse(
            r.parcel,
            r.coopCode,
            r.coopName,
            r.districtName,
            r.farmerFirstName,
            r.farmerLastName,
            r.eudrStatus,
            r.shadeTreeCount,
            r.correctiveActions,
            undefined,
            undefined,
            undefined,
            {
              deforestationRisk: r.deforestationRisk ?? null,
              protectedAreaRisk: r.protectedAreaRisk ?? null,
              overlap: r.overlap ?? null,
            },
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

// ── STATS ────────────────────────────────────────────────────
// MUST be registered BEFORE `/api/parcels/{id}` so the literal
// "stats" path segment isn't swallowed by the param matcher.
parcelsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/parcels/stats',
    tags: ['Parcels'],
    responses: {
      200: {
        description: 'Parcel stats — counts for the current coop',
        content: { 'application/json': { schema: parcelStatsSchema } },
      },
    },
    middleware: [requirePermission('parcel:read')],
  }),
  async (c) => {
    const stats = await getParcelStats(c.get('activeCoopId'));
    return c.json(stats, 200);
  },
);

// ── GET detail ───────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/parcels/{id}',
    tags: ['Parcels'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Parcel detail',
        content: { 'application/json': { schema: parcelDetailSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('parcel:read')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await getParcel(id, c.get('activeCoopId'));
    if (!row) return c.json({ error: 'Parcel not found' }, 404);
    return c.json(
      toParcelResponse(
        row.parcel,
        row.coopCode,
        row.coopName,
        row.districtName,
        row.farmerFirstName,
        row.farmerLastName,
        row.eudrStatus,
        row.shadeTreeCount,
        0,
        row.geojson,
        row.eudr,
        row.riskZones,
      ),
      200,
    );
  },
);

// ── CREATE ───────────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/parcels',
    tags: ['Parcels'],
    request: { body: { content: { 'application/json': { schema: createParcelBody } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: parcelDetailSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      409: {
        description: 'Duplicate field id',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('parcel:create')],
  }),
  async (c) => {
    const body = c.req.valid('json');
    const activeCoopId = c.get('activeCoopId');
    const result = await createParcel(
      { ...body, cooperativeId: activeCoopId },
      { userId: c.get('user').id, ctx: c },
    );

    if (result.kind === 'cooperative-not-found') {
      return c.json({ error: 'Cooperative not found' }, 400);
    }
    if (result.kind === 'farmer-not-found') {
      return c.json({ error: 'Farmer not found in this cooperative' }, 400);
    }
    if (result.kind === 'duplicate') {
      return c.json({ error: `Field ID '${result.fieldId}' already exists` }, 409);
    }

    const { parcel, coopCode, coopName, districtName, farmerFirstName, farmerLastName } =
      result.row;
    return c.json(
      toParcelResponse(
        parcel,
        coopCode,
        coopName,
        districtName,
        farmerFirstName,
        farmerLastName,
        null,
      ),
      201,
    );
  },
);

// ── UPDATE ───────────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/parcels/{id}',
    tags: ['Parcels'],
    request: {
      params: z.object({ id: z.string().min(1) }),
      body: { content: { 'application/json': { schema: updateParcelBody } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: parcelDetailSchema } },
      },
      400: {
        description: 'Bad request',
        content: { 'application/json': { schema: errorResponse } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('parcel:update')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await updateParcel(
      id,
      body,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );

    if (result.kind === 'no-fields') return c.json({ error: 'No fields to update' }, 400);
    if (result.kind === 'farmer-not-found')
      return c.json({ error: 'Farmer not found in this cooperative' }, 400);
    if (result.kind === 'not-found') return c.json({ error: 'Parcel not found' }, 404);

    const {
      parcel,
      coopCode,
      coopName,
      districtName,
      farmerFirstName,
      farmerLastName,
      eudrStatus,
    } = result.row;
    return c.json(
      toParcelResponse(
        parcel,
        coopCode,
        coopName,
        districtName,
        farmerFirstName,
        farmerLastName,
        eudrStatus,
      ),
      200,
    );
  },
);

// ── SOFT DELETE ──────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/parcels/{id}',
    tags: ['Parcels'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      204: { description: 'Soft-deleted' },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
    },
    middleware: [requirePermission('parcel:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await softDeleteParcel(
      id,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );
    if (result.kind === 'not-found') return c.json({ error: 'Parcel not found' }, 404);
    return c.body(null, 204);
  },
);

// ── RESTORE ──────────────────────────────────────────────────
parcelsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/parcels/{id}/restore',
    tags: ['Parcels'],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: parcelDetailSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      409: {
        description: 'Not deleted',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
    middleware: [requirePermission('parcel:delete')],
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await restoreParcel(
      id,
      { userId: c.get('user').id, ctx: c },
      c.get('activeCoopId'),
    );

    if (result.kind === 'not-found') return c.json({ error: 'Parcel not found' }, 404);
    if (result.kind === 'not-deleted') return c.json({ error: 'Parcel is not deleted' }, 409);

    const {
      parcel,
      coopCode,
      coopName,
      districtName,
      farmerFirstName,
      farmerLastName,
      eudrStatus,
    } = result.row;
    return c.json(
      toParcelResponse(
        parcel,
        coopCode,
        coopName,
        districtName,
        farmerFirstName,
        farmerLastName,
        eudrStatus,
      ),
      200,
    );
  },
);

// ── BULK IMPORT (GEOJSON) ────────────────────────────────────
parcelsRoutes.post('/api/parcels/import-geojson', requirePermission('parcel:create'), async (c) => {
  let body: Record<string, File | string>;
  try {
    body = (await c.req.parseBody()) as Record<string, File | string>;
  } catch {
    return c.json({ error: 'Malformed multipart body' }, 400);
  }

  const file = body.file;
  if (!file || typeof file === 'string') {
    return c.json({ error: 'Expected a `file` field carrying the GeoJSON upload' }, 400);
  }

  const mappingStr = typeof body.mapping === 'string' ? body.mapping : '';
  if (!mappingStr) {
    return c.json({ error: 'Expected a `mapping` field carrying the JSON configuration' }, 400);
  }

  let mapping: { parcelId: string; capturedAt: string };
  try {
    mapping = JSON.parse(mappingStr);
  } catch {
    return c.json({ error: 'Malformed `mapping` JSON' }, 400);
  }

  // Allow larger uploads for GeoJSON (e.g. 50MB)
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return c.json({ error: `File exceeds ${MAX_BYTES} bytes` }, 400);
  }

  const text = await file.text();
  const { processGeoJsonImport } = await import('./import-geojson');
  const result = await processGeoJsonImport(db, text, mapping);

  await writeAudit({
    actorUserId: c.get('user').id,
    entitySchema: 'gis',
    entityTable: 'parcel_geometries',
    action: 'import-geojson',
    cooperativeId: c.get('activeCoopId'),
    summary: `Imported ${result.summary.upserted} parcel geometries from GeoJSON (${result.summary.totalFeatures} features, ${result.summary.skipped.length} skipped)`,
    metadata: {
      totalFeatures: result.summary.totalFeatures,
      upserted: result.summary.upserted,
      skippedCount: result.summary.skipped.length,
    },
    ctx: c,
  });

  return c.json(result);
});

// ── VALIDATE GEOJSON IDS ────────────────────────────────────
parcelsRoutes.post(
  '/api/parcels/validate-geojson-ids',
  requirePermission('parcel:create'),
  async (c) => {
    const body = await c.req.json();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) return c.json({ matchCount: 0 });

    // Postgres IN clause has a limit (often ~32k or 65k parameters)
    // We'll take unique IDs and chunk them or just limit to a reasonable number to avoid crashing.
    const uniqueIds = [...new Set(ids)].slice(0, 5000) as string[];

    const { sql, inArray, and, eq, isNull } = await import('drizzle-orm');
    const { parcels } = await import('../../db/schema/index');

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(parcels)
      .where(
        and(
          inArray(parcels.id, uniqueIds),
          eq(parcels.cooperativeId, c.get('activeCoopId')),
          isNull(parcels.deletedAt),
        ),
      );

    return c.json({ matchCount: Number(result[0]?.count || 0) });
  },
);

// ── BULK IMPORT (EUDR CSV) ───────────────────────────────────
parcelsRoutes.post(
  '/api/parcels/import-eudr-csv',
  requirePermission('parcel:create'),
  async (c) => {
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

    const mappingStr = typeof body.mapping === 'string' ? body.mapping : '';
    if (!mappingStr) {
      return c.json({ error: 'Expected a `mapping` field carrying the JSON configuration' }, 400);
    }

    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(mappingStr);
    } catch {
      return c.json({ error: 'Malformed `mapping` JSON' }, 400);
    }

    // Allow up to 50MB for CSVs
    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return c.json({ error: `File exceeds ${MAX_BYTES} bytes` }, 400);
    }

    const text = await file.text();
    const { processEudrCsvImport } = await import('./import-eudr-csv');
    const result = await processEudrCsvImport(db, text, mapping);

    await writeAudit({
      actorUserId: c.get('user').id,
      entitySchema: 'gis',
      entityTable: 'eudr_status',
      action: 'import-eudr-csv',
      cooperativeId: c.get('activeCoopId'),
      summary: `Imported ${result.summary.upserted} EUDR status records from CSV (${result.summary.totalRows} rows, ${result.summary.skipped.length} skipped)`,
      metadata: {
        totalRows: result.summary.totalRows,
        upserted: result.summary.upserted,
        skippedCount: result.summary.skipped.length,
      },
      ctx: c,
    });

    return c.json(result);
  },
);
