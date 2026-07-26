/**
 * Primary Evacuation service — list + stats for
 * `primary_evacuation.lots`. Tenant-scoped to the active coop cookie.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { cooperatives } from '../../db/schema/iam';
import { primaryEvacLotPurchases, primaryEvacLots } from '../../db/schema/primary-evacuation';
import { cocoaPurchases } from '../../db/schema/purchase';
import { buildOrderBy } from '../../lib/sort';

export interface PrimaryEvacListItem {
  id: string;
  koboUuid: string;
  primaryWaybillNumber: string;
  evacuationDate: string;
  cooperativeId: string | null;
  stationMarkNumber: string | null;
  pcName: string | null;
  society: string | null;
  districtDepot: string | null;
  districtWarehouse: string;
  bagsReceived: number;
  kgReceived: number;
  driverName: string | null;
  truckRegistration: string | null;
  childPurchaseCount: number;
  childPurchaseMatched: number;
  submittedAt: string;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  warehouses?: string[];
  societies?: string[];
  page: number;
  pageSize: number;
  sort?: string;
}

interface ListResult {
  items: PrimaryEvacListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPrimaryEvacLots(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(primaryEvacLots.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(primaryEvacLots.primaryWaybillNumber, like),
        ilike(primaryEvacLots.stationMarkNumber, like),
        ilike(primaryEvacLots.pcName, like),
        ilike(primaryEvacLots.driverFirstName, like),
        ilike(primaryEvacLots.driverLastName, like),
        ilike(primaryEvacLots.truckRegistration, like),
      )!,
    );
  }
  if (filters.dateFrom) conds.push(gte(primaryEvacLots.evacuationDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(primaryEvacLots.evacuationDate, filters.dateTo));
  if (filters.warehouses && filters.warehouses.length > 0) {
    conds.push(inArray(primaryEvacLots.districtWarehouse, filters.warehouses));
  }
  if (filters.societies && filters.societies.length > 0) {
    conds.push(inArray(primaryEvacLots.society, filters.societies));
  }

  const where = and(...conds);
  const orderBy = buildOrderBy(
    filters.sort,
    {
      waybill: primaryEvacLots.primaryWaybillNumber,
      date: primaryEvacLots.evacuationDate,
      source: primaryEvacLots.pcName,
      society: primaryEvacLots.society,
      destination: primaryEvacLots.districtWarehouse,
      bags: primaryEvacLots.bagsReceived,
      weight: primaryEvacLots.kgReceived,
    },
    [desc(primaryEvacLots.evacuationDate)],
  );

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(primaryEvacLots)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;

  // Subquery: child purchase counts per lot. Aggregating on the lot's
  // FK avoids an N+1 round-trip while keeping the main query flat.
  const childCounts = db
    .select({
      lotId: primaryEvacLotPurchases.lotId,
      total: sql<number>`count(*)::int`.as('child_total'),
      matched: sql<number>`count(${primaryEvacLotPurchases.purchaseId})::int`.as('child_matched'),
    })
    .from(primaryEvacLotPurchases)
    .groupBy(primaryEvacLotPurchases.lotId)
    .as('cc');

  const rows = await db
    .select({
      id: primaryEvacLots.id,
      koboUuid: primaryEvacLots.koboUuid,
      primaryWaybillNumber: primaryEvacLots.primaryWaybillNumber,
      evacuationDate: primaryEvacLots.evacuationDate,
      cooperativeId: primaryEvacLots.cooperativeId,
      stationMarkNumber: primaryEvacLots.stationMarkNumber,
      pcName: primaryEvacLots.pcName,
      society: primaryEvacLots.society,
      districtDepot: primaryEvacLots.districtDepot,
      districtWarehouse: primaryEvacLots.districtWarehouse,
      bagsReceived: primaryEvacLots.bagsReceived,
      kgReceived: primaryEvacLots.kgReceived,
      driverFirstName: primaryEvacLots.driverFirstName,
      driverLastName: primaryEvacLots.driverLastName,
      truckRegistration: primaryEvacLots.truckRegistration,
      submittedAt: primaryEvacLots.submittedAt,
      childTotal: childCounts.total,
      childMatched: childCounts.matched,
    })
    .from(primaryEvacLots)
    .leftJoin(childCounts, eq(childCounts.lotId, primaryEvacLots.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: PrimaryEvacListItem[] = rows.map((r) => ({
    id: r.id,
    koboUuid: r.koboUuid,
    primaryWaybillNumber: r.primaryWaybillNumber,
    evacuationDate: r.evacuationDate,
    cooperativeId: r.cooperativeId,
    stationMarkNumber: r.stationMarkNumber,
    pcName: r.pcName,
    society: r.society,
    districtDepot: r.districtDepot,
    districtWarehouse: r.districtWarehouse,
    bagsReceived: Number(r.bagsReceived),
    kgReceived: Number(r.kgReceived),
    driverName:
      r.driverFirstName || r.driverLastName
        ? [r.driverFirstName, r.driverLastName].filter(Boolean).join(' ')
        : null,
    truckRegistration: r.truckRegistration,
    childPurchaseCount: Number(r.childTotal ?? 0),
    childPurchaseMatched: Number(r.childMatched ?? 0),
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface LotPurchaseEntry {
  id: string;
  purchaseIdRaw: string;
  /** Non-null when the raw value matched the cocoa_purchases master. */
  purchaseId: string | null;
  /** Joined fields from cocoa_purchases when matched. */
  matched: boolean;
  purchaseDate: string | null;
  /** Farmer UUID from the matched purchase (for deep-linking). */
  farmerId: string | null;
  farmerCode: string | null;
  farmerName: string | null;
  fieldId: string | null;
  weightKg: number | null;
  amountReceivedGhs: number | null;
}

export interface PrimaryEvacDetail extends PrimaryEvacListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  sealNumber: string | null;
  lotPhotoUrl: string | null;
  childPurchases: LotPurchaseEntry[];
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPrimaryEvacLot(
  id: string,
  activeCoopId: string,
): Promise<PrimaryEvacDetail | null> {
  const idMatch = UUID_RE.test(id)
    ? or(eq(primaryEvacLots.id, id), eq(primaryEvacLots.primaryWaybillNumber, id))
    : eq(primaryEvacLots.primaryWaybillNumber, id);
  const [row] = await db
    .select({
      id: primaryEvacLots.id,
      koboUuid: primaryEvacLots.koboUuid,
      koboId: primaryEvacLots.koboId,
      formVersion: primaryEvacLots.formVersion,
      primaryWaybillNumber: primaryEvacLots.primaryWaybillNumber,
      evacuationDate: primaryEvacLots.evacuationDate,
      cooperativeId: primaryEvacLots.cooperativeId,
      stationMarkNumber: primaryEvacLots.stationMarkNumber,
      pcName: primaryEvacLots.pcName,
      society: primaryEvacLots.society,
      districtDepot: primaryEvacLots.districtDepot,
      districtWarehouse: primaryEvacLots.districtWarehouse,
      bagsReceived: primaryEvacLots.bagsReceived,
      kgReceived: primaryEvacLots.kgReceived,
      driverFirstName: primaryEvacLots.driverFirstName,
      driverLastName: primaryEvacLots.driverLastName,
      truckRegistration: primaryEvacLots.truckRegistration,
      sealNumber: primaryEvacLots.sealNumber,
      lotPhotoUrl: primaryEvacLots.lotPhotoUrl,
      submittedAt: primaryEvacLots.submittedAt,
      snapshotUrl: primaryEvacLots.snapshotUrl,
      syncedAt: primaryEvacLots.syncedAt,
      createdAt: primaryEvacLots.createdAt,
      updatedAt: primaryEvacLots.updatedAt,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
    })
    .from(primaryEvacLots)
    .leftJoin(cooperatives, eq(cooperatives.id, primaryEvacLots.cooperativeId))
    .where(and(idMatch, eq(primaryEvacLots.cooperativeId, activeCoopId)))
    .limit(1);

  if (!row) return null;

  const children = await db
    .select({
      id: primaryEvacLotPurchases.id,
      purchaseIdRaw: primaryEvacLotPurchases.purchaseIdRaw,
      purchaseId: primaryEvacLotPurchases.purchaseId,
      cpId: cocoaPurchases.id,
      purchaseDate: cocoaPurchases.purchaseDate,
      farmerId: cocoaPurchases.farmerId,
      farmerCode: cocoaPurchases.farmerCode,
      farmerName: cocoaPurchases.farmerName,
      fieldId: cocoaPurchases.fieldId,
      weightKg: cocoaPurchases.weightKg,
      amountReceivedGhs: cocoaPurchases.amountReceivedGhs,
    })
    .from(primaryEvacLotPurchases)
    .leftJoin(cocoaPurchases, eq(cocoaPurchases.id, primaryEvacLotPurchases.purchaseId))
    .where(eq(primaryEvacLotPurchases.lotId, row.id))
    .orderBy(asc(primaryEvacLotPurchases.createdAt));

  const childPurchases: LotPurchaseEntry[] = children.map((c) => ({
    id: c.id,
    purchaseIdRaw: c.purchaseIdRaw,
    purchaseId: c.purchaseId,
    matched: c.cpId != null,
    purchaseDate: c.purchaseDate,
    farmerId: c.farmerId,
    farmerCode: c.farmerCode,
    farmerName: c.farmerName,
    fieldId: c.fieldId,
    weightKg: c.weightKg != null ? Number(c.weightKg) : null,
    amountReceivedGhs: c.amountReceivedGhs != null ? Number(c.amountReceivedGhs) : null,
  }));

  const totalChildren = childPurchases.length;
  const matchedChildren = childPurchases.filter((c) => c.matched).length;

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    primaryWaybillNumber: row.primaryWaybillNumber,
    evacuationDate: row.evacuationDate,
    cooperativeId: row.cooperativeId,
    stationMarkNumber: row.stationMarkNumber,
    pcName: row.pcName,
    society: row.society,
    districtDepot: row.districtDepot,
    districtWarehouse: row.districtWarehouse,
    bagsReceived: Number(row.bagsReceived),
    kgReceived: Number(row.kgReceived),
    driverFirstName: row.driverFirstName,
    driverLastName: row.driverLastName,
    sealNumber: row.sealNumber,
    driverName:
      row.driverFirstName || row.driverLastName
        ? [row.driverFirstName, row.driverLastName].filter(Boolean).join(' ')
        : null,
    truckRegistration: row.truckRegistration,
    lotPhotoUrl: row.lotPhotoUrl,
    childPurchaseCount: totalChildren,
    childPurchaseMatched: matchedChildren,
    submittedAt: row.submittedAt.toISOString(),
    cooperativeName: row.cooperativeName,
    cooperativeCode: row.cooperativeCode,
    childPurchases,
    snapshotUrl: row.snapshotUrl,
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface WarehouseBreakdown {
  warehouse: string;
  lots: number;
  kg: number;
}

export interface PrimaryEvacStats {
  totalLots: number;
  totalBags: number;
  totalKg: number;
  avgBagSizeKg: number | null;
  avgLotKg: number | null;
  activeStations: number;
  activeDrivers: number;
  activeTrucks: number;
  totalChildPurchases: number;
  warehouses: WarehouseBreakdown[];
  /** Lot count per society, descending — powers the "Lots by society" bar. */
  bySociety: { society: string; lots: number }[];
  societies: string[];
  /** Lots evacuated per month over the trailing 12 months (oldest →
   *  newest), gaps filled with 0. `month` = `YYYY-MM`. */
  monthlyLots: { month: string; count: number }[];
}

export async function getPrimaryEvacStats(activeCoopId: string): Promise<PrimaryEvacStats> {
  const [agg] = await db
    .select({
      total: count(),
      bags: sql<string>`COALESCE(SUM(${primaryEvacLots.bagsReceived})::numeric, 0)::text`,
      kg: sql<string>`COALESCE(SUM(${primaryEvacLots.kgReceived})::numeric, 0)::text`,
      activeStations: sql<number>`COUNT(DISTINCT ${primaryEvacLots.stationMarkNumber})`,
      activeTrucks: sql<number>`COUNT(DISTINCT ${primaryEvacLots.truckRegistration})`,
      activeDrivers: sql<number>`COUNT(DISTINCT (${primaryEvacLots.driverFirstName} || ' ' || ${primaryEvacLots.driverLastName}))`,
    })
    .from(primaryEvacLots)
    .where(eq(primaryEvacLots.cooperativeId, activeCoopId));

  const warehouses = await db
    .select({
      warehouse: primaryEvacLots.districtWarehouse,
      lots: count(),
      kg: sql<string>`COALESCE(SUM(${primaryEvacLots.kgReceived})::numeric, 0)::text`,
    })
    .from(primaryEvacLots)
    .where(eq(primaryEvacLots.cooperativeId, activeCoopId))
    .groupBy(primaryEvacLots.districtWarehouse)
    .orderBy(desc(count()));

  const societiesRows = await db
    .selectDistinct({ society: primaryEvacLots.society })
    .from(primaryEvacLots)
    .where(eq(primaryEvacLots.cooperativeId, activeCoopId))
    .orderBy(primaryEvacLots.society);

  const societyBreakdown = await db
    .select({ society: primaryEvacLots.society, lots: count() })
    .from(primaryEvacLots)
    .where(eq(primaryEvacLots.cooperativeId, activeCoopId))
    .groupBy(primaryEvacLots.society)
    .orderBy(desc(count()));

  // Lots evacuated per month over the trailing 12 months, gap-filled.
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${primaryEvacLots.evacuationDate}::date), 'YYYY-MM')`,
      cnt: count(),
    })
    .from(primaryEvacLots)
    .where(
      and(
        eq(primaryEvacLots.cooperativeId, activeCoopId),
        sql`${primaryEvacLots.evacuationDate}::date >= date_trunc('month', now()) - interval '11 months'`,
      ),
    )
    .groupBy(sql`1`);
  const countByMonth = new Map(monthlyRows.map((r) => [r.month, Number(r.cnt)]));
  const monthlyLots: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlyLots.push({ month: key, count: countByMonth.get(key) ?? 0 });
  }

  const [childAgg] = await db
    .select({ total: count() })
    .from(primaryEvacLotPurchases)
    .innerJoin(primaryEvacLots, eq(primaryEvacLots.id, primaryEvacLotPurchases.lotId))
    .where(eq(primaryEvacLots.cooperativeId, activeCoopId));

  const totalBags = Number(agg?.bags ?? 0);
  const totalKg = Number(agg?.kg ?? 0);
  const total = Number(agg?.total ?? 0);

  return {
    totalLots: total,
    totalBags,
    totalKg,
    avgBagSizeKg: totalBags > 0 ? Math.round((totalKg / totalBags) * 10) / 10 : null,
    avgLotKg: total > 0 ? Math.round(totalKg / total) : null,
    activeStations: Number(agg?.activeStations ?? 0),
    activeDrivers: Number(agg?.activeDrivers ?? 0),
    activeTrucks: Number(agg?.activeTrucks ?? 0),
    totalChildPurchases: Number(childAgg?.total ?? 0),
    warehouses: warehouses.map((w) => ({
      warehouse: w.warehouse,
      lots: Number(w.lots),
      kg: Number(w.kg),
    })),
    bySociety: societyBreakdown
      .filter((s) => s.society)
      .map((s) => ({ society: s.society as string, lots: Number(s.lots) })),
    societies: societiesRows.map((s) => s.society).filter((s): s is string => !!s),
    monthlyLots,
  };
}
