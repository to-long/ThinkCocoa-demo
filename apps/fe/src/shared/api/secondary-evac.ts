/**
 * SWR hooks for `/api/secondary-evac`.
 */

import useSWR, { preload } from 'swr';
import { apiFetch, quietFetch } from './fetcher';

export type DdsStatus = 'draft' | 'ready' | 'submitted' | 'accepted' | 'rejected' | 'withdrawn';

export type LotEudrStatus =
  | 'compliant'
  | 'in_review'
  | 'at_risk'
  | 'non_compliant'
  | 'not_assessed';

export interface ApiSecondaryEvacListItem {
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
  eudrStatus: LotEudrStatus;
  submittedAt: string;
}

export interface SecondaryEvacListResponse {
  items: ApiSecondaryEvacListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SecondaryEvacPortBreakdown {
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
  ports: SecondaryEvacPortBreakdown[];
  grades: { grade: string; lots: number }[];
  /** Lots evacuated per month over the trailing 12 months (`YYYY-MM` +
   *  count), gaps filled with 0. */
  monthlyLots: { month: string; count: number }[];
}

export interface SecondaryEvacListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  depot?: string;
  port?: string;
  partner?: string;
  grade?: string;
  sort?: string;
}

export interface ApiTraceabilityPurchaseRow {
  id: string;
  purchaseId: string;
  matched: boolean;
  farmerName: string | null;
  fieldId: string | null;
  purchaseDate: string | null;
  weightKg: number | null;
}

export interface ApiTraceabilityPrimaryLotRow {
  id: string | null;
  primaryWaybillRaw: string;
  primaryWaybillNumber: string | null;
  kgReceived: number | null;
  bagsReceived: number | null;
  evacuationDate: string | null;
  driverName: string | null;
  truckRegistration: string | null;
  sealNumber: string | null;
  purchases: ApiTraceabilityPurchaseRow[];
  purchaseCount: number;
  farmerCount: number;
  plotCount: number;
}

export interface ApiSecondaryEvacDetail extends ApiSecondaryEvacListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  depotGps: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  driverLicenceNumber: string | null;
  qccImageUrl: string | null;
  ddsSubmittedAt: string | null;
  chainDepth: { primaryLots: number; purchases: number };
  linkedFarms: { farmers: number; plots: number };
  primaryLots: ApiTraceabilityPrimaryLotRow[];
  custody: { totalPrimary: number; matchedPrimary: number; orphans: number };
  rawData: Record<string, unknown>;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const SECONDARY_EVAC_STATS_KEY = ['/api/secondary-evac/stats'] as const;

export function secondaryEvacKey(id: string) {
  return ['/api/secondary-evac', id] as const;
}

export function useSecondaryEvacLot(id: string | null | undefined) {
  return useSWR<ApiSecondaryEvacDetail>(id ? secondaryEvacKey(id) : null, () =>
    apiFetch<ApiSecondaryEvacDetail>(`/api/secondary-evac/${encodeURIComponent(id as string)}`),
  );
}

function normalize(p: SecondaryEvacListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.depot) out.depot = p.depot;
  if (p.port) out.port = p.port;
  if (p.partner) out.partner = p.partner;
  if (p.grade) out.grade = p.grade;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function secondaryEvacListKey(params: SecondaryEvacListParams = {}) {
  return ['/api/secondary-evac', normalize(params)] as const;
}

/** Warm the default (page 1) secondary-evac list + stats into SWR cache — route prefetch. */
export function prefetchSecondaryEvacList(): void {
  const p: SecondaryEvacListParams = { page: 1, pageSize: 10 };
  void preload(secondaryEvacListKey(p), () =>
    quietFetch(`/api/secondary-evac${buildQuery(p)}`),
  ).catch(() => {});
  void preload(SECONDARY_EVAC_STATS_KEY, () => quietFetch(SECONDARY_EVAC_STATS_KEY[0])).catch(
    () => {},
  );
}

function buildQuery(p: SecondaryEvacListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.depot) sp.set('depot', p.depot);
  if (p.port) sp.set('port', p.port);
  if (p.partner) sp.set('partner', p.partner);
  if (p.grade) sp.set('grade', p.grade);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useSecondaryEvacList(params: SecondaryEvacListParams = {}) {
  return useSWR<SecondaryEvacListResponse>(
    secondaryEvacListKey(params),
    () => apiFetch<SecondaryEvacListResponse>(`/api/secondary-evac${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useSecondaryEvacStats() {
  return useSWR<SecondaryEvacStats>(
    SECONDARY_EVAC_STATS_KEY,
    () => apiFetch<SecondaryEvacStats>('/api/secondary-evac/stats'),
    { revalidateOnFocus: false },
  );
}
