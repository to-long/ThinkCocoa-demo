/**
 * Coaching service — list + stats for `coaching.coaching_visits`.
 *
 * Scoped to the caller's active cooperative cookie (set by the
 * `requireActiveCoop` middleware in routes). Same shape as
 * `inspections/service.ts` so the FE list/stats SWR hooks behave
 * identically.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { coachingVisits } from '../../db/schema/coaching';
import { farmers } from '../../db/schema/farmer';
import { parcels } from '../../db/schema/gis';
import { correctiveActions } from '../../db/schema/inspection';
import { buildOrderBy } from '../../lib/sort';

/** One corrective action raised by a coaching visit's non-compliance.
 *  Same shape as the inspection follow-up so the FE reuses the card. */
export interface CoachingFollowUp {
  id: string;
  topic: string;
  action: string;
  actionDate: string | null;
  status: 'open' | 'reopen' | 'processing' | 'done';
  lastComment: string | null;
}

async function loadCoachingFollowUps(visitId: string): Promise<CoachingFollowUp[]> {
  const rows = await db
    .select({
      id: correctiveActions.id,
      topic: correctiveActions.topic,
      action: correctiveActions.action,
      actionDate: correctiveActions.actionDate,
      status: correctiveActions.status,
      lastComment: correctiveActions.lastComment,
    })
    .from(correctiveActions)
    .where(eq(correctiveActions.coachingVisitId, visitId))
    .orderBy(asc(correctiveActions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    action: r.action,
    actionDate: r.actionDate,
    status: r.status as CoachingFollowUp['status'],
    lastComment: r.lastComment,
  }));
}

export interface CoachingVisitListItem {
  id: string;
  koboUuid: string;
  visitDate: string;
  coachName: string | null;
  farmerCode: string | null;
  farmerName: string | null;
  parcelId: string | null;
  parcelName: string | null;
  cooperativeId: string | null;
  district: string | null;
  society: string | null;
  clmrsRiskLevel: 'no_risk' | 'at_risk' | 'case' | null;
  gapScore: number | null;
  ipmScore: number | null;
  gepScore: number | null;
  gspScore: number | null;
  overallScore: number | null;
  gepNoDeforestation: boolean | null;
  nChemicalApps: number;
  nFertilizerApps: number;
  nWeedingActs: number;
  nPruningActs: number;
  nHarvestActs: number;
  nOtherActs: number;
  followUpRequired: boolean;
  followUpDate: string | null;
  /** Count of not-done corrective actions raised by this visit's
   *  non-compliance (source 'coaching' in inspection.corrective_actions). */
  correctiveActions: number;
  isOrphan: boolean;
  submittedAt: string;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  clmrsRisks?: string[];
  coaches?: string[];
  followUpOnly?: boolean;
  page: number;
  pageSize: number;
  sort?: string; // 'visit_date' | '-visit_date' | 'overall_score' | '-overall_score'
}

interface ListResult {
  items: CoachingVisitListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCoachingVisits(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(coachingVisits.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(coachingVisits.farmerId, like),
        ilike(coachingVisits.coachName, like),
        ilike(coachingVisits.society, like),
        ilike(coachingVisits.koboUuid, like),
      )!,
    );
  }
  if (filters.dateFrom) conds.push(gte(coachingVisits.visitDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(coachingVisits.visitDate, filters.dateTo));
  if (filters.clmrsRisks && filters.clmrsRisks.length > 0) {
    conds.push(inArray(coachingVisits.clmrsRiskLevel, filters.clmrsRisks));
  }
  if (filters.coaches && filters.coaches.length > 0) {
    conds.push(inArray(coachingVisits.coachName, filters.coaches));
  }
  if (filters.followUpOnly) conds.push(eq(coachingVisits.followUpRequired, true));

  const where = and(...conds);

  // Sort. Default to most-recent first. Joined columns (farmer name via
  // farmerId, parcel name) are sortable too.
  const orderBy = buildOrderBy(
    filters.sort,
    {
      visit_date: coachingVisits.visitDate,
      farmer: coachingVisits.farmerId,
      parcel_name: parcels.parcelName,
      coach: coachingVisits.coachName,
      society: coachingVisits.society,
      score: coachingVisits.overallScore,
      clmrs: coachingVisits.clmrsRiskLevel,
      follow_up: coachingVisits.followUpDate,
      corrective_actions: sql`(select count(*) from ${correctiveActions} ca where ca.coaching_visit_id = ${coachingVisits.id} and ca.status <> 'done')`,
    },
    [desc(coachingVisits.visitDate)],
  );

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(coachingVisits)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select({
      id: coachingVisits.id,
      koboUuid: coachingVisits.koboUuid,
      visitDate: coachingVisits.visitDate,
      coachName: coachingVisits.coachName,
      farmerId: coachingVisits.farmerId,
      parcelId: coachingVisits.parcelId,
      parcelName: parcels.parcelName,
      cooperativeId: coachingVisits.cooperativeId,
      district: coachingVisits.district,
      society: coachingVisits.society,
      clmrsRiskLevel: coachingVisits.clmrsRiskLevel,
      gapScore: coachingVisits.gapScore,
      ipmScore: coachingVisits.ipmScore,
      gepScore: coachingVisits.gepScore,
      gspScore: coachingVisits.gspScore,
      overallScore: coachingVisits.overallScore,
      gepNoDeforestation: coachingVisits.gepNoDeforestation,
      nChemicalApps: coachingVisits.nChemicalApps,
      nFertilizerApps: coachingVisits.nFertilizerApps,
      nWeedingActs: coachingVisits.nWeedingActs,
      nPruningActs: coachingVisits.nPruningActs,
      nHarvestActs: coachingVisits.nHarvestActs,
      nOtherActs: coachingVisits.nOtherActs,
      followUpRequired: coachingVisits.followUpRequired,
      followUpDate: coachingVisits.followUpDate,
      correctiveActions: sql<number>`(select count(*) from ${correctiveActions} ca where ca.coaching_visit_id = ${coachingVisits.id} and ca.status <> 'done')`,
      submittedAt: coachingVisits.submittedAt,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
    })
    .from(coachingVisits)
    .leftJoin(farmers, eq(farmers.id, coachingVisits.farmerId))
    .leftJoin(parcels, eq(parcels.id, coachingVisits.parcelId))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: CoachingVisitListItem[] = rows.map((r) => ({
    id: r.id,
    koboUuid: r.koboUuid,
    visitDate: r.visitDate,
    coachName: r.coachName,
    farmerCode: r.farmerId,
    farmerName:
      r.farmerFirstName || r.farmerLastName
        ? [r.farmerFirstName, r.farmerLastName].filter(Boolean).join(' ')
        : null,
    parcelId: r.parcelId,
    parcelName: r.parcelName,
    cooperativeId: r.cooperativeId,
    district: r.district,
    society: r.society,
    clmrsRiskLevel: r.clmrsRiskLevel as CoachingVisitListItem['clmrsRiskLevel'],
    gapScore: r.gapScore,
    ipmScore: r.ipmScore,
    gepScore: r.gepScore,
    gspScore: r.gspScore,
    overallScore: r.overallScore,
    gepNoDeforestation: r.gepNoDeforestation,
    nChemicalApps: r.nChemicalApps,
    nFertilizerApps: r.nFertilizerApps,
    nWeedingActs: r.nWeedingActs,
    nPruningActs: r.nPruningActs,
    nHarvestActs: r.nHarvestActs,
    nOtherActs: r.nOtherActs,
    followUpRequired: r.followUpRequired,
    followUpDate: r.followUpDate,
    correctiveActions: Number(r.correctiveActions ?? 0),
    isOrphan: !r.farmerFirstName && !r.farmerLastName,
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface CoachingVisitDetail extends CoachingVisitListItem {
  followUps: CoachingFollowUp[];
  formVersion: string;
  koboId: number;
  /** Synthetic Kobo-shaped form payload for the Section A–H detail. */
  rawData: Record<string, unknown> | null;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function getCoachingVisit(
  id: string,
  activeCoopId: string,
): Promise<CoachingVisitDetail | null> {
  const [row] = await db
    .select({
      id: coachingVisits.id,
      koboUuid: coachingVisits.koboUuid,
      koboId: coachingVisits.koboId,
      formVersion: coachingVisits.formVersion,
      visitDate: coachingVisits.visitDate,
      coachName: coachingVisits.coachName,
      farmerId: coachingVisits.farmerId,
      parcelId: coachingVisits.parcelId,
      parcelName: parcels.parcelName,
      cooperativeId: coachingVisits.cooperativeId,
      district: coachingVisits.district,
      society: coachingVisits.society,
      clmrsRiskLevel: coachingVisits.clmrsRiskLevel,
      gapScore: coachingVisits.gapScore,
      ipmScore: coachingVisits.ipmScore,
      gepScore: coachingVisits.gepScore,
      gspScore: coachingVisits.gspScore,
      overallScore: coachingVisits.overallScore,
      gepNoDeforestation: coachingVisits.gepNoDeforestation,
      nChemicalApps: coachingVisits.nChemicalApps,
      nFertilizerApps: coachingVisits.nFertilizerApps,
      nWeedingActs: coachingVisits.nWeedingActs,
      nPruningActs: coachingVisits.nPruningActs,
      nHarvestActs: coachingVisits.nHarvestActs,
      nOtherActs: coachingVisits.nOtherActs,
      followUpRequired: coachingVisits.followUpRequired,
      followUpDate: coachingVisits.followUpDate,
      correctiveActions: sql<number>`(select count(*) from ${correctiveActions} ca where ca.coaching_visit_id = ${coachingVisits.id} and ca.status <> 'done')`,
      submittedAt: coachingVisits.submittedAt,
      rawData: coachingVisits.rawData,
      snapshotUrl: coachingVisits.snapshotUrl,
      syncedAt: coachingVisits.syncedAt,
      createdAt: coachingVisits.createdAt,
      updatedAt: coachingVisits.updatedAt,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
    })
    .from(coachingVisits)
    .leftJoin(farmers, eq(farmers.id, coachingVisits.farmerId))
    .leftJoin(parcels, eq(parcels.id, coachingVisits.parcelId))
    .where(and(eq(coachingVisits.id, id), eq(coachingVisits.cooperativeId, activeCoopId)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    visitDate: row.visitDate,
    coachName: row.coachName,
    farmerCode: row.farmerId,
    farmerName:
      row.farmerFirstName || row.farmerLastName
        ? [row.farmerFirstName, row.farmerLastName].filter(Boolean).join(' ')
        : null,
    parcelId: row.parcelId,
    parcelName: row.parcelName,
    cooperativeId: row.cooperativeId,
    district: row.district,
    society: row.society,
    clmrsRiskLevel: row.clmrsRiskLevel as CoachingVisitListItem['clmrsRiskLevel'],
    gapScore: row.gapScore,
    ipmScore: row.ipmScore,
    gepScore: row.gepScore,
    gspScore: row.gspScore,
    overallScore: row.overallScore,
    gepNoDeforestation: row.gepNoDeforestation,
    nChemicalApps: row.nChemicalApps,
    nFertilizerApps: row.nFertilizerApps,
    nWeedingActs: row.nWeedingActs,
    nPruningActs: row.nPruningActs,
    nHarvestActs: row.nHarvestActs,
    nOtherActs: row.nOtherActs,
    followUpRequired: row.followUpRequired,
    followUpDate: row.followUpDate,
    correctiveActions: Number(row.correctiveActions ?? 0),
    followUps: await loadCoachingFollowUps(row.id),
    isOrphan: !row.farmerFirstName && !row.farmerLastName,
    rawData: (row.rawData as Record<string, unknown> | null) ?? null,
    submittedAt: row.submittedAt.toISOString(),
    snapshotUrl: row.snapshotUrl,
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface CoachingStats {
  total: number;
  visitsLast30Days: number;
  activeFarmers: number;
  atRiskClmrs: number;
  pendingFollowUp: number;
  avgGap: number | null;
  avgIpm: number | null;
  avgGep: number | null;
  avgGsp: number | null;
  coaches: string[];
}

export async function getCoachingStats(activeCoopId: string): Promise<CoachingStats> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const [row] = await db
    .select({
      total: count(),
      visitsLast30Days: sql<number>`COUNT(*) FILTER (WHERE ${coachingVisits.visitDate} >= ${cutoff})`,
      activeFarmers: sql<number>`COUNT(DISTINCT ${coachingVisits.farmerId})`,
      atRiskClmrs: sql<number>`COUNT(*) FILTER (WHERE ${coachingVisits.clmrsRiskLevel} IN ('at_risk','case'))`,
      pendingFollowUp: sql<number>`COUNT(*) FILTER (WHERE ${coachingVisits.followUpRequired} = true AND (${coachingVisits.followUpDate} IS NULL OR ${coachingVisits.followUpDate} >= CURRENT_DATE))`,
      avgGap: sql<number | null>`ROUND(AVG(${coachingVisits.gapScore})::numeric, 1)`,
      avgIpm: sql<number | null>`ROUND(AVG(${coachingVisits.ipmScore})::numeric, 1)`,
      avgGep: sql<number | null>`ROUND(AVG(${coachingVisits.gepScore})::numeric, 1)`,
      avgGsp: sql<number | null>`ROUND(AVG(${coachingVisits.gspScore})::numeric, 1)`,
    })
    .from(coachingVisits)
    .where(eq(coachingVisits.cooperativeId, activeCoopId));

  const coachRows = await db
    .selectDistinct({ coachName: coachingVisits.coachName })
    .from(coachingVisits)
    .where(eq(coachingVisits.cooperativeId, activeCoopId))
    .orderBy(coachingVisits.coachName);

  return {
    total: Number(row?.total ?? 0),
    visitsLast30Days: Number(row?.visitsLast30Days ?? 0),
    activeFarmers: Number(row?.activeFarmers ?? 0),
    atRiskClmrs: Number(row?.atRiskClmrs ?? 0),
    pendingFollowUp: Number(row?.pendingFollowUp ?? 0),
    avgGap: row?.avgGap != null ? Number(row.avgGap) : null,
    avgIpm: row?.avgIpm != null ? Number(row.avgIpm) : null,
    avgGep: row?.avgGep != null ? Number(row.avgGep) : null,
    avgGsp: row?.avgGsp != null ? Number(row.avgGsp) : null,
    coaches: coachRows.map((r) => r.coachName).filter((s): s is string => !!s),
  };
}
