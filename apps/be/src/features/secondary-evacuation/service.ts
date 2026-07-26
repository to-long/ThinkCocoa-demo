/**
 * Secondary Evacuation service — list + stats for
 * `secondary_evacuation.lots`. Tenant-scoped to the active coop cookie.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { cooperatives } from '../../db/schema/iam';
import { primaryEvacLotPurchases, primaryEvacLots } from '../../db/schema/primary-evacuation';
import { cocoaPurchases } from '../../db/schema/purchase';
import { secondaryEvacLotPrimaries, secondaryEvacLots } from '../../db/schema/secondary-evacuation';
import { buildOrderBy } from '../../lib/sort';

export type DdsStatus = 'draft' | 'ready' | 'submitted' | 'accepted' | 'rejected' | 'withdrawn';

export interface SecondaryEvacListItem {
  id: string;
  koboUuid: string;
  secondaryWaybillNumber: string;
  evacuationDate: string;
  cooperativeId: string | null;
  district: string;
  depotOrigin: string;
  beanGrade: string;
  beanCategory: string;
  sealNumber: string;
  sourcingPartner: string;
  bagsLoaded: number;
  portDestination: string;
  driverName: string | null;
  truckRegistration: string | null;
  primaryLotCount: number;
  primaryLotMatched: number;
  ddsStatus: DdsStatus;
  ddsReference: string | null;
  /** Aggregated downstream EUDR compliance of all linked parcels.
   *  Computed at render time once the EUDR module wires up — for now
   *  always `not_assessed` since the parcel→primary→secondary join
   *  has no compliance verdict to roll up. */
  eudrStatus: 'compliant' | 'in_review' | 'at_risk' | 'non_compliant' | 'not_assessed';
  submittedAt: string;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  depots?: string[];
  ports?: string[];
  partners?: string[];
  beanGrades?: string[];
  page: number;
  pageSize: number;
  sort?: string;
}

interface ListResult {
  items: SecondaryEvacListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSecondaryEvacLots(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(secondaryEvacLots.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(secondaryEvacLots.secondaryWaybillNumber, like),
        ilike(secondaryEvacLots.sealNumber, like),
        ilike(secondaryEvacLots.driverFirstName, like),
        ilike(secondaryEvacLots.driverLastName, like),
        ilike(secondaryEvacLots.truckRegistration, like),
      )!,
    );
  }
  if (filters.dateFrom) conds.push(gte(secondaryEvacLots.evacuationDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(secondaryEvacLots.evacuationDate, filters.dateTo));
  if (filters.depots && filters.depots.length > 0) {
    conds.push(inArray(secondaryEvacLots.depotOrigin, filters.depots));
  }
  if (filters.ports && filters.ports.length > 0) {
    conds.push(inArray(secondaryEvacLots.portDestination, filters.ports));
  }
  if (filters.partners && filters.partners.length > 0) {
    conds.push(inArray(secondaryEvacLots.sourcingPartner, filters.partners));
  }
  if (filters.beanGrades && filters.beanGrades.length > 0) {
    conds.push(inArray(secondaryEvacLots.beanGrade, filters.beanGrades));
  }

  const where = and(...conds);
  const orderBy = buildOrderBy(
    filters.sort,
    {
      waybill: secondaryEvacLots.secondaryWaybillNumber,
      date: secondaryEvacLots.evacuationDate,
      origin: secondaryEvacLots.depotOrigin,
      port: secondaryEvacLots.portDestination,
      grade: secondaryEvacLots.beanGrade,
      bags: secondaryEvacLots.bagsLoaded,
      weight: secondaryEvacLots.bagsLoaded,
    },
    [desc(secondaryEvacLots.evacuationDate)],
  );

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(secondaryEvacLots)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;

  const primaryCounts = db
    .select({
      secondaryLotId: secondaryEvacLotPrimaries.secondaryLotId,
      total: sql<number>`count(*)::int`.as('primary_total'),
      matched: sql<number>`count(${secondaryEvacLotPrimaries.primaryLotId})::int`.as(
        'primary_matched',
      ),
    })
    .from(secondaryEvacLotPrimaries)
    .groupBy(secondaryEvacLotPrimaries.secondaryLotId)
    .as('pc');

  const rows = await db
    .select({
      id: secondaryEvacLots.id,
      koboUuid: secondaryEvacLots.koboUuid,
      secondaryWaybillNumber: secondaryEvacLots.secondaryWaybillNumber,
      evacuationDate: secondaryEvacLots.evacuationDate,
      cooperativeId: secondaryEvacLots.cooperativeId,
      district: secondaryEvacLots.district,
      depotOrigin: secondaryEvacLots.depotOrigin,
      beanGrade: secondaryEvacLots.beanGrade,
      beanCategory: secondaryEvacLots.beanCategory,
      sealNumber: secondaryEvacLots.sealNumber,
      sourcingPartner: secondaryEvacLots.sourcingPartner,
      bagsLoaded: secondaryEvacLots.bagsLoaded,
      portDestination: secondaryEvacLots.portDestination,
      driverFirstName: secondaryEvacLots.driverFirstName,
      driverLastName: secondaryEvacLots.driverLastName,
      truckRegistration: secondaryEvacLots.truckRegistration,
      ddsStatus: secondaryEvacLots.ddsStatus,
      ddsReference: secondaryEvacLots.ddsReference,
      submittedAt: secondaryEvacLots.submittedAt,
      primaryTotal: primaryCounts.total,
      primaryMatched: primaryCounts.matched,
    })
    .from(secondaryEvacLots)
    .leftJoin(primaryCounts, eq(primaryCounts.secondaryLotId, secondaryEvacLots.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: SecondaryEvacListItem[] = rows.map((r) => ({
    id: r.id,
    koboUuid: r.koboUuid,
    secondaryWaybillNumber: r.secondaryWaybillNumber,
    evacuationDate: r.evacuationDate,
    cooperativeId: r.cooperativeId,
    district: r.district,
    depotOrigin: r.depotOrigin,
    beanGrade: r.beanGrade,
    beanCategory: r.beanCategory,
    sealNumber: r.sealNumber,
    sourcingPartner: r.sourcingPartner,
    bagsLoaded: Number(r.bagsLoaded),
    portDestination: r.portDestination,
    driverName:
      r.driverFirstName || r.driverLastName
        ? [r.driverFirstName, r.driverLastName].filter(Boolean).join(' ')
        : null,
    truckRegistration: r.truckRegistration,
    primaryLotCount: Number(r.primaryTotal ?? 0),
    primaryLotMatched: Number(r.primaryMatched ?? 0),
    ddsStatus: r.ddsStatus as DdsStatus,
    ddsReference: r.ddsReference,
    eudrStatus: 'not_assessed' as const,
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface DetailPurchaseRow {
  id: string;
  purchaseId: string;
  /** False when the clerk-listed reference didn't resolve to a record
   *  in the purchase master (FK null) — traced fields are then null. */
  matched: boolean;
  farmerName: string | null;
  fieldId: string | null;
  purchaseDate: string | null;
  weightKg: number | null;
}

export interface DetailPrimaryLotRow {
  /** NULL when the secondary form's primary_waybill_raw didn't match
   *  any canonical primary_evac.lots row (orphan link). */
  id: string | null;
  primaryWaybillRaw: string;
  primaryWaybillNumber: string | null;
  kgReceived: number | null;
  bagsReceived: number | null;
  evacuationDate: string | null;
  driverName: string | null;
  truckRegistration: string | null;
  sealNumber: string | null;
  purchases: DetailPurchaseRow[];
  purchaseCount: number;
  farmerCount: number;
  plotCount: number;
}

export interface SecondaryEvacDetail extends SecondaryEvacListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  depotGps: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  driverLicenceNumber: string | null;
  qccImageUrl: string | null;
  ddsSubmittedAt: string | null;
  /** Aggregates across the primary lots that feed this export. */
  chainDepth: { primaryLots: number; purchases: number };
  linkedFarms: { farmers: number; plots: number };
  primaryLots: DetailPrimaryLotRow[];
  custody: { totalPrimary: number; matchedPrimary: number; orphans: number };
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSecondaryEvacLot(
  id: string,
  activeCoopId: string,
): Promise<SecondaryEvacDetail | null> {
  const idMatch = UUID_RE.test(id)
    ? or(eq(secondaryEvacLots.id, id), eq(secondaryEvacLots.secondaryWaybillNumber, id))
    : eq(secondaryEvacLots.secondaryWaybillNumber, id);
  const [row] = await db
    .select({
      id: secondaryEvacLots.id,
      koboUuid: secondaryEvacLots.koboUuid,
      koboId: secondaryEvacLots.koboId,
      formVersion: secondaryEvacLots.formVersion,
      secondaryWaybillNumber: secondaryEvacLots.secondaryWaybillNumber,
      evacuationDate: secondaryEvacLots.evacuationDate,
      cooperativeId: secondaryEvacLots.cooperativeId,
      district: secondaryEvacLots.district,
      depotOrigin: secondaryEvacLots.depotOrigin,
      depotGps: secondaryEvacLots.depotGps,
      beanGrade: secondaryEvacLots.beanGrade,
      beanCategory: secondaryEvacLots.beanCategory,
      sealNumber: secondaryEvacLots.sealNumber,
      sourcingPartner: secondaryEvacLots.sourcingPartner,
      bagsLoaded: secondaryEvacLots.bagsLoaded,
      portDestination: secondaryEvacLots.portDestination,
      driverFirstName: secondaryEvacLots.driverFirstName,
      driverLastName: secondaryEvacLots.driverLastName,
      driverLicenceNumber: secondaryEvacLots.driverLicenceNumber,
      truckRegistration: secondaryEvacLots.truckRegistration,
      qccImageUrl: secondaryEvacLots.qccImageUrl,
      ddsStatus: secondaryEvacLots.ddsStatus,
      ddsReference: secondaryEvacLots.ddsReference,
      ddsSubmittedAt: secondaryEvacLots.ddsSubmittedAt,
      submittedAt: secondaryEvacLots.submittedAt,
      snapshotUrl: secondaryEvacLots.snapshotUrl,
      syncedAt: secondaryEvacLots.syncedAt,
      createdAt: secondaryEvacLots.createdAt,
      updatedAt: secondaryEvacLots.updatedAt,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
    })
    .from(secondaryEvacLots)
    .leftJoin(cooperatives, eq(cooperatives.id, secondaryEvacLots.cooperativeId))
    .where(and(idMatch, eq(secondaryEvacLots.cooperativeId, activeCoopId)))
    .limit(1);

  if (!row) return null;

  // Child primary lots — LEFT JOIN onto canonical primary_evac.lots
  const childPrimaries = await db
    .select({
      childId: secondaryEvacLotPrimaries.id,
      primaryWaybillRaw: secondaryEvacLotPrimaries.primaryWaybillRaw,
      primaryLotId: secondaryEvacLotPrimaries.primaryLotId,
      // Joined primary lot fields (NULL for orphans)
      primaryWaybillNumber: primaryEvacLots.primaryWaybillNumber,
      kgReceived: primaryEvacLots.kgReceived,
      bagsReceived: primaryEvacLots.bagsReceived,
      evacDate: primaryEvacLots.evacuationDate,
      driverFirst: primaryEvacLots.driverFirstName,
      driverLast: primaryEvacLots.driverLastName,
      truckReg: primaryEvacLots.truckRegistration,
      primarySealNumber: primaryEvacLots.sealNumber,
    })
    .from(secondaryEvacLotPrimaries)
    .leftJoin(primaryEvacLots, eq(primaryEvacLots.id, secondaryEvacLotPrimaries.primaryLotId))
    .where(eq(secondaryEvacLotPrimaries.secondaryLotId, row.id))
    .orderBy(asc(secondaryEvacLotPrimaries.createdAt));

  // Purchases per primary lot (only for matched primaries)
  const matchedPrimaryIds = childPrimaries
    .map((c) => c.primaryLotId)
    .filter((v): v is string => v != null);

  const purchasesByPrimaryLot = new Map<string, DetailPurchaseRow[]>();
  if (matchedPrimaryIds.length > 0) {
    const purchaseRows = await db
      .select({
        lpId: primaryEvacLotPurchases.id,
        primaryLotId: primaryEvacLotPurchases.lotId,
        purchaseIdRaw: primaryEvacLotPurchases.purchaseIdRaw,
        cpId: cocoaPurchases.id,
        purchaseId: cocoaPurchases.purchaseId,
        farmerName: cocoaPurchases.farmerName,
        fieldId: cocoaPurchases.fieldId,
        purchaseDate: cocoaPurchases.purchaseDate,
        weightKg: cocoaPurchases.weightKg,
      })
      .from(primaryEvacLotPurchases)
      // leftJoin (not inner) so clerk-listed references that never
      // resolved to the purchase master still appear in the drilldown,
      // flagged unmatched, instead of silently vanishing.
      .leftJoin(cocoaPurchases, eq(cocoaPurchases.id, primaryEvacLotPurchases.purchaseId))
      .where(inArray(primaryEvacLotPurchases.lotId, matchedPrimaryIds));
    for (const p of purchaseRows) {
      const arr = purchasesByPrimaryLot.get(p.primaryLotId) ?? [];
      arr.push({
        id: p.cpId ?? p.lpId,
        purchaseId: p.purchaseId ?? p.purchaseIdRaw,
        matched: p.cpId != null,
        farmerName: p.farmerName,
        fieldId: p.fieldId,
        purchaseDate: p.purchaseDate,
        weightKg: p.weightKg != null ? Number(p.weightKg) : null,
      });
      purchasesByPrimaryLot.set(p.primaryLotId, arr);
    }
  }

  const primaryLots: DetailPrimaryLotRow[] = childPrimaries.map((c) => {
    const purchases = c.primaryLotId ? (purchasesByPrimaryLot.get(c.primaryLotId) ?? []) : [];
    const farmerSet = new Set(purchases.map((p) => p.farmerName).filter(Boolean));
    const plotSet = new Set(purchases.map((p) => p.fieldId).filter(Boolean));
    return {
      id: c.primaryLotId,
      primaryWaybillRaw: c.primaryWaybillRaw,
      primaryWaybillNumber: c.primaryWaybillNumber,
      kgReceived: c.kgReceived != null ? Number(c.kgReceived) : null,
      bagsReceived: c.bagsReceived != null ? Number(c.bagsReceived) : null,
      evacuationDate: c.evacDate,
      driverName:
        c.driverFirst || c.driverLast
          ? [c.driverFirst, c.driverLast].filter(Boolean).join(' ')
          : null,
      truckRegistration: c.truckReg,
      sealNumber: c.primarySealNumber,
      purchases,
      purchaseCount: purchases.length,
      farmerCount: farmerSet.size,
      plotCount: plotSet.size,
    };
  });

  const totalPrimary = primaryLots.length;
  const matchedPrimary = primaryLots.filter((p) => p.id != null).length;
  const orphans = totalPrimary - matchedPrimary;

  const allPurchases = primaryLots.flatMap((p) => p.purchases);
  const allFarmers = new Set(allPurchases.map((p) => p.farmerName).filter(Boolean));
  const allPlots = new Set(allPurchases.map((p) => p.fieldId).filter(Boolean));

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    secondaryWaybillNumber: row.secondaryWaybillNumber,
    evacuationDate: row.evacuationDate,
    cooperativeId: row.cooperativeId,
    district: row.district,
    depotOrigin: row.depotOrigin,
    depotGps: row.depotGps,
    beanGrade: row.beanGrade,
    beanCategory: row.beanCategory,
    sealNumber: row.sealNumber,
    sourcingPartner: row.sourcingPartner,
    bagsLoaded: Number(row.bagsLoaded),
    portDestination: row.portDestination,
    driverFirstName: row.driverFirstName,
    driverLastName: row.driverLastName,
    driverLicenceNumber: row.driverLicenceNumber,
    truckRegistration: row.truckRegistration,
    qccImageUrl: row.qccImageUrl,
    driverName:
      row.driverFirstName || row.driverLastName
        ? [row.driverFirstName, row.driverLastName].filter(Boolean).join(' ')
        : null,
    primaryLotCount: totalPrimary,
    primaryLotMatched: matchedPrimary,
    ddsStatus: row.ddsStatus as DdsStatus,
    ddsReference: row.ddsReference,
    ddsSubmittedAt: row.ddsSubmittedAt?.toISOString() ?? null,
    eudrStatus: 'not_assessed',
    submittedAt: row.submittedAt.toISOString(),
    cooperativeName: row.cooperativeName,
    cooperativeCode: row.cooperativeCode,
    chainDepth: { primaryLots: matchedPrimary, purchases: allPurchases.length },
    linkedFarms: { farmers: allFarmers.size, plots: allPlots.size },
    primaryLots,
    custody: { totalPrimary, matchedPrimary, orphans },
    snapshotUrl: row.snapshotUrl,
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface PortBreakdown {
  port: string;
  lots: number;
  bags: number;
}

export interface SecondaryEvacStats {
  totalLots: number;
  totalBags: number;
  totalPrimaryLinked: number;
  totalPrimaryMatched: number;
  activeTrucks: number;
  activePartners: number;
  topBuyer: string | null;
  ports: PortBreakdown[];
  grades: { grade: string; lots: number }[];
  /** Lots evacuated per month over the trailing 12 months (oldest →
   *  newest), gaps filled with 0. `month` = `YYYY-MM`. */
  monthlyLots: { month: string; count: number }[];
}

export async function getSecondaryEvacStats(activeCoopId: string): Promise<SecondaryEvacStats> {
  const [agg] = await db
    .select({
      total: count(),
      bags: sql<string>`COALESCE(SUM(${secondaryEvacLots.bagsLoaded})::numeric, 0)::text`,
      activeTrucks: sql<number>`COUNT(DISTINCT ${secondaryEvacLots.truckRegistration})`,
      activePartners: sql<number>`COUNT(DISTINCT ${secondaryEvacLots.sourcingPartner})`,
    })
    .from(secondaryEvacLots)
    .where(eq(secondaryEvacLots.cooperativeId, activeCoopId));

  const ports = await db
    .select({
      port: secondaryEvacLots.portDestination,
      lots: count(),
      bags: sql<string>`COALESCE(SUM(${secondaryEvacLots.bagsLoaded})::numeric, 0)::text`,
    })
    .from(secondaryEvacLots)
    .where(eq(secondaryEvacLots.cooperativeId, activeCoopId))
    .groupBy(secondaryEvacLots.portDestination)
    .orderBy(desc(count()));

  const grades = await db
    .select({ grade: secondaryEvacLots.beanGrade, lots: count() })
    .from(secondaryEvacLots)
    .where(eq(secondaryEvacLots.cooperativeId, activeCoopId))
    .groupBy(secondaryEvacLots.beanGrade)
    .orderBy(desc(count()));

  const buyerRows = await db
    .select({ partner: secondaryEvacLots.sourcingPartner, lots: count() })
    .from(secondaryEvacLots)
    .where(eq(secondaryEvacLots.cooperativeId, activeCoopId))
    .groupBy(secondaryEvacLots.sourcingPartner)
    .orderBy(desc(count()))
    .limit(1);

  const [childAgg] = await db
    .select({
      total: count(),
      matched: sql<number>`COUNT(${secondaryEvacLotPrimaries.primaryLotId})::int`,
    })
    .from(secondaryEvacLotPrimaries)
    .innerJoin(
      secondaryEvacLots,
      eq(secondaryEvacLots.id, secondaryEvacLotPrimaries.secondaryLotId),
    )
    .where(eq(secondaryEvacLots.cooperativeId, activeCoopId));

  // Lots evacuated per month over the trailing 12 months, gap-filled.
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${secondaryEvacLots.evacuationDate}::date), 'YYYY-MM')`,
      cnt: count(),
    })
    .from(secondaryEvacLots)
    .where(
      and(
        eq(secondaryEvacLots.cooperativeId, activeCoopId),
        sql`${secondaryEvacLots.evacuationDate}::date >= date_trunc('month', now()) - interval '11 months'`,
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

  return {
    totalLots: Number(agg?.total ?? 0),
    totalBags: Number(agg?.bags ?? 0),
    totalPrimaryLinked: Number(childAgg?.total ?? 0),
    totalPrimaryMatched: Number(childAgg?.matched ?? 0),
    activeTrucks: Number(agg?.activeTrucks ?? 0),
    activePartners: Number(agg?.activePartners ?? 0),
    topBuyer: buyerRows[0]?.partner ?? null,
    ports: ports.map((p) => ({
      port: p.port,
      lots: Number(p.lots),
      bags: Number(p.bags),
    })),
    grades: grades.map((g) => ({ grade: g.grade, lots: Number(g.lots) })),
    monthlyLots,
  };
}
