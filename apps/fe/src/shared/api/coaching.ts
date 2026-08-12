/**
 * SWR hooks for `/api/coaching-visits`.
 * Mirrors the inspections SWR module shape.
 */

import useSWR from 'swr';
import { apiFetch, quietFetch, warm } from './fetcher';
import type { InspectionFollowUp } from './inspections';

export type ClmrsRiskLevel = 'no_risk' | 'at_risk' | 'case';

export interface ApiCoachingVisitListItem {
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
  clmrsRiskLevel: ClmrsRiskLevel | null;
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
  /** Count of not-done corrective actions raised by this visit's non-compliance. */
  correctiveActions: number;
  isOrphan: boolean;
  submittedAt: string;
}

export interface CoachingListResponse {
  items: ApiCoachingVisitListItem[];
  total: number;
  page: number;
  pageSize: number;
}

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

export interface CoachingListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  clmrsRisk?: string; // CSV
  coaches?: string; // CSV
  followUpOnly?: boolean;
  sort?: string;
}

export interface ApiCoachingVisitDetail extends ApiCoachingVisitListItem {
  followUps: InspectionFollowUp[];
  // Kobo raw payload is gone since the decouple — the BE no longer returns
  // it. Optional so the detail page reads structured columns and treats the
  // legacy raw-derived sections as empty instead of crashing.
  rawData?: Record<string, unknown>;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const COACHING_STATS_KEY = ['/api/coaching-visits/stats'] as const;

export function coachingKey(id: string) {
  return ['/api/coaching-visits', id] as const;
}

export function useCoachingVisit(id: string | null | undefined) {
  return useSWR<ApiCoachingVisitDetail>(id ? coachingKey(id) : null, () =>
    apiFetch<ApiCoachingVisitDetail>(`/api/coaching-visits/${encodeURIComponent(id as string)}`),
  );
}

function normalize(p: CoachingListParams) {
  const out: Record<string, string | number | boolean> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.clmrsRisk) out.clmrsRisk = p.clmrsRisk;
  if (p.coaches) out.coaches = p.coaches;
  if (p.followUpOnly) out.followUpOnly = p.followUpOnly;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function coachingListKey(params: CoachingListParams = {}) {
  return ['/api/coaching-visits', normalize(params)] as const;
}

/** Warm the default (page 1) coaching list + stats into SWR cache — route prefetch. */
export function prefetchCoachingList(): void {
  const p: CoachingListParams = { page: 1, pageSize: 10 };
  void warm(coachingListKey(p), () => quietFetch(`/api/coaching-visits${buildQuery(p)}`)).catch(
    () => {},
  );
  void warm(COACHING_STATS_KEY, () => quietFetch(COACHING_STATS_KEY[0])).catch(() => {});
}

function buildQuery(p: CoachingListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.clmrsRisk) sp.set('clmrsRisk', p.clmrsRisk);
  if (p.coaches) sp.set('coaches', p.coaches);
  if (p.followUpOnly) sp.set('followUpOnly', 'true');
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useCoachingVisitsList(params: CoachingListParams = {}) {
  return useSWR<CoachingListResponse>(
    coachingListKey(params),
    () => apiFetch<CoachingListResponse>(`/api/coaching-visits${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useCoachingStats() {
  return useSWR<CoachingStats>(
    COACHING_STATS_KEY,
    () => apiFetch<CoachingStats>('/api/coaching-visits/stats'),
    { revalidateOnFocus: false },
  );
}
