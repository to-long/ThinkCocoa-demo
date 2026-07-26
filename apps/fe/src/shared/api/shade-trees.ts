/**
 * SWR hooks for `/api/shade-trees`. Backed by the Kobo `shade_trees`
 * form projected into `shade.tree_profiling` + `shade.survival_checks`.
 */

import useSWR from 'swr';
import { apiFetch } from './fetcher';

export interface ApiShadeTreeListItem {
  id: string;
  koboUuid: string;
  cooperativeId: string | null;
  farmerId: string | null;
  farmerName: string | null;
  parcelId: string | null;
  district: string | null;
  society: string | null;
  dateObserved: string;
  species: string;
  treeTagNum: string | null;
  heightClass: string | null;
  treeCondition: string | null;
  isAlive: boolean;
  photoFilename: string | null;
  submittedAt: string;
}

export interface ShadeTreeListResponse {
  items: ApiShadeTreeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ShadeTreeSpeciesBreakdown {
  species: string;
  count: number;
  aliveCount: number;
}

export interface ShadeTreeStats {
  totalTrees: number;
  aliveTrees: number;
  deadTrees: number;
  parcelsWithShade: number;
  farmersWithShade: number;
  avgSurvivalPct: number | null;
  speciesBreakdown: ShadeTreeSpeciesBreakdown[];
}

export interface ApiShadeTreeDetail extends ApiShadeTreeListItem {
  cooperativeName: string | null;
  cooperativeCode: string | null;
  enumerator: string | null;
  dbhCm: number | null;
  gpsPoint: string | null;
  formVersion: string;
  koboId: number;
  rawData: Record<string, unknown>;
  snapshotUrl: string | null;
  submittedBy: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShadeTreesListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  farmerId?: string;
  parcelId?: string;
  species?: string;
  condition?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
}

export const SHADE_TREES_STATS_KEY = ['/api/shade-trees/stats'] as const;

export function shadeTreeKey(id: string) {
  return ['/api/shade-trees', id] as const;
}

export function useShadeTree(id: string | null | undefined) {
  return useSWR<ApiShadeTreeDetail>(id ? shadeTreeKey(id) : null, () =>
    apiFetch<ApiShadeTreeDetail>(`/api/shade-trees/${encodeURIComponent(id as string)}`),
  );
}

function normalize(p: ShadeTreesListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.farmerId) out.farmerId = p.farmerId;
  if (p.parcelId) out.parcelId = p.parcelId;
  if (p.species) out.species = p.species;
  if (p.condition) out.condition = p.condition;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function shadeTreesListKey(params: ShadeTreesListParams = {}) {
  return ['/api/shade-trees', normalize(params)] as const;
}

function buildQuery(p: ShadeTreesListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.farmerId) sp.set('farmerId', p.farmerId);
  if (p.parcelId) sp.set('parcelId', p.parcelId);
  if (p.species) sp.set('species', p.species);
  if (p.condition) sp.set('condition', p.condition);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useShadeTreesList(params: ShadeTreesListParams = {}) {
  return useSWR<ShadeTreeListResponse>(
    shadeTreesListKey(params),
    () => apiFetch<ShadeTreeListResponse>(`/api/shade-trees${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useShadeTreesStats() {
  return useSWR<ShadeTreeStats>(
    SHADE_TREES_STATS_KEY,
    () => apiFetch<ShadeTreeStats>('/api/shade-trees/stats'),
    { revalidateOnFocus: false },
  );
}
