/**
 * Shade Trees service — list + stats + detail for `shade.tree_profiling`.
 * Tenant-scoped to the active coop cookie.
 */

import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { cooperatives } from '../../db/schema/iam';
import { survivalChecks, treeProfiling } from '../../db/schema/shade';

export interface ShadeTreeListItem {
  id: string;
  koboUuid: string;
  cooperativeId: string | null;
  farmerId: string | null;
  farmerName: string | null;
  parcelId: string | null;
  district: string | null;
  society: string | null;
  dateObserved: string;
  species: string;
  treeTagNum: string | null;
  heightClass: string | null;
  treeCondition: string | null;
  isAlive: boolean;
  photoFilename: string | null;
  submittedAt: string;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  farmerId?: string;
  parcelId?: string;
  species?: string[];
  condition?: string[];
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  sort?: string;
}

export interface ShadeTreeListResult {
  items: ShadeTreeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listShadeTreeProfiles(filters: ListFilters): Promise<ShadeTreeListResult> {
  const conds = [eq(treeProfiling.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(treeProfiling.farmerId, like),
        ilike(treeProfiling.parcelId, like),
        ilike(treeProfiling.farmerName, like),
        ilike(treeProfiling.species, like),
        ilike(treeProfiling.treeTagNum, like),
      )!,
    );
  }
  if (filters.farmerId) conds.push(eq(treeProfiling.farmerId, filters.farmerId));
  if (filters.parcelId) conds.push(eq(treeProfiling.parcelId, filters.parcelId));
  if (filters.species && filters.species.length > 0) {
    conds.push(inArray(treeProfiling.species, filters.species));
  }
  if (filters.condition && filters.condition.length > 0) {
    conds.push(inArray(treeProfiling.treeCondition, filters.condition));
  }
  if (filters.dateFrom) conds.push(gte(treeProfiling.dateObserved, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(treeProfiling.dateObserved, filters.dateTo));

  const where = and(...conds);
  const sortKey = filters.sort ?? '-date_observed';
  const orderExpr =
    sortKey === 'date_observed'
      ? treeProfiling.dateObserved
      : sortKey === 'species'
        ? treeProfiling.species
        : desc(treeProfiling.dateObserved);

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(treeProfiling)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;

  const rows = await db
    .select({
      id: treeProfiling.id,
      koboUuid: treeProfiling.koboUuid,
      cooperativeId: treeProfiling.cooperativeId,
      farmerId: treeProfiling.farmerId,
      farmerName: treeProfiling.farmerName,
      parcelId: treeProfiling.parcelId,
      district: treeProfiling.district,
      society: treeProfiling.society,
      dateObserved: treeProfiling.dateObserved,
      species: treeProfiling.species,
      treeTagNum: treeProfiling.treeTagNum,
      heightClass: treeProfiling.heightClass,
      treeCondition: treeProfiling.treeCondition,
      isAlive: treeProfiling.isAlive,
      photoFilename: treeProfiling.photoFilename,
      submittedAt: treeProfiling.submittedAt,
    })
    .from(treeProfiling)
    .where(where)
    .orderBy(orderExpr)
    .limit(filters.pageSize)
    .offset(offset);

  const items: ShadeTreeListItem[] = rows.map((r) => ({
    ...r,
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface ShadeTreeDetail extends ShadeTreeListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  enumerator: string | null;
  dbhCm: number | null;
  gpsPoint: string | null;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  submittedBy: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getShadeTreeProfile(
  id: string,
  activeCoopId: string,
): Promise<ShadeTreeDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select({
      id: treeProfiling.id,
      koboUuid: treeProfiling.koboUuid,
      koboId: treeProfiling.koboId,
      formVersion: treeProfiling.formVersion,
      cooperativeId: treeProfiling.cooperativeId,
      farmerId: treeProfiling.farmerId,
      farmerName: treeProfiling.farmerName,
      parcelId: treeProfiling.parcelId,
      district: treeProfiling.district,
      society: treeProfiling.society,
      enumerator: treeProfiling.enumerator,
      dateObserved: treeProfiling.dateObserved,
      species: treeProfiling.species,
      treeTagNum: treeProfiling.treeTagNum,
      dbhCm: treeProfiling.dbhCm,
      heightClass: treeProfiling.heightClass,
      treeCondition: treeProfiling.treeCondition,
      isAlive: treeProfiling.isAlive,
      gpsPoint: treeProfiling.gpsPoint,
      photoFilename: treeProfiling.photoFilename,
      submittedAt: treeProfiling.submittedAt,
      submittedBy: treeProfiling.submittedBy,
      snapshotUrl: treeProfiling.snapshotUrl,
      syncedAt: treeProfiling.syncedAt,
      createdAt: treeProfiling.createdAt,
      updatedAt: treeProfiling.updatedAt,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
    })
    .from(treeProfiling)
    .leftJoin(cooperatives, eq(cooperatives.id, treeProfiling.cooperativeId))
    .where(and(eq(treeProfiling.id, id), eq(treeProfiling.cooperativeId, activeCoopId)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    cooperativeId: row.cooperativeId,
    farmerId: row.farmerId,
    farmerName: row.farmerName,
    parcelId: row.parcelId,
    district: row.district,
    society: row.society,
    enumerator: row.enumerator,
    dateObserved: row.dateObserved,
    species: row.species,
    treeTagNum: row.treeTagNum,
    dbhCm: row.dbhCm != null ? Number(row.dbhCm) : null,
    heightClass: row.heightClass,
    treeCondition: row.treeCondition,
    isAlive: row.isAlive,
    gpsPoint: row.gpsPoint,
    photoFilename: row.photoFilename,
    submittedAt: row.submittedAt.toISOString(),
    submittedBy: row.submittedBy,
    cooperativeName: row.cooperativeName,
    cooperativeCode: row.cooperativeCode,
    snapshotUrl: row.snapshotUrl,
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface SpeciesBreakdown {
  species: string;
  count: number;
  aliveCount: number;
}

export interface ShadeTreeStats {
  totalTrees: number;
  aliveTrees: number;
  deadTrees: number;
  parcelsWithShade: number;
  farmersWithShade: number;
  avgSurvivalPct: number | null;
  speciesBreakdown: SpeciesBreakdown[];
}

export async function getShadeTreeStats(activeCoopId: string): Promise<ShadeTreeStats> {
  const [agg] = await db
    .select({
      total: count(),
      alive: sql<number>`COUNT(*) FILTER (WHERE ${treeProfiling.isAlive})::int`,
      dead: sql<number>`COUNT(*) FILTER (WHERE NOT ${treeProfiling.isAlive})::int`,
    })
    .from(treeProfiling)
    .where(eq(treeProfiling.cooperativeId, activeCoopId));

  const [checkAgg] = await db
    .select({
      parcelCount: count(),
      farmerCount: sql<number>`COUNT(DISTINCT ${survivalChecks.farmerId})::int`,
      avgPct: sql<string>`COALESCE(AVG(${survivalChecks.survivalPct})::numeric, 0)::text`,
    })
    .from(survivalChecks)
    .where(eq(survivalChecks.cooperativeId, activeCoopId));

  const species = await db
    .select({
      species: treeProfiling.species,
      total: count(),
      alive: sql<number>`COUNT(*) FILTER (WHERE ${treeProfiling.isAlive})::int`,
    })
    .from(treeProfiling)
    .where(eq(treeProfiling.cooperativeId, activeCoopId))
    .groupBy(treeProfiling.species)
    .orderBy(desc(count()));

  const totalTrees = Number(agg?.total ?? 0);
  return {
    totalTrees,
    aliveTrees: Number(agg?.alive ?? 0),
    deadTrees: Number(agg?.dead ?? 0),
    parcelsWithShade: Number(checkAgg?.parcelCount ?? 0),
    farmersWithShade: Number(checkAgg?.farmerCount ?? 0),
    avgSurvivalPct:
      Number(checkAgg?.parcelCount ?? 0) > 0
        ? Math.round(Number(checkAgg!.avgPct) * 100) / 100
        : null,
    speciesBreakdown: species.map((s) => ({
      species: s.species,
      count: Number(s.total),
      aliveCount: Number(s.alive),
    })),
  };
}
