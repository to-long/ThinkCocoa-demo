/**
 * SWR hooks for `/api/vsla`.
 *
 *   • useVslaList     — paginated group list (one row per group)
 *   • useVslaStats    — 4-card metrics
 *   • useVslaGroup    — single group + full monthly report history
 *
 * Tenant scope is honoured via the `active-coop-id` cookie on every
 * request; the BE returns cross-coop rows (cooperative_id IS NULL)
 * under every active-coop scope. No per-page coop filter.
 */

import useSWR from 'swr';
import { apiFetch, quietFetch, warm } from './fetcher';

export interface ApiVslaListItem {
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

export interface VslaListResponse {
  items: ApiVslaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VslaStats {
  activeGroups: number;
  activeMembers: number;
  cumulativeSavings: number;
  groupsWithDiscrepancy: number;
  societies: string[];
}

export interface ApiVslaMonthlyReport {
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

export interface ApiVslaGroup extends ApiVslaListItem {
  communityWorkerName: string | null;
  shareValue: number | null;
  interestFee: number | null;
  monthlyReports: ApiVslaMonthlyReport[];
}

export interface VslaListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  discrepancy?: 'yes' | 'no';
  society?: string; // CSV
  sort?: string;
}

export const VSLA_STATS_KEY = ['/api/vsla/stats'] as const;

export function vslaKey(id: string) {
  return ['/api/vsla', id] as const;
}

function normalize(p: VslaListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.discrepancy) out.discrepancy = p.discrepancy;
  if (p.society) out.society = p.society;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function vslaListKey(params: VslaListParams = {}) {
  return ['/api/vsla', normalize(params)] as const;
}

function buildQuery(p: VslaListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.discrepancy) sp.set('discrepancy', p.discrepancy);
  if (p.society) sp.set('society', p.society);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useVslaList(params: VslaListParams = {}) {
  return useSWR<VslaListResponse>(
    vslaListKey(params),
    () => apiFetch<VslaListResponse>(`/api/vsla${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useVslaStats() {
  return useSWR<VslaStats>(VSLA_STATS_KEY, () => apiFetch<VslaStats>('/api/vsla/stats'), {
    revalidateOnFocus: false,
  });
}

/** Warm the default VSLA list + stats (see prefetchParcelsList). */
export function prefetchVslaList(): void {
  const p: VslaListParams = { page: 1, pageSize: 10 };
  void warm(vslaListKey(p), () => quietFetch<VslaListResponse>(`/api/vsla${buildQuery(p)}`)).catch(
    () => {},
  );
  void warm(VSLA_STATS_KEY, () => quietFetch<VslaStats>('/api/vsla/stats')).catch(() => {});
}

export function useVslaGroup(id: string | null | undefined) {
  return useSWR<ApiVslaGroup>(id ? vslaKey(id) : null, () =>
    apiFetch<ApiVslaGroup>(`/api/vsla/${encodeURIComponent(id as string)}`),
  );
}

// ── Member ledger ────────────────────────────────────────────────
// Per-farmer savings + loan view inside a group. Derived server-side from
// the group's own report figures (see `apps/be/src/features/vsla/members.ts`)
// — the Kobo form is group-level, so there is no member table.

export type VslaLoanStatus = 'none' | 'active' | 'late' | 'repaid';

export interface ApiVslaMember {
  farmerId: string;
  farmerName: string;
  society: string | null;
  sex: string | null;
  joinedMonth: string | null;
  sharesOwned: number;
  savingsBalance: number;
  loanOutstanding: number;
  loanStatus: VslaLoanStatus;
}

export interface ApiVslaMemberLedger extends ApiVslaMember {
  groupId: string;
  groupNumber: string;
  groupName: string;
  shareValue: number | null;
  savings: Array<{ month: string; contribution: number; balance: number }>;
  loans: Array<{
    id: string;
    disbursedOn: string;
    dueOn: string;
    principal: number;
    interestRate: number | null;
    repaid: number;
    outstanding: number;
    status: 'active' | 'late' | 'repaid';
  }>;
  totals: {
    contributed: number;
    loansTaken: number;
    loansRepaid: number;
    loansOutstanding: number;
  };
}

export const vslaMembersKey = (groupId: string) => ['/api/vsla', groupId, 'members'] as const;

export function useVslaMembers(groupId: string | null | undefined) {
  return useSWR<{ items: ApiVslaMember[] }>(groupId ? vslaMembersKey(groupId) : null, () =>
    apiFetch<{ items: ApiVslaMember[] }>(
      `/api/vsla/${encodeURIComponent(groupId as string)}/members`,
    ),
  );
}

export function useVslaMemberLedger(
  groupId: string | null | undefined,
  farmerId: string | null | undefined,
) {
  return useSWR<ApiVslaMemberLedger>(
    groupId && farmerId ? ['/api/vsla', groupId, 'members', farmerId] : null,
    () =>
      apiFetch<ApiVslaMemberLedger>(
        `/api/vsla/${encodeURIComponent(groupId as string)}/members/${encodeURIComponent(
          farmerId as string,
        )}`,
      ),
  );
}
