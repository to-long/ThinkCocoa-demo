/**
 * SWR hooks for `/api/primary-evac`.
 */

import useSWR from 'swr';
import { apiFetch, quietFetch, warm } from './fetcher';

export interface ApiPrimaryEvacListItem {
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

export interface PrimaryEvacListResponse {
  items: ApiPrimaryEvacListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PrimaryEvacWarehouseBreakdown {
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
  warehouses: PrimaryEvacWarehouseBreakdown[];
  /** Lot count per society, descending. */
  bySociety: { society: string; lots: number }[];
  societies: string[];
  /** Lots evacuated per month over the trailing 12 months (`YYYY-MM` +
   *  count), gaps filled with 0. */
  monthlyLots: { month: string; count: number }[];
}

export interface PrimaryEvacListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  warehouse?: string;
  society?: string;
  sort?: string;
}

export interface ApiLotPurchaseEntry {
  id: string;
  purchaseIdRaw: string;
  purchaseId: string | null;
  matched: boolean;
  purchaseDate: string | null;
  farmerId: string | null;
  farmerCode: string | null;
  farmerName: string | null;
  fieldId: string | null;
  weightKg: number | null;
  amountReceived: number | null;
}

export interface ApiPrimaryEvacDetail extends ApiPrimaryEvacListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  sealNumber: string | null;
  lotPhotoUrl: string | null;
  childPurchases: ApiLotPurchaseEntry[];
  rawData: Record<string, unknown>;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const PRIMARY_EVAC_STATS_KEY = ['/api/primary-evac/stats'] as const;

export function primaryEvacKey(id: string) {
  return ['/api/primary-evac', id] as const;
}

export function usePrimaryEvac(id: string | null | undefined) {
  return useSWR<ApiPrimaryEvacDetail>(id ? primaryEvacKey(id) : null, () =>
    apiFetch<ApiPrimaryEvacDetail>(`/api/primary-evac/${encodeURIComponent(id as string)}`),
  );
}

function normalize(p: PrimaryEvacListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.warehouse) out.warehouse = p.warehouse;
  if (p.society) out.society = p.society;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function primaryEvacListKey(params: PrimaryEvacListParams = {}) {
  return ['/api/primary-evac', normalize(params)] as const;
}

/** Warm the default (page 1) primary-evac list + stats into SWR cache — route prefetch. */
export function prefetchPrimaryEvacList(): void {
  const p: PrimaryEvacListParams = { page: 1, pageSize: 10 };
  void warm(primaryEvacListKey(p), () => quietFetch(`/api/primary-evac${buildQuery(p)}`)).catch(
    () => {},
  );
  void warm(PRIMARY_EVAC_STATS_KEY, () => quietFetch(PRIMARY_EVAC_STATS_KEY[0])).catch(() => {});
}

function buildQuery(p: PrimaryEvacListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.warehouse) sp.set('warehouse', p.warehouse);
  if (p.society) sp.set('society', p.society);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function usePrimaryEvacList(params: PrimaryEvacListParams = {}) {
  return useSWR<PrimaryEvacListResponse>(
    primaryEvacListKey(params),
    () => apiFetch<PrimaryEvacListResponse>(`/api/primary-evac${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function usePrimaryEvacStats() {
  return useSWR<PrimaryEvacStats>(
    PRIMARY_EVAC_STATS_KEY,
    () => apiFetch<PrimaryEvacStats>('/api/primary-evac/stats'),
    { revalidateOnFocus: false },
  );
}
