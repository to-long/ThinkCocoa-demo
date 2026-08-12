/**
 * SWR hooks for `/api/purchases`. Mirrors coaching/training shape.
 */

import useSWR, { preload } from 'swr';
import { apiFetch, quietFetch } from './fetcher';

export type PaymentType = 'cash' | 'mobile_money' | 'cheque' | 'card';

export interface ApiPurchaseListItem {
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
  paymentType: PaymentType;
  paymentReference: string | null;
  isOrphan: boolean;
  submittedAt: string;
}

export interface PurchaseListResponse {
  items: ApiPurchaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurchaseStats {
  totalPurchases: number;
  totalWeightKg: number;
  totalAmount: number;
  blendedRateGhsPerKg: number | null;
  activePcs: number;
  activeSocieties: number;
  activeFarmers: number;
  paymentBreakdown: { cash: number; mobile_money: number; cheque: number; card: number };
  topDistricts: { district: string; count: number }[];
  societies: string[];
  /** Purchase counts for the trailing 12 months (oldest → newest),
   *  `month` = `YYYY-MM`. Gaps filled with 0. */
  monthlyPurchases: { month: string; count: number }[];
}

export interface PurchaseListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  /** Exact farmer id — the farmer detail page's deliveries tile. */
  farmerId?: string;
  dateFrom?: string;
  dateTo?: string;
  district?: string; // CSV
  society?: string; // CSV
  payment?: string; // CSV
  sort?: string;
}

export interface ApiPurchaseDetail extends ApiPurchaseListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  rawData: Record<string, unknown>;
  formVersion: string;
  koboId: number;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const PURCHASE_STATS_KEY = ['/api/purchases/stats'] as const;

export function purchaseKey(id: string) {
  return ['/api/purchases', id] as const;
}

export function usePurchase(id: string | null | undefined) {
  return useSWR<ApiPurchaseDetail>(id ? purchaseKey(id) : null, () =>
    apiFetch<ApiPurchaseDetail>(`/api/purchases/${encodeURIComponent(id as string)}`),
  );
}

function normalize(p: PurchaseListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.farmerId) out.farmerId = p.farmerId;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.district) out.district = p.district;
  if (p.society) out.society = p.society;
  if (p.payment) out.payment = p.payment;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function purchaseListKey(params: PurchaseListParams = {}) {
  return ['/api/purchases', normalize(params)] as const;
}

/** Warm the default (page 1) purchases list + stats into SWR cache — route prefetch. */
export function prefetchPurchaseList(): void {
  const p: PurchaseListParams = { page: 1, pageSize: 10 };
  void preload(purchaseListKey(p), () => quietFetch(`/api/purchases${buildQuery(p)}`)).catch(
    () => {},
  );
  void preload(PURCHASE_STATS_KEY, () => quietFetch(PURCHASE_STATS_KEY[0])).catch(() => {});
}

function buildQuery(p: PurchaseListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.farmerId) sp.set('farmerId', p.farmerId);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.district) sp.set('district', p.district);
  if (p.society) sp.set('society', p.society);
  if (p.payment) sp.set('payment', p.payment);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function usePurchasesList(params: PurchaseListParams = {}) {
  return useSWR<PurchaseListResponse>(
    purchaseListKey(params),
    () => apiFetch<PurchaseListResponse>(`/api/purchases${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function usePurchaseStats() {
  return useSWR<PurchaseStats>(
    PURCHASE_STATS_KEY,
    () => apiFetch<PurchaseStats>('/api/purchases/stats'),
    { revalidateOnFocus: false },
  );
}
