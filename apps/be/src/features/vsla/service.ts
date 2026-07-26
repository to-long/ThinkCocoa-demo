/**
 * VSLA service — list + stats + detail over `vsla.groups`.
 *
 * List returns one row per group (`vsla.groups`) with denorm mirror
 * columns already populated by the parser so no join to
 * `monthly_reports` is required for the common list view.
 *
 * Cross-coop groups (cooperative_id IS NULL) show under every active-
 * coop scope. Per-coop groups match only their coop.
 *
 * Detail returns the group identity + all monthly reports newest-first.
 */

import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { cooperatives } from '../../db/schema/iam';
import { vslaGroups, vslaMonthlyReports } from '../../db/schema/vsla';
import { buildOrderBy } from '../../lib/sort';

export interface VslaGroupListItem {
  id: string;
  groupNumber: string;
  groupName: string;
  enumeratorId: string;
  enumeratorPrefix: string;
  communityWorkerName: string | null;
  cooperativeId: string | null;
  cooperativeName: string | null;
  cooperativeCode: string | null;
  society: string | null;
  latestReportMonth: string | null;
  latestActiveMembers: number | null;
  latestSavingsCumulative: number | null;
  latestLateLoansCount: number | null;
  latestHasDiscrepancy: boolean | null;
  reportCount: number;
  discrepancyCount: number;
}

interface ListFilters {
  activeCoopId: string;
  q?: string;
  discrepancy?: 'yes' | 'no';
  societies?: string[];
  page: number;
  pageSize: number;
  sort?: string;
}

interface ListResult {
  items: VslaGroupListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Scope: match the active coop OR NULL (cross-coop). Reusable across
// list + stats.
function scopeCondition(activeCoopId: string) {
  return or(eq(vslaGroups.cooperativeId, activeCoopId), isNull(vslaGroups.cooperativeId))!;
}

export async function listVslaGroups(filters: ListFilters): Promise<ListResult> {
  const conds = [scopeCondition(filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(vslaGroups.groupName, like),
        ilike(vslaGroups.groupNumber, like),
        ilike(vslaGroups.enumeratorId, like),
        ilike(vslaGroups.communityWorkerName, like),
      )!,
    );
  }
  if (filters.discrepancy === 'yes') conds.push(sql`${vslaGroups.discrepancyCount} > 0`);
  if (filters.discrepancy === 'no') conds.push(sql`${vslaGroups.discrepancyCount} = 0`);
  if (filters.societies && filters.societies.length > 0) {
    conds.push(inArray(vslaGroups.society, filters.societies));
  }

  const where = and(...conds);

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(vslaGroups)
    .where(where);

  const orderBy = buildOrderBy(
    filters.sort,
    {
      group: vslaGroups.groupName,
      society: vslaGroups.society,
      enumerator: vslaGroups.communityWorkerName,
      latest_month: vslaGroups.latestReportMonth,
      members: vslaGroups.latestActiveMembers,
      savings: vslaGroups.latestSavingsCumulative,
      reports: vslaGroups.reportCount,
      discrepancy: vslaGroups.discrepancyCount,
    },
    [desc(vslaGroups.latestReportMonth)],
  );

  const offset = (filters.page - 1) * filters.pageSize;

  const rows = await db
    .select({
      id: vslaGroups.id,
      groupNumber: vslaGroups.groupNumber,
      groupName: vslaGroups.groupName,
      enumeratorId: vslaGroups.enumeratorId,
      enumeratorPrefix: vslaGroups.enumeratorPrefix,
      communityWorkerName: vslaGroups.communityWorkerName,
      cooperativeId: vslaGroups.cooperativeId,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
      society: vslaGroups.society,
      latestReportMonth: vslaGroups.latestReportMonth,
      latestActiveMembers: vslaGroups.latestActiveMembers,
      latestSavingsCumulative: vslaGroups.latestSavingsCumulative,
      latestLateLoansCount: vslaGroups.latestLateLoansCount,
      latestHasDiscrepancy: vslaGroups.latestHasDiscrepancy,
      reportCount: vslaGroups.reportCount,
      discrepancyCount: vslaGroups.discrepancyCount,
    })
    .from(vslaGroups)
    .leftJoin(cooperatives, eq(vslaGroups.cooperativeId, cooperatives.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: VslaGroupListItem[] = rows.map((r) => ({
    id: r.id,
    groupNumber: r.groupNumber,
    groupName: r.groupName,
    enumeratorId: r.enumeratorId,
    enumeratorPrefix: r.enumeratorPrefix,
    communityWorkerName: r.communityWorkerName,
    cooperativeId: r.cooperativeId,
    cooperativeName: r.cooperativeName,
    cooperativeCode: r.cooperativeCode,
    society: r.society,
    latestReportMonth: r.latestReportMonth,
    latestActiveMembers: r.latestActiveMembers,
    latestSavingsCumulative:
      r.latestSavingsCumulative == null ? null : Number(r.latestSavingsCumulative),
    latestLateLoansCount: r.latestLateLoansCount,
    latestHasDiscrepancy: r.latestHasDiscrepancy,
    reportCount: r.reportCount,
    discrepancyCount: r.discrepancyCount,
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export interface VslaStats {
  activeGroups: number;
  activeMembers: number;
  cumulativeSavings: number;
  groupsWithDiscrepancy: number;
  societies: string[];
}

export async function getVslaStats(activeCoopId: string): Promise<VslaStats> {
  const [row] = await db
    .select({
      activeGroups: count(),
      activeMembers: sql<number>`COALESCE(SUM(${vslaGroups.latestActiveMembers}), 0)::int`,
      cumulativeSavings: sql<number>`COALESCE(SUM(${vslaGroups.latestSavingsCumulative}), 0)::float`,
      groupsWithDiscrepancy: sql<number>`COUNT(*) FILTER (WHERE ${vslaGroups.discrepancyCount} > 0)::int`,
    })
    .from(vslaGroups)
    .where(scopeCondition(activeCoopId));

  const socRows = await db
    .selectDistinct({ society: vslaGroups.society })
    .from(vslaGroups)
    .where(and(scopeCondition(activeCoopId), sql`${vslaGroups.society} IS NOT NULL`));

  return {
    activeGroups: row?.activeGroups ?? 0,
    activeMembers: row?.activeMembers ?? 0,
    cumulativeSavings: row?.cumulativeSavings ?? 0,
    groupsWithDiscrepancy: row?.groupsWithDiscrepancy ?? 0,
    societies: socRows.map((s) => s.society).filter((s): s is string => s != null),
  };
}

export interface VslaMonthlyReportRow {
  id: string;
  koboUuid: string;
  reportMonth: string;
  activeMembersAtVisit: number | null;
  maleMembers: number | null;
  femaleMembers: number | null;
  savingsCumulative: number | null;
  savingsValueMonth: number | null;
  lateLoansCount: number | null;
  lateLoansUnpaidBalance: number | null;
  activeLoansCount: number | null;
  activeLoansValue: number | null;
  cashLoanFund: number | null;
  cashSocialFund: number | null;
  verifyLoanFundMatch: boolean | null;
  verifySocialFundMatch: boolean | null;
  verifyRegisterLoanFund: boolean | null;
  verifyRegisterSocialFund: boolean | null;
  hasDiscrepancy: boolean;
  comments: string | null;
  submittedAt: string;
}

export interface VslaGroupDetail extends VslaGroupListItem {
  shareValue: number | null;
  interestFee: number | null;
  monthlyReports: VslaMonthlyReportRow[];
}

function numOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve by uuid OR the human-facing `group_number` (e.g. `ABM-001`),
 * so a list cell can deep-link the group number the same way purchases /
 * primary-evac do with their business ids.
 */
export async function getVslaGroup(
  id: string,
  activeCoopId: string,
): Promise<VslaGroupDetail | null> {
  const idMatch = UUID_RE.test(id)
    ? or(eq(vslaGroups.id, id), eq(vslaGroups.groupNumber, id))
    : eq(vslaGroups.groupNumber, id);
  const [row] = await db
    .select({
      id: vslaGroups.id,
      groupNumber: vslaGroups.groupNumber,
      groupName: vslaGroups.groupName,
      enumeratorId: vslaGroups.enumeratorId,
      enumeratorPrefix: vslaGroups.enumeratorPrefix,
      communityWorkerName: vslaGroups.communityWorkerName,
      cooperativeId: vslaGroups.cooperativeId,
      cooperativeName: cooperatives.name,
      cooperativeCode: cooperatives.code,
      society: vslaGroups.society,
      shareValue: vslaGroups.shareValue,
      interestFee: vslaGroups.interestFee,
      latestReportMonth: vslaGroups.latestReportMonth,
      latestActiveMembers: vslaGroups.latestActiveMembers,
      latestSavingsCumulative: vslaGroups.latestSavingsCumulative,
      latestLateLoansCount: vslaGroups.latestLateLoansCount,
      latestHasDiscrepancy: vslaGroups.latestHasDiscrepancy,
      reportCount: vslaGroups.reportCount,
      discrepancyCount: vslaGroups.discrepancyCount,
    })
    .from(vslaGroups)
    .leftJoin(cooperatives, eq(vslaGroups.cooperativeId, cooperatives.id))
    .where(and(idMatch, scopeCondition(activeCoopId)))
    .limit(1);
  if (!row) return null;

  const reports = await db
    .select({
      id: vslaMonthlyReports.id,
      koboUuid: vslaMonthlyReports.koboUuid,
      reportMonth: vslaMonthlyReports.reportMonth,
      activeMembersAtVisit: vslaMonthlyReports.activeMembersAtVisit,
      maleMembers: vslaMonthlyReports.maleMembers,
      femaleMembers: vslaMonthlyReports.femaleMembers,
      savingsCumulative: vslaMonthlyReports.savingsCumulative,
      savingsValueMonth: vslaMonthlyReports.savingsValueMonth,
      lateLoansCount: vslaMonthlyReports.lateLoansCount,
      lateLoansUnpaidBalance: vslaMonthlyReports.lateLoansUnpaidBalance,
      activeLoansCount: vslaMonthlyReports.activeLoansCount,
      activeLoansValue: vslaMonthlyReports.activeLoansValue,
      cashLoanFund: vslaMonthlyReports.cashLoanFund,
      cashSocialFund: vslaMonthlyReports.cashSocialFund,
      verifyLoanFundMatch: vslaMonthlyReports.verifyLoanFundMatch,
      verifySocialFundMatch: vslaMonthlyReports.verifySocialFundMatch,
      verifyRegisterLoanFund: vslaMonthlyReports.verifyRegisterLoanFund,
      verifyRegisterSocialFund: vslaMonthlyReports.verifyRegisterSocialFund,
      hasDiscrepancy: vslaMonthlyReports.hasDiscrepancy,
      comments: vslaMonthlyReports.comments,
      submittedAt: vslaMonthlyReports.submittedAt,
    })
    .from(vslaMonthlyReports)
    // row.id (not the raw param) — `id` may be a group_number.
    .where(eq(vslaMonthlyReports.groupId, row.id))
    .orderBy(desc(vslaMonthlyReports.reportMonth));

  return {
    id: row.id,
    groupNumber: row.groupNumber,
    groupName: row.groupName,
    enumeratorId: row.enumeratorId,
    enumeratorPrefix: row.enumeratorPrefix,
    cooperativeId: row.cooperativeId,
    cooperativeName: row.cooperativeName,
    cooperativeCode: row.cooperativeCode,
    society: row.society,
    communityWorkerName: row.communityWorkerName,
    shareValue: numOrNull(row.shareValue),
    interestFee: numOrNull(row.interestFee),
    latestReportMonth: row.latestReportMonth,
    latestActiveMembers: row.latestActiveMembers,
    latestSavingsCumulative: numOrNull(row.latestSavingsCumulative),
    latestLateLoansCount: row.latestLateLoansCount,
    latestHasDiscrepancy: row.latestHasDiscrepancy,
    reportCount: row.reportCount,
    discrepancyCount: row.discrepancyCount,
    monthlyReports: reports.map((r) => ({
      id: r.id,
      koboUuid: r.koboUuid,
      reportMonth: r.reportMonth,
      activeMembersAtVisit: r.activeMembersAtVisit,
      maleMembers: r.maleMembers,
      femaleMembers: r.femaleMembers,
      savingsCumulative: numOrNull(r.savingsCumulative),
      savingsValueMonth: numOrNull(r.savingsValueMonth),
      lateLoansCount: r.lateLoansCount,
      lateLoansUnpaidBalance: numOrNull(r.lateLoansUnpaidBalance),
      activeLoansCount: r.activeLoansCount,
      activeLoansValue: numOrNull(r.activeLoansValue),
      cashLoanFund: numOrNull(r.cashLoanFund),
      cashSocialFund: numOrNull(r.cashSocialFund),
      verifyLoanFundMatch: r.verifyLoanFundMatch,
      verifySocialFundMatch: r.verifySocialFundMatch,
      verifyRegisterLoanFund: r.verifyRegisterLoanFund,
      verifyRegisterSocialFund: r.verifyRegisterSocialFund,
      hasDiscrepancy: r.hasDiscrepancy,
      comments: r.comments,
      submittedAt: r.submittedAt.toISOString(),
    })),
  };
}
