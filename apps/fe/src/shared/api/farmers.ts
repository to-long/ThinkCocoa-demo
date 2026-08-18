/**
 * SWR hooks + mutation helpers for `/api/farmers`.
 *
 * Mirrors the users API shape:
 *   - List key is `['/api/farmers', normalizedQuery]` so each filter
 *     combination caches independently.
 *   - Mutations optimistically patch the list + detail caches, then
 *     revalidate; rollback on error via plain revalidate.
 *   - `deletedAt` is returned unconditionally — clients can render the
 *     "Deleted" badge + Restore action without an extra fetch.
 */

import type { CreateFarmerInput, UpdateFarmerInput } from '@kuanadata/shared';
import {
  deleteApiFarmersById,
  getApiFarmers,
  getApiFarmersById,
  getApiFarmersFullStats,
  getApiFarmersStats,
  patchApiFarmersById,
  postApiFarmers,
  postApiFarmersByIdRestore,
} from '@kuanadata/shared/kuana-data-client';
import useSWR, { mutate as globalMutate } from 'swr';
import { API_BASE, quietFetch, unwrap, warm } from './fetcher';

export interface ApiFarmer {
  id: string;
  cooperativeId: string;
  cooperativeCode: string;
  cooperativeName: string;
  districtName: string | null;
  society: string | null;
  farmerCode: string;
  externalSource: string | null;
  producerId: string | null;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  nationalIdNumber: string | null;
  nationalIdType: string | null;
  dataCollectionConsent: boolean | null;
  certificationStatus: string;
  /** RA certificate — number, who audited, when, and when it lapses. */
  raCertificateNumber: string | null;
  raAuditDate: string | null;
  raExpiryDate: string | null;
  raCertifyingBody: string | null;
  registrationDate: string | null;
  householdSize: number | null;
  childrenCount: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Latest inspection-derived certification for this farmer. Null
   *  when no inspection exists yet. `outcome` is one of
   *  `certified` | `certified_with_ca` | `not_certified`. */
  latestCertification: {
    inspectionId: number;
    dateInspection: string;
    /** Raw compliance score (numerator). Max is 142 per RA scoring. */
    complianceScore: number | null;
    compliancePct: number | null;
    programYear: number | null;
    outcome: 'certified' | 'certified_with_ca' | 'not_certified' | 'disqualified' | null;
  } | null;
  /** Farmer-level shade tree survival — arithmetic mean of parcels'
   *  survival % across parcels that have shade trees. Null when the
   *  farmer has no shade tree profiles yet. */
  shadeSurvivalPct: number | null;
  /** Count of not-yet-done corrective actions (open + reopen +
   *  processing) across this farmer's inspections. */
  correctiveActions: number;
}

export interface FarmersListResponse {
  items: ApiFarmer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FarmerStatsBreakdown {
  name: string;
  count: number;
}

/**
 * Slim stats — matches the Pencil design on the farmer list page.
 * Strict subset of `FarmerFullStats`; the BE slices the same cached
 * computation into this shape on `/api/farmers/stats`.
 */
export type CertOutcomeBucket =
  | 'certified'
  | 'certified_with_ca'
  | 'not_certified'
  | 'disqualified'
  | 'none';

export interface FarmerStats {
  total: number;
  active: number;
  inactive: number;
  deleted: number;
  raCertified: number;
  withConsent: number;
  byTenure: Array<{ bucket: string; count: number }>;
  /** Farmers grouped by their most-recent inspection outcome. `none`
   *  = farmer has no inspection yet. Sums to `total`. */
  byCertificationOutcome: Array<{ outcome: CertOutcomeBucket; count: number }>;
}

/**
 * Full stats — every computed metric. Served by `/api/farmers/full-stats`
 * and consumed by the dashboard's detailed view.
 */
export interface FarmerFullStats extends FarmerStats {
  byCooperative: Array<{ code: string; name: string; count: number }>;
  withPhone: number;
  withNationalId: number;
  byDistrict: Array<{ code: string | null; name: string | null; count: number }>;
  bySociety: Array<{ society: string; count: number }>;
  // Demographic breakdowns. Buckets are stable keys (not localized) —
  // FE resolves display labels via `farmers.sex.*` / `farmers.householdSize.*`
  // / `farmers.childrenCount.*` i18n namespaces.
  bySex: Array<{ sex: string; count: number }>;
  byHouseholdSize: Array<{ bucket: string; count: number }>;
  byChildrenCount: Array<{ bucket: string; count: number }>;
}

// ── Keys ──────────────────────────────────────────────────────────────────

export interface FarmersListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  cooperativeCode?: string;
  society?: string;
  certificationStatus?: string;
  /** `valid` | `expiring` | `expired` | `none`. */
  certExpiry?: string;
  isActive?: boolean;
  includeDeleted?: boolean;
  /** JSON:API sort spec — `field` (asc) / `-field` (desc). Supported
   *  fields on the BE: `name`, `farmer_code`, `registration_date`. */
  sort?: string;
}

export function farmersListKey(params: FarmersListParams = {}) {
  return ['/api/farmers', normalizeListParams(params)] as const;
}

export function farmerKey(id: string) {
  return ['/api/farmers', id] as const;
}

/** Stable SWR keys for the two stats shapes. Slim card on the list
 *  page + detailed view on the dashboard share BE cache but have
 *  distinct FE cache entries because the payload shape differs. */
export const FARMER_STATS_KEY = ['/api/farmers/stats'] as const;
export const FARMER_FULL_STATS_KEY = ['/api/farmers/full-stats'] as const;

function matchFarmersList(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/farmers' && typeof key[1] === 'object';
}

function matchFarmerStats(key: unknown): boolean {
  return (
    Array.isArray(key) && (key[0] === '/api/farmers/stats' || key[0] === '/api/farmers/full-stats')
  );
}

/** Invalidate list pages + both stats shapes together — every write
 *  mutation does this so every dashboard surface sees the new number
 *  immediately (BE invalidates its LRU cache on the same path). */
async function revalidateFarmers(): Promise<void> {
  await Promise.all([globalMutate(matchFarmersList), globalMutate(matchFarmerStats)]);
}

function normalizeListParams(p: FarmersListParams) {
  const out: Record<string, string | number | boolean> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.cooperativeCode) out.cooperativeCode = p.cooperativeCode;
  if (p.society) out.society = p.society;
  if (p.certificationStatus) out.certificationStatus = p.certificationStatus;
  if (p.certExpiry) out.certExpiry = p.certExpiry;
  if (p.isActive !== undefined) out.isActive = p.isActive;
  if (p.includeDeleted) out.includeDeleted = true;
  if (p.sort) out.sort = p.sort;
  return out;
}

// ── Queries ───────────────────────────────────────────────────────────────

export function useFarmersList(params: FarmersListParams = {}) {
  return useSWR<FarmersListResponse>(
    farmersListKey(params),
    async () => {
      const query: Record<string, string> = {};
      if (params.page != null) query.page = String(params.page);
      if (params.pageSize != null) query.pageSize = String(params.pageSize);
      if (params.q) query.q = params.q;
      if (params.cooperativeCode) query.cooperativeCode = params.cooperativeCode;
      if (params.society) query.society = params.society;
      if (params.certificationStatus) query.certificationStatus = params.certificationStatus;
      if (params.certExpiry) query.certExpiry = params.certExpiry;
      if (params.isActive !== undefined) query.isActive = params.isActive ? 'true' : 'false';
      if (params.includeDeleted) query.includeDeleted = 'true';
      if (params.sort) query.sort = params.sort;
      const res = await getApiFarmers({ query });
      return unwrap(res) as FarmersListResponse;
    },
    {
      // Page / filter changes mint a new SWR key. Without this, the
      // hook drops back to `undefined` for one render while the new
      // request is in flight — which the page reads as `isLoading`
      // and renders the skeleton, causing the visible flash + height
      // collapse the user reported. `keepPreviousData` carries the
      // previous response forward until the new one resolves, so the
      // table stays in place; the page can still distinguish "new
      // fetch" via `isValidating` and dim the row instead of swapping
      // out the layout.
      keepPreviousData: true,
    },
  );
}

export function useFarmer(id: string | undefined | null) {
  return useSWR<ApiFarmer>(id ? farmerKey(id) : null, async () => {
    const res = await getApiFarmersById({ path: { id: id as string } });
    return unwrap(res) as ApiFarmer;
  });
}

/**
 * Slim stats (Pencil-matched subset) for the farmer list's inline
 * statsRow. Cached under a single key — unfiltered and shared across
 * every filter combination on the list so the card data is the same
 * regardless of current view.
 */
export function useFarmerStats() {
  return useSWR<FarmerStats>(
    FARMER_STATS_KEY,
    async () => unwrap(await getApiFarmersStats()) as FarmerStats,
    { revalidateOnFocus: false },
  );
}

/**
 * Full stats (every computed metric — compliance counts, district +
 * village breakdowns). Consumed by the dashboard's detailed view.
 * The BE computes a single shared result internally; this hook just
 * receives the full slice of it.
 */
export function useFarmerFullStats() {
  return useSWR<FarmerFullStats>(
    FARMER_FULL_STATS_KEY,
    // Cast via `unknown` — the FE `FarmerFullStats` has fields that
    // haven't been picked up by the generated OpenAPI types yet.
    // Actual runtime shape matches (BE zod schema is canonical); regen
    // via `bun run kuana-data-client:refresh` when the drift is due.
    async () => unwrap(await getApiFarmersFullStats()) as unknown as FarmerFullStats,
    { revalidateOnFocus: false },
  );
}

/** Warm the default (page 1, no filter) Farmers list + full stats into the
 *  SWR cache so a navigation to /farmers paints from cache instead of a
 *  skeleton. Keys/URLs mirror exactly what the page loads on a fresh
 *  landing (coop comes from the cookie, not the key). quietFetch keeps a
 *  rejected speculative warm silent (no 401/403 redirect). */
export function prefetchFarmersList(): void {
  void warm(farmersListKey({ page: 1, pageSize: 10 }), () =>
    quietFetch<FarmersListResponse>('/api/farmers?page=1&pageSize=10'),
  ).catch(() => {});
  void warm(FARMER_FULL_STATS_KEY, () =>
    quietFetch<FarmerFullStats>('/api/farmers/full-stats'),
  ).catch(() => {});
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createFarmer(body: CreateFarmerInput): Promise<ApiFarmer> {
  const res = await postApiFarmers({ body });
  const created = unwrap(res) as ApiFarmer;
  await revalidateFarmers();
  return created;
}

// ── Bulk CSV import ──────────────────────────────────────────────
export interface CsvImportSkipped {
  row: number;
  reason: string;
  coop?: string;
  producerId?: string;
}
export interface CsvImportSummary {
  totalRows: number;
  farmersUpserted: number;
  parcelsUpserted: number;
  skipped: CsvImportSkipped[];
}
export interface CsvImportResponse {
  kind: 'ok' | 'no_rows' | 'unknown_coop';
  summary: CsvImportSummary;
  unknownCoops: string[];
}

/**
 * POST /api/farmers/import-csv — bulk upsert farmers + parcels from a
 * CSV blob. The BE endpoint is registered as a plain multipart route
 * (not OpenAPI) because `@hono/zod-openapi` doesn't type-generate
 * multipart bodies well, so we bypass the generated client here and
 * hand-craft the request. Same-origin cookie session applies, no
 * extra auth headers needed.
 *
 * Revalidates the farmers list + stats on success so the new/updated
 * rows show up without a manual refetch.
 */
export async function importFarmersCsv(file: File): Promise<CsvImportResponse> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/farmers/import-csv', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Import failed with status ${res.status}`);
  }
  const json = (await res.json()) as CsvImportResponse;
  await revalidateFarmers();
  return json;
}

/**
 * Download the current filtered farmer set as CSV (2025-2026 dataset
 * layout). Streams from the BE with the same filter query params as the
 * list, then triggers a browser download. Credentials included so the
 * better-auth cookie travels with the GET.
 */
export async function downloadFarmersCsv(
  params: Record<string, string | undefined>,
): Promise<void> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const res = await fetch(`${API_BASE}/api/farmers/export-csv${qs.toString() ? `?${qs}` : ''}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Export failed with status ${res.status}`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  const cd = res.headers.get('Content-Disposition') ?? '';
  a.download = cd.match(/filename="([^"]+)"/)?.[1] ?? 'farmers.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export async function updateFarmer(id: string, patch: UpdateFarmerInput): Promise<ApiFarmer> {
  const detailKey = farmerKey(id);

  // Optimistic: patch whichever fields we know are set. Full response
  // from server replaces the optimistic copy afterward.
  const apply = (f: ApiFarmer): ApiFarmer => ({ ...f, ...(patch as Partial<ApiFarmer>) });
  globalMutate(detailKey, (current?: ApiFarmer) => current && apply(current), {
    revalidate: false,
  });
  globalMutate(
    matchFarmersList,
    (current?: FarmersListResponse) =>
      current && {
        ...current,
        items: current.items.map((f) => (f.id === id ? apply(f) : f)),
      },
    { revalidate: false },
  );

  try {
    const res = await patchApiFarmersById({ path: { id }, body: patch });
    const updated = unwrap(res) as ApiFarmer;
    globalMutate(detailKey, updated, { revalidate: false });
    await revalidateFarmers();
    return updated;
  } catch (err) {
    globalMutate(detailKey);
    await revalidateFarmers();
    throw err;
  }
}

export async function deleteFarmer(id: string): Promise<void> {
  const detailKey = farmerKey(id);

  globalMutate(
    matchFarmersList,
    (current?: FarmersListResponse) =>
      current && {
        ...current,
        items: current.items.filter((f) => f.id !== id),
        total: Math.max(0, current.total - 1),
      },
    { revalidate: false },
  );

  try {
    const res = await deleteApiFarmersById({ path: { id } });
    unwrap(res);
    globalMutate(detailKey, undefined, { revalidate: false });
    await revalidateFarmers();
  } catch (err) {
    await revalidateFarmers();
    throw err;
  }
}

/**
 * Undo a prior soft-delete. No optimistic update — the row only lives in
 * the `includeDeleted:true` cache, which we refetch to pick up the
 * server-returned `deletedAt=null` shape.
 */
export async function restoreFarmer(id: string): Promise<ApiFarmer> {
  const detailKey = farmerKey(id);
  try {
    const res = await postApiFarmersByIdRestore({ path: { id } });
    const restored = unwrap(res) as ApiFarmer;
    globalMutate(detailKey, restored, { revalidate: false });
    await revalidateFarmers();
    return restored;
  } catch (err) {
    globalMutate(detailKey);
    await revalidateFarmers();
    throw err;
  }
}
