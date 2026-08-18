/**
 * Parcels (Farm fields) — DB access + audit-write side effects.
 *
 * Mirrors `apps/be/src/features/farmers/service.ts`: HTTP-agnostic
 * pure-async functions, tenant-scoped via `activeCoopId`, audit writes
 * fired here so route handlers stay thin.
 */

import type { CreateParcelInput, UpdateParcelInput } from '@kuanadata/shared';
import { and, asc, count, desc, sql as dsql, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { eudrStatus, parcelGeometries, parcels } from '../../db/schema/gis';
import { cooperatives } from '../../db/schema/iam';
import { correctiveActions } from '../../db/schema/inspection';
import { survivalChecks } from '../../db/schema/shade';
import { writeAudit } from '../../lib/audit';
import { parseBoolFlag } from '../../lib/query-flags';
import { buildOrderBy } from '../../lib/sort';
import type { ActiveCoopContext } from '../../middleware/active-coop';
import { parcelAuditSnapshot } from './projection';

/** Actor context — same shape as the farmers feature so `writeAudit`
 *  can resolve IP / UA / session id from the request. */
export interface ActorContext {
  userId: string;
  ctx: Context<ActiveCoopContext>;
}

// ── LIST ─────────────────────────────────────────────────────
export interface ListParcelsFilters {
  activeCoopId: string;
  q?: string;
  cooperativeCodes: string[];
  cropTypes: string[];
  parcelStatuses: string[];
  eudrStatuses: string[];
  /** `gis.eudr_status` verdicts — see the shared query schema. */
  deforestationRisks: string[];
  protectedAreaRisks: string[];
  overlaps: string[];
  /** Shade-survival band filter — one of healthy | caution | warning |
   *  danger | none. Bucketed against `parcels.shade_survival_pct`. */
  survivalBand?: string;
  /** Exact farmer-id filter (no array — every parcel has exactly
   *  one farmer, so OR'd values would be redundant). */
  farmerId?: string;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ParcelRow {
  parcel: typeof parcels.$inferSelect;
  coopCode: string;
  coopName: string;
  districtName: string | null;
  farmerFirstName: string;
  farmerLastName: string;
  eudrStatus: string | null;
  /** Flattened out of the assessment for the LIST — `high` means the plot
   *  abuts a deforestation patch or protected area. */
  deforestationRisk?: string | null;
  protectedAreaRisk?: string | null;
  overlap?: string | null;
  /** Number of shade tree profiles recorded on this parcel. 0 when
   *  no records exist. Sourced from `shade.survival_checks`. */
  shadeTreeCount: number;
  /** Outstanding corrective actions across this parcel's inspections.
   *  Only populated by the list query; mutation paths omit it (→ 0). */
  correctiveActions?: number;
  geojson?: string | null;
  /** Full EUDR assessment row (detail endpoint only). Null when the
   *  parcel has no `gis.eudr_status` row. */
  eudr?: {
    overlap: string | null;
    onLand: string | null;
    inCountry: string | null;
    deforestationRisk: string | null;
    protectedAreaRisk: string | null;
    data: string | null;
    explanation: string | null;
    assessedAt: Date | null;
    assessedBy: string | null;
    notes: string | null;
  } | null;
  /** GeoJSON FeatureCollection of EUDR risk zones near this parcel
   *  (detail endpoint only). */
  riskZones?: unknown;
}

/** Light snapshot fed to writeAudit's `entitySnapshot`. The detail
 *  drawer + history popover render these three fields verbatim. */
function parcelEntitySnapshot(p: typeof parcels.$inferSelect) {
  return {
    parcelId: p.id,
    parcelName: p.parcelName,
    farmerId: p.farmerId,
  };
}

export interface ListParcelsResult {
  rows: ParcelRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listParcels(f: ListParcelsFilters): Promise<ListParcelsResult> {
  const offset = (f.page - 1) * f.pageSize;

  const whereClauses = [];
  // Hard tenant scope.
  whereClauses.push(eq(parcels.cooperativeId, f.activeCoopId));
  if (!f.includeDeleted) whereClauses.push(isNull(parcels.deletedAt));

  if (f.q) {
    whereClauses.push(
      or(
        ilike(parcels.id, `%${f.q}%`),
        ilike(parcels.parcelName, `%${f.q}%`),
        ilike(parcels.farmerId, `%${f.q}%`),
      )!,
    );
  }
  if (f.cooperativeCodes.length === 1) {
    whereClauses.push(eq(cooperatives.code, f.cooperativeCodes[0]!));
  } else if (f.cooperativeCodes.length > 1) {
    whereClauses.push(inArray(cooperatives.code, f.cooperativeCodes));
  }
  if (f.cropTypes.length === 1) {
    whereClauses.push(eq(parcels.cropType, f.cropTypes[0]!));
  } else if (f.cropTypes.length > 1) {
    whereClauses.push(inArray(parcels.cropType, f.cropTypes));
  }
  if (f.parcelStatuses.length === 1) {
    whereClauses.push(eq(parcels.parcelStatus, f.parcelStatuses[0]!));
  } else if (f.parcelStatuses.length > 1) {
    whereClauses.push(inArray(parcels.parcelStatus, f.parcelStatuses));
  }
  if (f.eudrStatuses.length > 0) {
    // Parcels with no eudr_status row (the LEFT JOIN yields NULL) read
    // as "Unknown" in the list badge and the stats bucket, so filter on
    // the COALESCE'd value — otherwise selecting "Unknown" would match
    // only the rare rows explicitly set to 'unknown' and miss every
    // parcel that simply has no row yet (i.e. almost all of them).
    whereClauses.push(inArray(dsql`COALESCE(${eudrStatus.status}, 'unknown')`, f.eudrStatuses));
  }
  // Same COALESCE reasoning as the EUDR filter above: a parcel with no
  // assessment row shows the benign value in the list, so picking that
  // value has to match it.
  if (f.deforestationRisks.length > 0) {
    whereClauses.push(
      inArray(dsql`COALESCE(${eudrStatus.deforestationRisk}, 'low')`, f.deforestationRisks),
    );
  }
  if (f.protectedAreaRisks.length > 0) {
    whereClauses.push(
      inArray(dsql`COALESCE(${eudrStatus.protectedAreaRisk}, 'low')`, f.protectedAreaRisks),
    );
  }
  if (f.overlaps.length > 0) {
    whereClauses.push(inArray(dsql`COALESCE(${eudrStatus.overlap}, 'none')`, f.overlaps));
  }
  if (f.survivalBand) {
    // Bands mirror the ShadeSurvivalBadge scale (FE): ≥80 healthy,
    // 60–79 caution, 40–59 warning, <40 danger, no row = none. `< n`
    // comparisons naturally exclude NULLs, so "none" is the explicit
    // IS NULL case.
    const pct = parcels.shadeSurvivalPct;
    const band: Record<string, ReturnType<typeof dsql> | undefined> = {
      healthy: dsql`${pct} >= 80`,
      caution: dsql`${pct} >= 60 AND ${pct} < 80`,
      warning: dsql`${pct} >= 40 AND ${pct} < 60`,
      danger: dsql`${pct} >= 0 AND ${pct} < 40`,
      none: dsql`${pct} IS NULL`,
    };
    const clause = band[f.survivalBand];
    if (clause) whereClauses.push(clause);
  }
  if (f.farmerId) {
    whereClauses.push(eq(parcels.farmerId, f.farmerId));
  }
  const whereExpr = whereClauses.length > 0 ? and(...whereClauses) : undefined;

  // Sort spec (JSON:API) — parsed against a column whitelist by the
  // shared helper. Default: cluster parcels by farmer (ascending
  // farmer_id = ProducerID code like `AS-AK001WP009`), then by parcel
  // id within the same farmer so Field 1 / Field 2 / … come out in
  // order. `eudr` sorts by the joined `eudr_status.status` (the page
  // query already leftJoins it; the count query has no orderBy).
  const orderExprs = buildOrderBy(
    f.sort,
    {
      id: parcels.id,
      field_id: parcels.id,
      parcel_name: parcels.parcelName,
      name: parcels.parcelName,
      farmer_id: parcels.farmerId,
      farmer_code: parcels.farmerId,
      farmer: parcels.farmerId,
      planting_date: parcels.plantingDate,
      area: parcels.calculatedAreaHa,
      calculated_area_ha: parcels.calculatedAreaHa,
      tree_count: parcels.cocoaTreeCount,
      cocoa_tree_count: parcels.cocoaTreeCount,
      eudr: eudrStatus.status,
      status: parcels.parcelStatus,
      survival: parcels.shadeSurvivalPct,
      shade_survival: parcels.shadeSurvivalPct,
      corrective_actions: dsql`(SELECT count(*) FROM ${correctiveActions} ca WHERE ca.parcel_id = ${parcels.id} AND ca.status <> 'done')`,
      created: parcels.createdAt,
      created_at: parcels.createdAt,
      added: parcels.createdAt,
    },
    // Default: newest-registered first, so a just-added farm surfaces at
    // the top of the list. `id` is the stable tiebreaker.
    [desc(parcels.createdAt), asc(parcels.id)],
  );

  const [rows, countRows] = await Promise.all([
    db
      .select({
        parcel: parcels,
        coopCode: cooperatives.code,
        coopName: cooperatives.name,
        districtName: cooperatives.districtName,
        farmerFirstName: farmers.firstName,
        farmerLastName: farmers.lastName,
        eudrStatus: eudrStatus.status,
        deforestationRisk: eudrStatus.deforestationRisk,
        protectedAreaRisk: eudrStatus.protectedAreaRisk,
        overlap: eudrStatus.overlap,
        shadeTreeCount: survivalChecks.totalTrees,
        // Outstanding (not-done) corrective actions across this parcel's
        // inspections — index-backed on corrective_actions(parcel_id).
        correctiveActions: dsql<number>`CAST((
          SELECT count(*) FROM ${correctiveActions} ca
          WHERE ca.parcel_id = ${parcels.id} AND ca.status <> 'done'
        ) AS INT)`,
      })
      .from(parcels)
      .innerJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
      .innerJoin(farmers, eq(farmers.id, parcels.farmerId))
      .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
      .leftJoin(
        survivalChecks,
        and(
          eq(survivalChecks.parcelId, parcels.id),
          eq(survivalChecks.cooperativeId, parcels.cooperativeId),
        ),
      )
      .where(whereExpr)
      .orderBy(...orderExprs)
      .limit(f.pageSize)
      .offset(offset),
    db
      .select({ count: dsql<number>`CAST(count(*) AS INT)` })
      .from(parcels)
      .innerJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
      .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
      .where(whereExpr),
  ]);

  return {
    rows: rows as ParcelRow[],
    total: Number(countRows[0].count),
    page: f.page,
    pageSize: f.pageSize,
  };
}

// ── DETAIL ───────────────────────────────────────────────────
export async function getParcel(id: string, activeCoopId: string): Promise<ParcelRow | null> {
  const [row] = await db
    .select({
      parcel: parcels,
      coopCode: cooperatives.code,
      coopName: cooperatives.name,
      districtName: cooperatives.districtName,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      eudrStatus: eudrStatus.status,
      // Select the whole eudr_status row: drizzle reliably collapses a
      // full-table left-join selection to `null` when absent (and returns
      // the row when present). A hand-built nested `{}` here was coming
      // back null even when the row existed, so the detail card silently
      // dropped every EUDR assessment field.
      eudrRow: eudrStatus,
      shadeTreeCount: survivalChecks.totalTrees,
      geojson: dsql<string>`ST_AsGeoJSON(${parcelGeometries.geom})`,
    })
    .from(parcels)
    .innerJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .innerJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
    .leftJoin(parcelGeometries, eq(parcelGeometries.parcelId, parcels.id))
    .leftJoin(
      survivalChecks,
      and(
        eq(survivalChecks.parcelId, parcels.id),
        eq(survivalChecks.cooperativeId, parcels.cooperativeId),
      ),
    )
    .where(and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;
  const e = row.eudrRow;
  const eudr = e
    ? {
        overlap: e.overlap,
        onLand: e.onLand,
        inCountry: e.inCountry,
        deforestationRisk: e.deforestationRisk,
        protectedAreaRisk: e.protectedAreaRisk,
        data: e.eudrData,
        explanation: e.eudrExplanation,
        assessedAt: e.assessedAt,
        assessedBy: e.assessedBy,
        notes: e.notes,
      }
    : null;

  // EUDR risk zones for this parcel (red map overlays), as a GeoJSON
  // FeatureCollection. Keyed on `source_parcel_id` so we get exactly the
  // zones generated adjacent to THIS plot — clean even where the demo
  // cluster packs plots close together (a proximity radius would pull in
  // every neighbour's zones and clutter the map).
  const rz = await db.execute(dsql`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(json_build_object(
        'type', 'Feature',
        'properties', json_build_object('riskType', z.risk_type, 'severity', z.severity, 'name', z.name),
        'geometry', ST_AsGeoJSON(z.geom)::json
      )), '[]'::json)
    ) AS fc
    FROM gis.risk_zones z
    WHERE z.source_parcel_id = ${id}
  `);
  const riskZones = (rz.rows[0] as { fc?: unknown } | undefined)?.fc ?? null;

  return { ...row, eudr, riskZones } as unknown as ParcelRow;
}

// ── CREATE ───────────────────────────────────────────────────
export type CreateParcelResult =
  | { kind: 'ok'; row: ParcelRow }
  | { kind: 'cooperative-not-found' }
  | { kind: 'farmer-not-found' }
  | { kind: 'duplicate'; fieldId: string };

interface CreateParcelInputWithCoop extends CreateParcelInput {
  cooperativeId: string;
}

/**
 * Upsert a parcel's boundary polygon from an uploaded GeoJSON geometry
 * and return the geodesic area in hectares (authoritative — computed by
 * PostGIS from the polygon on the geography sphere). One geometry row
 * per parcel (`parcel_id` is the conflict target), so a re-upload
 * replaces the boundary. `ST_GeomFromGeoJSON` rejects malformed
 * polygons, so an invalid upload throws here rather than storing junk.
 */
async function upsertParcelGeometry(
  parcelId: string,
  // biome-ignore lint/suspicious/noExplicitAny: GeoJSON geometry — validated by the shared zod schema + PostGIS
  geometry: any,
): Promise<number | null> {
  const geomSql = dsql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326))::geometry(MultiPolygon, 4326)`;
  const [g] = await db
    .insert(parcelGeometries)
    .values({
      parcelId,
      sourceFormat: 'geojson',
      capturedAt: new Date(),
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle expects a specific geometry type
      geom: geomSql as any,
    })
    .onConflictDoUpdate({
      target: parcelGeometries.parcelId,
      set: {
        sourceFormat: dsql`EXCLUDED.source_format`,
        capturedAt: dsql`EXCLUDED.captured_at`,
        geom: dsql`EXCLUDED.geom`,
      },
    })
    .returning({ areaHa: dsql<number>`ST_Area(${parcelGeometries.geom}::geography) / 10000.0` });
  return g?.areaHa != null ? Number(g.areaHa) : null;
}

export async function createParcel(
  input: CreateParcelInputWithCoop,
  actor: ActorContext,
): Promise<CreateParcelResult> {
  const [coop] = await db
    .select()
    .from(cooperatives)
    .where(eq(cooperatives.id, input.cooperativeId))
    .limit(1);
  if (!coop) return { kind: 'cooperative-not-found' };

  // Farmer must exist + belong to the same active coop.
  const [farmer] = await db
    .select()
    .from(farmers)
    .where(and(eq(farmers.id, input.farmerId), eq(farmers.cooperativeId, input.cooperativeId)))
    .limit(1);
  if (!farmer) return { kind: 'farmer-not-found' };

  // PK is the source-system Field ID (globally unique by construction).
  const [dup] = await db
    .select({ id: parcels.id })
    .from(parcels)
    .where(eq(parcels.id, input.id))
    .limit(1);
  if (dup) return { kind: 'duplicate', fieldId: input.id };

  let [row] = await db
    .insert(parcels)
    .values({
      id: input.id,
      cooperativeId: input.cooperativeId,
      farmerId: input.farmerId,
      parcelName: input.parcelName ?? null,
      parcelStatus: input.parcelStatus ?? 'active',
      cropType: input.cropType ?? 'cocoa',
      cocoaVariety: input.cocoaVariety ?? null,
      treeSpacing: input.treeSpacing ?? null,
      plantingDate: input.plantingDate ?? null,
      cocoaTreeCount: input.cocoaTreeCount ?? null,
      calculatedAreaHa: input.calculatedAreaHa != null ? String(input.calculatedAreaHa) : null,
      nearbyFeatureType: input.nearbyFeatureType ?? null,
      willingToRehabilitate: input.willingToRehabilitate ?? null,
      landOwnershipType: input.landOwnershipType ?? null,
    })
    .returning();

  // Persist the uploaded boundary + auto-fill area from the polygon
  // when the user left "Total Area" blank (the "Auto from map" path).
  if (input.geometry) {
    const areaHa = await upsertParcelGeometry(row.id, input.geometry);
    if (areaHa != null && input.calculatedAreaHa == null) {
      const [withArea] = await db
        .update(parcels)
        .set({ calculatedAreaHa: areaHa.toFixed(4) })
        .where(eq(parcels.id, row.id))
        .returning();
      if (withArea) row = withArea;
    }
  }

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'gis',
    entityTable: 'parcels',
    entityId: row.id,
    action: 'create',
    after: parcelAuditSnapshot(row),
    cooperativeId: row.cooperativeId,
    summary: `Parcel ${row.id} (${row.parcelName ?? '—'}) created`,
    entitySnapshot: parcelEntitySnapshot(row),
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      parcel: row,
      coopCode: coop.code,
      coopName: coop.name,
      districtName: coop.districtName ?? null,
      farmerFirstName: farmer.firstName,
      farmerLastName: farmer.lastName,
      eudrStatus: null,
      shadeTreeCount: 0,
    },
  };
}

// ── UPDATE ───────────────────────────────────────────────────
export type UpdateParcelResult =
  | { kind: 'ok'; row: ParcelRow }
  | { kind: 'not-found' }
  | { kind: 'farmer-not-found' }
  | { kind: 'no-fields' };

/**
 * Optional caller hints — mirrors `UpdateFarmerOptions`. Used by the
 * inspection apply-changes flow to tag the audit row as
 * "(from inspection …)" without leaking the field to the public API.
 */
export interface UpdateParcelOptions {
  auditMetadata?: Record<string, unknown>;
  auditSummarySuffix?: string;
}

export async function updateParcel(
  id: string,
  input: UpdateParcelInput,
  actor: ActorContext,
  activeCoopId: string,
  opts: UpdateParcelOptions = {},
): Promise<UpdateParcelResult> {
  const patch: Partial<typeof parcels.$inferInsert> = {};

  if (input.farmerId !== undefined) {
    // Validate the new farmer belongs to the active coop.
    const [farmer] = await db
      .select({ id: farmers.id })
      .from(farmers)
      .where(and(eq(farmers.id, input.farmerId), eq(farmers.cooperativeId, activeCoopId)))
      .limit(1);
    if (!farmer) return { kind: 'farmer-not-found' };
    patch.farmerId = input.farmerId;
  }
  if (input.parcelName !== undefined) patch.parcelName = input.parcelName;
  if (input.parcelStatus !== undefined) patch.parcelStatus = input.parcelStatus;
  if (input.cropType !== undefined) patch.cropType = input.cropType;
  if (input.cocoaVariety !== undefined) patch.cocoaVariety = input.cocoaVariety;
  if (input.treeSpacing !== undefined) patch.treeSpacing = input.treeSpacing;
  if (input.plantingDate !== undefined) patch.plantingDate = input.plantingDate;
  if (input.cocoaTreeCount !== undefined) patch.cocoaTreeCount = input.cocoaTreeCount;
  if (input.calculatedAreaHa !== undefined)
    patch.calculatedAreaHa = input.calculatedAreaHa != null ? String(input.calculatedAreaHa) : null;
  if (input.nearbyFeatureType !== undefined) patch.nearbyFeatureType = input.nearbyFeatureType;
  if (input.willingToRehabilitate !== undefined)
    patch.willingToRehabilitate = input.willingToRehabilitate;
  if (input.landOwnershipType !== undefined) patch.landOwnershipType = input.landOwnershipType;

  // A geometry re-upload counts as a real change even when no scalar
  // field was edited (e.g. replacing just the boundary polygon).
  const hasGeometry = input.geometry != null;
  if (Object.keys(patch).length === 0 && !hasGeometry) {
    return { kind: 'no-fields' };
  }
  patch.updatedAt = new Date();

  // Pre-load + scope check in one query.
  const [before] = await db
    .select()
    .from(parcels)
    .where(and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId)))
    .limit(1);
  if (!before) return { kind: 'not-found' };

  let [updated] = await db
    .update(parcels)
    .set(patch)
    .where(and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId)))
    .returning();
  if (!updated) return { kind: 'not-found' };

  // Replace the boundary + auto-fill area when the caller left it blank.
  if (hasGeometry) {
    const areaHa = await upsertParcelGeometry(id, input.geometry);
    if (areaHa != null && input.calculatedAreaHa == null) {
      const [withArea] = await db
        .update(parcels)
        .set({ calculatedAreaHa: areaHa.toFixed(4) })
        .where(eq(parcels.id, id))
        .returning();
      if (withArea) updated = withArea;
    }
  }

  // Re-fetch joined fields for the response.
  const [joined] = await db
    .select({
      coopCode: cooperatives.code,
      coopName: cooperatives.name,
      districtName: cooperatives.districtName,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      eudrStatus: eudrStatus.status,
      shadeTreeCount: survivalChecks.totalTrees,
    })
    .from(parcels)
    .innerJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .innerJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
    .leftJoin(
      survivalChecks,
      and(
        eq(survivalChecks.parcelId, parcels.id),
        eq(survivalChecks.cooperativeId, parcels.cooperativeId),
      ),
    )
    .where(eq(parcels.id, id))
    .limit(1);

  const baseSummary = `Parcel ${updated.id} (${updated.parcelName ?? '—'}) updated`;
  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'gis',
    entityTable: 'parcels',
    entityId: id,
    action: 'update',
    before: parcelAuditSnapshot(before),
    after: parcelAuditSnapshot(updated),
    cooperativeId: updated.cooperativeId,
    summary: opts.auditSummarySuffix ? `${baseSummary} ${opts.auditSummarySuffix}` : baseSummary,
    entitySnapshot: parcelEntitySnapshot(updated),
    metadata: opts.auditMetadata,
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      parcel: updated,
      coopCode: joined!.coopCode,
      coopName: joined!.coopName,
      districtName: joined!.districtName ?? null,
      farmerFirstName: joined!.farmerFirstName,
      farmerLastName: joined!.farmerLastName,
      eudrStatus: joined!.eudrStatus ?? null,
      shadeTreeCount: joined!.shadeTreeCount ?? 0,
    },
  };
}

// ── SOFT DELETE ──────────────────────────────────────────────
export type SoftDeleteParcelResult = { kind: 'ok' } | { kind: 'not-found' };

export async function softDeleteParcel(
  id: string,
  actor: ActorContext,
  activeCoopId: string,
): Promise<SoftDeleteParcelResult> {
  const res = await db
    .update(parcels)
    .set({ deletedAt: new Date(), deletedBy: actor.userId })
    .where(
      and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId), isNull(parcels.deletedAt)),
    )
    .returning();
  if (res.length === 0) return { kind: 'not-found' };

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'gis',
    entityTable: 'parcels',
    entityId: id,
    action: 'soft-delete',
    cooperativeId: res[0].cooperativeId,
    summary: `Parcel ${res[0].id} (${res[0].parcelName ?? '—'}) soft-deleted`,
    entitySnapshot: parcelEntitySnapshot(res[0]),
    ctx: actor.ctx,
  });

  return { kind: 'ok' };
}

// ── RESTORE ──────────────────────────────────────────────────
export type RestoreParcelResult =
  | { kind: 'ok'; row: ParcelRow }
  | { kind: 'not-found' }
  | { kind: 'not-deleted' };

export async function restoreParcel(
  id: string,
  actor: ActorContext,
  activeCoopId: string,
): Promise<RestoreParcelResult> {
  const [existing] = await db
    .select({ id: parcels.id, deletedAt: parcels.deletedAt })
    .from(parcels)
    .where(and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId)))
    .limit(1);
  if (!existing) return { kind: 'not-found' };
  if (existing.deletedAt === null) return { kind: 'not-deleted' };

  const [updated] = await db
    .update(parcels)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(eq(parcels.id, id), eq(parcels.cooperativeId, activeCoopId)))
    .returning();

  const [joined] = await db
    .select({
      coopCode: cooperatives.code,
      coopName: cooperatives.name,
      districtName: cooperatives.districtName,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      eudrStatus: eudrStatus.status,
      shadeTreeCount: survivalChecks.totalTrees,
    })
    .from(parcels)
    .innerJoin(cooperatives, eq(cooperatives.id, parcels.cooperativeId))
    .innerJoin(farmers, eq(farmers.id, parcels.farmerId))
    .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
    .leftJoin(
      survivalChecks,
      and(
        eq(survivalChecks.parcelId, parcels.id),
        eq(survivalChecks.cooperativeId, parcels.cooperativeId),
      ),
    )
    .where(eq(parcels.id, id))
    .limit(1);

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'gis',
    entityTable: 'parcels',
    entityId: id,
    action: 'restore',
    cooperativeId: updated!.cooperativeId,
    summary: `Parcel ${updated!.id} (${updated!.parcelName ?? '—'}) restored`,
    entitySnapshot: parcelEntitySnapshot(updated!),
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      parcel: updated!,
      coopCode: joined!.coopCode,
      coopName: joined!.coopName,
      districtName: joined!.districtName ?? null,
      farmerFirstName: joined!.farmerFirstName,
      farmerLastName: joined!.farmerLastName,
      eudrStatus: joined!.eudrStatus ?? null,
      shadeTreeCount: joined!.shadeTreeCount ?? 0,
    },
  };
}

// ── STATS ────────────────────────────────────────────────────
/** Slim parcel stats — sized to the Pencil `wYEE2` design.
 *
 *  All counts scoped to the current coop. Live rows only (excluding
 *  soft-deleted) for active/inactive/archived + EUDR buckets;
 *  `deleted` is the count of tombstones. `mapped` counts parcels
 *  that have a non-null geometry row (boundary polygon OR point).
 */
export interface ParcelStats {
  total: number;
  mapped: number;
  active: number;
  inactive: number;
  archived: number;
  deleted: number;
  /** EUDR buckets. `unknown` = parcels without an eudr_status row OR
   *  status='unknown'. Other 3 buckets are exact matches on the
   *  `eudr_status.status` column. */
  eudr: {
    compliant: number;
    needs_review: number;
    non_compliant: number;
    unknown: number;
  };
}

export async function getParcelStats(activeCoopId: string): Promise<ParcelStats> {
  const SCOPED = eq(parcels.cooperativeId, activeCoopId);
  const LIVE = isNull(parcels.deletedAt);

  const [headline] = await db
    .select({
      total: dsql<number>`CAST(count(*) AS INT)`,
      active: dsql<number>`CAST(count(*) FILTER (WHERE ${parcels.parcelStatus} = 'active' AND ${parcels.deletedAt} IS NULL) AS INT)`,
      inactive: dsql<number>`CAST(count(*) FILTER (WHERE ${parcels.parcelStatus} = 'inactive' AND ${parcels.deletedAt} IS NULL) AS INT)`,
      archived: dsql<number>`CAST(count(*) FILTER (WHERE ${parcels.parcelStatus} = 'archived' AND ${parcels.deletedAt} IS NULL) AS INT)`,
      deleted: dsql<number>`CAST(count(*) FILTER (WHERE ${parcels.deletedAt} IS NOT NULL) AS INT)`,
    })
    .from(parcels)
    .where(SCOPED);

  // Mapped = parcels with a geometry row (boundary polygon OR GPS
  // point). LEFT JOIN + count distinct on parcels.id catches both.
  const [mappedRow] = await db
    .select({
      mapped: dsql<number>`CAST(count(DISTINCT ${parcels.id}) FILTER (WHERE ${parcelGeometries.id} IS NOT NULL) AS INT)`,
    })
    .from(parcels)
    .leftJoin(parcelGeometries, eq(parcelGeometries.parcelId, parcels.id))
    .where(and(SCOPED, LIVE));

  // EUDR aggregation — LEFT JOIN so parcels without an eudr_status row
  // fall into `unknown`. The COALESCE handles both NULL join + a row
  // with status='unknown' uniformly.
  const eudrRows = await db
    .select({
      bucket: dsql<string>`COALESCE(${eudrStatus.status}, 'unknown')`,
      count: dsql<number>`CAST(count(*) AS INT)`,
    })
    .from(parcels)
    .leftJoin(eudrStatus, eq(eudrStatus.parcelId, parcels.id))
    .where(and(SCOPED, LIVE))
    .groupBy(dsql`COALESCE(${eudrStatus.status}, 'unknown')`);

  const eudrByKey = new Map(eudrRows.map((r) => [r.bucket, Number(r.count)]));

  return {
    total: Number(headline!.total),
    mapped: Number(mappedRow!.mapped),
    active: Number(headline!.active),
    inactive: Number(headline!.inactive),
    archived: Number(headline!.archived),
    deleted: Number(headline!.deleted),
    eudr: {
      compliant: eudrByKey.get('compliant') ?? 0,
      needs_review: eudrByKey.get('needs_review') ?? 0,
      non_compliant: eudrByKey.get('non_compliant') ?? 0,
      unknown: eudrByKey.get('unknown') ?? 0,
    },
  };
}

// Keep imports tidy — these helpers reach in but aren't all called yet.
// (Removes unused-import lint noise without leaving dead code.)
void count;
void parseBoolFlag;
