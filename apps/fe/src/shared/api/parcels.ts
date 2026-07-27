/**
 * SWR hooks + mutation helpers for `/api/parcels`.
 *
 * Uses `apiFetch` (raw fetch) rather than the generated SDK — the
 * parcels endpoints landed after the last SDK regen. When the OpenAPI
 * client is next regenerated, this file can move to the typed
 * `getApiParcels` / `postApiParcels` family without changing public
 * shapes.
 */

import type { CreateParcelInput, UpdateParcelInput } from '@thinkcocoa/shared';
import useSWR, { mutate as globalMutate, preload } from 'swr';
import { apiFetch, quietFetch } from './fetcher';

export interface ApiParcel {
  id: string;
  cooperativeId: string;
  cooperativeCode: string;
  cooperativeName: string;
  districtName: string | null;
  farmerId: string;
  farmerFullName: string;
  parcelName: string | null;
  parcelStatus: string;
  cropType: string | null;
  cocoaVariety: string | null;
  treeSpacing: string | null;
  plantingDate: string | null;
  cocoaTreeCount: number | null;
  calculatedAreaHa: number | null;
  nearbyFeatureType: string | null;
  willingToRehabilitate: boolean | null;
  landOwnershipType: string | null;
  eudrStatus: string | null;
  /** The three EUDR verdicts, flattened onto the list row so the table
   *  can badge and filter them. */
  deforestationRisk: string | null;
  protectedAreaRisk: string | null;
  overlap: string | null;
  /** Full EUDR assessment fields (detail endpoint only). Null when the
   *  parcel has no EUDR row. */
  eudr?: {
    overlap: string | null;
    onLand: string | null;
    inCountry: string | null;
    deforestationRisk: string | null;
    protectedAreaRisk: string | null;
    data: string | null;
    explanation: string | null;
    assessedAt: string | null;
    assessedBy: string | null;
    notes: string | null;
  } | null;
  /** Shade tree survival % for this parcel, mirrored from
   *  `shade.survival_checks`. Null when no shade tree profiles exist. */
  shadeSurvivalPct: number | null;
  /** Number of shade tree profiles on this parcel. 0 when none. */
  shadeTreeCount: number;
  /** Outstanding corrective actions across this parcel's inspections. */
  correctiveActions: number;
  geojson?: any | null;
  /** GeoJSON FeatureCollection of nearby EUDR risk zones (detail only). */
  riskZones?: any | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ParcelsListResponse {
  items: ApiParcel[];
  total: number;
  page: number;
  pageSize: number;
}

/** Slim parcel stats — counts for the current coop, matches the
 *  Pencil `wYEE2` stats row card on the list page. */
export interface ParcelStats {
  total: number;
  mapped: number;
  active: number;
  inactive: number;
  archived: number;
  deleted: number;
  eudr: {
    compliant: number;
    needs_review: number;
    non_compliant: number;
    unknown: number;
  };
}

export const PARCEL_STATS_KEY = ['/api/parcels/stats'] as const;

export interface ParcelsListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  cooperativeCode?: string;
  cropType?: string;
  parcelStatus?: string;
  eudr?: string;
  deforestation?: string;
  protectedArea?: string;
  overlap?: string;
  /** Shade-survival band: healthy (≥80) | caution (60–79) |
   *  warning (40–59) | danger (<40) | none (no shade profiles). */
  survival?: string;
  /** Exact farmer-id filter — used by the farmer detail page's
   *  Parcels card. */
  farmerId?: string;
  includeDeleted?: boolean;
  /** JSON:API sort spec — supported fields: `id`, `parcel_name`,
   *  `planting_date`, `area`, `tree_count`. */
  sort?: string;
}

export function parcelsListKey(params: ParcelsListParams = {}) {
  return ['/api/parcels', normalizeListParams(params)] as const;
}

export function parcelKey(id: string) {
  return ['/api/parcels', id] as const;
}

function matchParcelsList(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/parcels' && typeof key[1] === 'object';
}

function matchParcelStats(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/parcels/stats';
}

async function revalidateParcels(): Promise<void> {
  await Promise.all([globalMutate(matchParcelsList), globalMutate(matchParcelStats)]);
}

function normalizeListParams(p: ParcelsListParams) {
  const out: Record<string, string | number | boolean> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.cooperativeCode) out.cooperativeCode = p.cooperativeCode;
  if (p.cropType) out.cropType = p.cropType;
  if (p.parcelStatus) out.parcelStatus = p.parcelStatus;
  if (p.eudr) out.eudr = p.eudr;
  if (p.deforestation) out.deforestation = p.deforestation;
  if (p.protectedArea) out.protectedArea = p.protectedArea;
  if (p.overlap) out.overlap = p.overlap;
  if (p.survival) out.survival = p.survival;
  if (p.farmerId) out.farmerId = p.farmerId;
  if (p.includeDeleted) out.includeDeleted = true;
  if (p.sort) out.sort = p.sort;
  return out;
}

function buildQuery(p: ParcelsListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.cooperativeCode) sp.set('cooperativeCode', p.cooperativeCode);
  if (p.cropType) sp.set('cropType', p.cropType);
  if (p.parcelStatus) sp.set('parcelStatus', p.parcelStatus);
  if (p.eudr) sp.set('eudr', p.eudr);
  if (p.deforestation) sp.set('deforestation', p.deforestation);
  if (p.protectedArea) sp.set('protectedArea', p.protectedArea);
  if (p.overlap) sp.set('overlap', p.overlap);
  if (p.survival) sp.set('survival', p.survival);
  if (p.farmerId) sp.set('farmerId', p.farmerId);
  if (p.includeDeleted) sp.set('includeDeleted', 'true');
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── Queries ───────────────────────────────────────────────────────────────

export function useParcelsList(params: ParcelsListParams = {}) {
  return useSWR<ParcelsListResponse>(
    parcelsListKey(params),
    () => apiFetch<ParcelsListResponse>(`/api/parcels${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useParcelStats() {
  return useSWR<ParcelStats>(PARCEL_STATS_KEY, () => apiFetch<ParcelStats>('/api/parcels/stats'), {
    revalidateOnFocus: false,
  });
}

/** Warm the SWR cache for the default Farms list view (page 1, no
 *  filters) + its stat cards, so a hover→click navigation renders with
 *  data already in hand. Best-effort: a filtered mount just misses the
 *  warmed key and fetches normally. */
export function prefetchParcelsList(): void {
  const p: ParcelsListParams = { page: 1, pageSize: 10 };
  void preload(parcelsListKey(p), () =>
    quietFetch<ParcelsListResponse>(`/api/parcels${buildQuery(p)}`),
  ).catch(() => {});
  void preload(PARCEL_STATS_KEY, () => quietFetch<ParcelStats>('/api/parcels/stats')).catch(
    () => {},
  );
}

export function useParcel(id: string | undefined | null) {
  return useSWR<ApiParcel>(id ? parcelKey(id) : null, () =>
    apiFetch<ApiParcel>(`/api/parcels/${encodeURIComponent(id as string)}`),
  );
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createParcel(body: CreateParcelInput): Promise<ApiParcel> {
  const created = await apiFetch<ApiParcel>('/api/parcels', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await revalidateParcels();
  return created;
}

export async function updateParcel(id: string, patch: UpdateParcelInput): Promise<ApiParcel> {
  const detailKey = parcelKey(id);
  // Optimistic patch.
  const apply = (p: ApiParcel): ApiParcel => ({ ...p, ...(patch as Partial<ApiParcel>) });
  globalMutate(detailKey, (current?: ApiParcel) => current && apply(current), {
    revalidate: false,
  });
  globalMutate(
    matchParcelsList,
    (current?: ParcelsListResponse) =>
      current && {
        ...current,
        items: current.items.map((p) => (p.id === id ? apply(p) : p)),
      },
    { revalidate: false },
  );

  try {
    const updated = await apiFetch<ApiParcel>(`/api/parcels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    globalMutate(detailKey, updated, { revalidate: false });
    await revalidateParcels();
    return updated;
  } catch (err) {
    globalMutate(detailKey);
    await revalidateParcels();
    throw err;
  }
}

export async function deleteParcel(id: string): Promise<void> {
  const detailKey = parcelKey(id);
  globalMutate(
    matchParcelsList,
    (current?: ParcelsListResponse) =>
      current && {
        ...current,
        items: current.items.filter((p) => p.id !== id),
        total: Math.max(0, current.total - 1),
      },
    { revalidate: false },
  );
  try {
    await apiFetch<void>(`/api/parcels/${encodeURIComponent(id)}`, { method: 'DELETE' });
    globalMutate(detailKey, undefined, { revalidate: false });
    await revalidateParcels();
  } catch (err) {
    await revalidateParcels();
    throw err;
  }
}

export async function restoreParcel(id: string): Promise<ApiParcel> {
  const detailKey = parcelKey(id);
  try {
    const restored = await apiFetch<ApiParcel>(`/api/parcels/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
    globalMutate(detailKey, restored, { revalidate: false });
    await revalidateParcels();
    return restored;
  } catch (err) {
    globalMutate(detailKey);
    await revalidateParcels();
    throw err;
  }
}

// ── Bulk Imports ─────────────────────────────────────────────────────────

export interface GeoJsonImportResponse {
  summary: {
    totalFeatures: number;
    upserted: number;
    skipped: Array<{ parcelId?: string; reason: string }>;
  };
}

export async function importGeoJson(
  file: File,
  mapping: { parcelId: string; capturedAt: string },
): Promise<GeoJsonImportResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', JSON.stringify(mapping));

  const res = await fetch('/api/parcels/import-geojson', {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new Error(msg || 'Failed to import GeoJSON');
  }
  await revalidateParcels();
  return (await res.json()) as GeoJsonImportResponse;
}

export async function validateGeoJsonIds(ids: string[]): Promise<{ matchCount: number }> {
  const res = await fetch('/api/parcels/validate-geojson-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    throw new Error('Failed to validate GeoJSON IDs');
  }
  return await res.json();
}

export interface EudrCsvImportResponse {
  summary: {
    totalRows: number;
    upserted: number;
    skipped: Array<{ row: number; parcelId?: string; reason: string }>;
  };
}

export async function importEudrCsv(
  file: File,
  mapping: Record<string, string>,
): Promise<EudrCsvImportResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', JSON.stringify(mapping));

  const res = await fetch('/api/parcels/import-eudr-csv', {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new Error(msg || 'Failed to import EUDR CSV');
  }
  await revalidateParcels();
  return (await res.json()) as EudrCsvImportResponse;
}
