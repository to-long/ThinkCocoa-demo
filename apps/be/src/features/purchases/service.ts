/**
 * Purchases service — list + stats for `purchase.cocoa_purchases`.
 *
 * Scoped to the caller's active cooperative cookie via
 * `requireActiveCoop` in routes.ts.
 */

import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { parcels } from '../../db/schema/gis';
import { cooperatives } from '../../db/schema/iam';
import { cocoaPurchases } from '../../db/schema/purchase';
import { buildOrderBy } from '../../lib/sort';

export interface PurchaseListItem {
  id: string;
  koboUuid: string;
  purchaseId: string;
  purchaseDate: string;
  cooperativeId: string | null;
  district: string | null;
  society: string | null;
  pcName: string | null;
  stationMarkNumber: string | null;
  farmerCode: string;
  farmerName: string | null;
  purchasingClerkCardNumber: string | null;
  fieldId: string | null;
  parcelId: string | null;
  parcelName: string | null;
  weightKg: number;
  amountReceived: number;
  paymentType: 'cash' | 'mobile_money' | 'cheque' | 'card';
  paymentReference: string | null;
  isOrphan: boolean;
  submittedAt: string;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  farmerId?: string;
  dateFrom?: string;
  dateTo?: string;
  districts?: string[];
  societies?: string[];
  paymentTypes?: string[];
  page: number;
  pageSize: number;
  sort?: string;
}

interface ListResult {
  items: PurchaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPurchases(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(cocoaPurchases.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(cocoaPurchases.purchaseId, like),
        ilike(cocoaPurchases.farmerCode, like),
        ilike(cocoaPurchases.farmerName, like),
        ilike(cocoaPurchases.stationMarkNumber, like),
        ilike(cocoaPurchases.fieldId, like),
      )!,
    );
  }
  if (filters.farmerId) conds.push(eq(cocoaPurchases.farmerId, filters.farmerId));
  if (filters.dateFrom) conds.push(gte(cocoaPurchases.purchaseDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(cocoaPurchases.purchaseDate, filters.dateTo));
  if (filters.districts && filters.districts.length > 0) {
    conds.push(inArray(cocoaPurchases.district, filters.districts));
  }
  if (filters.societies && filters.societies.length > 0) {
    conds.push(inArray(cocoaPurchases.society, filters.societies));
  }
  if (filters.paymentTypes && filters.paymentTypes.length > 0) {
    conds.push(inArray(cocoaPurchases.paymentType, filters.paymentTypes));
  }

  const where = and(...conds);

  // Sort. Default to most-recent first. Joined parcel name is sortable
  // too; farmer sorts by the denormalised farmerCode column.
  const orderBy = buildOrderBy(
    filters.sort,
    {
      purchase_id: cocoaPurchases.purchaseId,
      date: cocoaPurchases.purchaseDate,
      farmer: cocoaPurchases.farmerCode,
      parcel_name: parcels.parcelName,
      society: cocoaPurchases.society,
      pc: cocoaPurchases.pcName,
      weight: cocoaPurchases.weightKg,
      amount: cocoaPurchases.amountReceived,
      payment: cocoaPurchases.paymentType,
    },
    [desc(cocoaPurchases.purchaseDate)],
  );

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(cocoaPurchases)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select({
      id: cocoaPurchases.id,
      koboUuid: cocoaPurchases.koboUuid,
      purchaseId: cocoaPurchases.purchaseId,
      purchaseDate: cocoaPurchases.purchaseDate,
      cooperativeId: cocoaPurchases.cooperativeId,
      district: cocoaPurchases.district,
      society: cocoaPurchases.society,
      pcName: cocoaPurchases.pcName,
      stationMarkNumber: cocoaPurchases.stationMarkNumber,
      farmerCode: cocoaPurchases.farmerCode,
      farmerNameDenorm: cocoaPurchases.farmerName,
      purchasingClerkCardNumber: cocoaPurchases.purchasingClerkCardNumber,
      fieldId: cocoaPurchases.fieldId,
      parcelId: cocoaPurchases.parcelId,
      parcelName: parcels.parcelName,
      weightKg: cocoaPurchases.weightKg,
      amountReceived: cocoaPurchases.amountReceived,
      paymentType: cocoaPurchases.paymentType,
      paymentReference: cocoaPurchases.paymentReference,
      submittedAt: cocoaPurchases.submittedAt,
      farmerId: cocoaPurchases.farmerId,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
    })
    .from(cocoaPurchases)
    .leftJoin(farmers, eq(farmers.id, cocoaPurchases.farmerId))
    .leftJoin(parcels, eq(parcels.id, cocoaPurchases.parcelId))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: PurchaseListItem[] = rows.map((r) => ({
    id: r.id,
    koboUuid: r.koboUuid,
    purchaseId: r.purchaseId,
    purchaseDate: r.purchaseDate,
    cooperativeId: r.cooperativeId,
    district: r.district,
    society: r.society,
    pcName: r.pcName,
    stationMarkNumber: r.stationMarkNumber,
    farmerCode: r.farmerCode,
    farmerName:
      r.farmerFirstName || r.farmerLastName
        ? [r.farmerFirstName, r.farmerLastName].filter(Boolean).join(' ')
        : (r.farmerNameDenorm ?? null),
    purchasingClerkCardNumber: r.purchasingClerkCardNumber,
    fieldId: r.fieldId,
    parcelId: r.parcelId,
    parcelName: r.parcelName,
    weightKg: Number(r.weightKg),
    amountReceived: Number(r.amountReceived),
    paymentType: r.paymentType as PurchaseListItem['paymentType'],
    paymentReference: r.paymentReference,
    isOrphan: !r.farmerId,
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface PurchaseDetail extends PurchaseListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPurchase(
  id: string,
  activeCoopId: string,
): Promise<PurchaseDetail | null> {
  const idMatch = UUID_RE.test(id)
    ? or(eq(cocoaPurchases.id, id), eq(cocoaPurchases.purchaseId, id))
    : eq(cocoaPurchases.purchaseId, id);
  const [row] = await db
    .select({
      id: cocoaPurchases.id,
      koboUuid: cocoaPurchases.koboUuid,
      koboId: cocoaPurchases.koboId,
      formVersion: cocoaPurchases.formVersion,
      purchaseId: cocoaPurchases.purchaseId,
      purchaseDate: cocoaPurchases.purchaseDate,
      cooperativeId: cocoaPurchases.cooperativeId,
      district: cocoaPurchases.district,
      society: cocoaPurchases.society,
      pcName: cocoaPurchases.pcName,
      stationMarkNumber: cocoaPurchases.stationMarkNumber,
      farmerCode: cocoaPurchases.farmerCode,
      farmerNameDenorm: cocoaPurchases.farmerName,
      purchasingClerkCardNumber: cocoaPurchases.purchasingClerkCardNumber,
      fieldId: cocoaPurchases.fieldId,
      parcelId: cocoaPurchases.parcelId,
      parcelName: parcels.parcelName,
      weightKg: cocoaPurchases.weightKg,
      amountReceived: cocoaPurchases.amountReceived,
      paymentType: cocoaPurchases.paymentType,
      paymentReference: cocoaPurchases.paymentReference,
      submittedAt: cocoaPurchases.submittedAt,
      snapshotUrl: cocoaPurchases.snapshotUrl,
      syncedAt: cocoaPurchases.syncedAt,
      createdAt: cocoaPurchases.createdAt,
      updatedAt: cocoaPurchases.updatedAt,
      farmerId: cocoaPurchases.farmerId,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
    })
    .from(cocoaPurchases)
    .leftJoin(farmers, eq(farmers.id, cocoaPurchases.farmerId))
    .leftJoin(cooperatives, eq(cooperatives.id, cocoaPurchases.cooperativeId))
    .leftJoin(parcels, eq(parcels.id, cocoaPurchases.parcelId))
    .where(and(idMatch, eq(cocoaPurchases.cooperativeId, activeCoopId)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    purchaseId: row.purchaseId,
    purchaseDate: row.purchaseDate,
    cooperativeId: row.cooperativeId,
    district: row.district,
    society: row.society,
    pcName: row.pcName,
    stationMarkNumber: row.stationMarkNumber,
    farmerCode: row.farmerCode,
    farmerName:
      row.farmerFirstName || row.farmerLastName
        ? [row.farmerFirstName, row.farmerLastName].filter(Boolean).join(' ')
        : (row.farmerNameDenorm ?? null),
    purchasingClerkCardNumber: row.purchasingClerkCardNumber,
    fieldId: row.fieldId,
    parcelId: row.parcelId,
    parcelName: row.parcelName,
    weightKg: Number(row.weightKg),
    amountReceived: Number(row.amountReceived),
    paymentType: row.paymentType as PurchaseListItem['paymentType'],
    paymentReference: row.paymentReference,
    isOrphan: !row.farmerId,
    submittedAt: row.submittedAt.toISOString(),
    cooperativeName: row.cooperativeName,
    cooperativeCode: row.cooperativeCode,
    snapshotUrl: row.snapshotUrl,
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface PaymentBreakdown {
  cash: number;
  mobile_money: number;
  cheque: number;
  card: number;
}

export interface DistrictBreakdown {
  district: string;
  count: number;
}

/** One point on the "purchases per month" trend — `month` is `YYYY-MM`. */
export interface MonthlyPurchasePoint {
  month: string;
  count: number;
}

export interface PurchaseStats {
  totalPurchases: number;
  totalWeightKg: number;
  totalAmount: number;
  blendedRateGhsPerKg: number | null;
  activePcs: number;
  activeSocieties: number;
  activeFarmers: number;
  paymentBreakdown: PaymentBreakdown;
  topDistricts: DistrictBreakdown[];
  societies: string[];
  /** Purchase counts for the trailing 12 months (oldest → newest), gaps
   *  filled with 0 so the trend line always renders a full 12-point grid. */
  monthlyPurchases: MonthlyPurchasePoint[];
}

export async function getPurchaseStats(activeCoopId: string): Promise<PurchaseStats> {
  const [agg] = await db
    .select({
      total: count(),
      totalWeight: sql<string>`COALESCE(SUM(${cocoaPurchases.weightKg})::numeric, 0)::text`,
      totalAmount: sql<string>`COALESCE(SUM(${cocoaPurchases.amountReceived})::numeric, 0)::text`,
      activePcs: sql<number>`COUNT(DISTINCT ${cocoaPurchases.pcName})`,
      activeSocieties: sql<number>`COUNT(DISTINCT ${cocoaPurchases.society})`,
      activeFarmers: sql<number>`COUNT(DISTINCT ${cocoaPurchases.farmerCode})`,
      cash: sql<number>`COUNT(*) FILTER (WHERE ${cocoaPurchases.paymentType} = 'cash')`,
      mobileMoney: sql<number>`COUNT(*) FILTER (WHERE ${cocoaPurchases.paymentType} = 'mobile_money')`,
      cheque: sql<number>`COUNT(*) FILTER (WHERE ${cocoaPurchases.paymentType} = 'cheque')`,
      card: sql<number>`COUNT(*) FILTER (WHERE ${cocoaPurchases.paymentType} = 'card')`,
    })
    .from(cocoaPurchases)
    .where(eq(cocoaPurchases.cooperativeId, activeCoopId));

  const districts = await db
    .select({
      district: cocoaPurchases.district,
      cnt: count(),
    })
    .from(cocoaPurchases)
    .where(eq(cocoaPurchases.cooperativeId, activeCoopId))
    .groupBy(cocoaPurchases.district)
    .orderBy(desc(count()))
    .limit(5);

  const societies = await db
    .selectDistinct({ society: cocoaPurchases.society })
    .from(cocoaPurchases)
    .where(eq(cocoaPurchases.cooperativeId, activeCoopId))
    .orderBy(cocoaPurchases.society);

  // Purchases per month over the trailing 12 months (this season).
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${cocoaPurchases.purchaseDate}::date), 'YYYY-MM')`,
      cnt: count(),
    })
    .from(cocoaPurchases)
    .where(
      and(
        eq(cocoaPurchases.cooperativeId, activeCoopId),
        sql`${cocoaPurchases.purchaseDate}::date >= date_trunc('month', now()) - interval '11 months'`,
      ),
    )
    .groupBy(sql`1`);
  const countByMonth = new Map(monthlyRows.map((r) => [r.month, Number(r.cnt)]));
  const monthlyPurchases: MonthlyPurchasePoint[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlyPurchases.push({ month: key, count: countByMonth.get(key) ?? 0 });
  }

  const totalWeight = Number(agg?.totalWeight ?? 0);
  const totalAmount = Number(agg?.totalAmount ?? 0);
  const blended = totalWeight > 0 ? Math.round((totalAmount / totalWeight) * 100) / 100 : null;

  return {
    totalPurchases: Number(agg?.total ?? 0),
    totalWeightKg: totalWeight,
    totalAmount: totalAmount,
    blendedRateGhsPerKg: blended,
    activePcs: Number(agg?.activePcs ?? 0),
    activeSocieties: Number(agg?.activeSocieties ?? 0),
    activeFarmers: Number(agg?.activeFarmers ?? 0),
    paymentBreakdown: {
      cash: Number(agg?.cash ?? 0),
      mobile_money: Number(agg?.mobileMoney ?? 0),
      cheque: Number(agg?.cheque ?? 0),
      card: Number(agg?.card ?? 0),
    },
    topDistricts: districts
      .filter((d) => d.district)
      .map((d) => ({ district: d.district as string, count: Number(d.cnt) })),
    societies: societies.map((s) => s.society).filter((s): s is string => !!s),
    monthlyPurchases,
  };
}
