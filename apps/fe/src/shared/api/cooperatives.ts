/**
 * Cooperatives — SWR hooks + mutation helpers for `/api/cooperatives`.
 *
 * Same shape as `users.ts`: list / detail queries + optimistic-then-
 * revalidate mutations. Every mutation calls `revalidateCooperatives()`
 * after the server confirms so the list and detail caches stay in sync.
 */

import type { CreateCooperativeInput, UpdateCooperativeInput } from '@thinkcocoa/shared';
import {
  deleteApiCooperativesById,
  getApiCooperatives,
  getApiCooperativesById,
  patchApiCooperativesById,
  postApiCooperatives,
} from '@thinkcocoa/shared/think-cocoa-client';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiFetch, unwrap } from './fetcher';

export interface ApiCooperative {
  farmerCodePrefix: string | null;
  id: string;
  code: string;
  name: string;
  description: string | null;
  districtCode: string | null;
  districtName: string | null;
  chairUserId: string | null;
  chairFullName: string | null;
  chairEmail: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  farmerCount: number;
  /** Farmers in this coop with `certificationStatus = 'rainforest_alliance'`. */
  certifiedFarmerCount: number;
  /** Farmers with `dataCollectionConsent = true`. */
  consentingFarmerCount: number;
  parcelCount: number;
  /** Subset of parcels that have been mapped (have `calculated_area_ha`). */
  fieldCount: number;
  /** Sum of `calculated_area_ha` across the cooperative's parcels —
   *  numeric returned as string to preserve precision. */
  totalAreaHa: string | null;
  userCount: number;
}

// ── Keys ──────────────────────────────────────────────────────────────────

export interface CooperativesListParams {
  q?: string;
  includeDeleted?: boolean;
}

/** Server-side response now (post-pagination refactor). FE hooks below
 *  unwrap `.data` so existing callers keep seeing a flat array — when
 *  the dataset grows past `LIST_PAGE_SIZE` we'll move admin / multi-
 *  select to true server-driven pagination. */
interface ApiCooperativeListResponse {
  data: ApiCooperative[];
  total: number;
  page: number;
  pageSize: number;
}

/** Same dial as the BE-side clamp (`Math.min(100, …)`). 100 is enough
 *  to cover the full dataset today (4 coops) and gives plenty of head-
 *  room before we have to switch to server-driven pagination. */
const LIST_PAGE_SIZE = 100;

export function cooperativesListKey(params: CooperativesListParams = {}) {
  return ['/api/cooperatives', normalizeListParams(params)] as const;
}

export function cooperativeKey(id: string) {
  return ['/api/cooperatives', id] as const;
}

function matchCooperativesList(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/cooperatives' && typeof key[1] === 'object';
}

function normalizeListParams(p: CooperativesListParams) {
  const out: Record<string, string | boolean> = {};
  if (p.q) out.q = p.q;
  if (p.includeDeleted) out.includeDeleted = true;
  return out;
}

// Back-compat re-export for the existing dialog callers that just want a
// flat list with no filters (`useCooperativesList(true)`). Maps to the
// no-arg list key so we keep one cache entry instead of two.
export const COOPERATIVES_LIST_KEY = cooperativesListKey();

// ── Queries ───────────────────────────────────────────────────────────────

export function useCooperativesList(enabled: boolean = true) {
  return useSWR<ApiCooperative[]>(
    enabled ? cooperativesListKey() : null,
    async () => {
      const res = await getApiCooperatives({
        query: { pageSize: String(LIST_PAGE_SIZE) },
      });
      const body = unwrap(res) as ApiCooperativeListResponse;
      return body.data;
    },
    { revalidateOnFocus: false },
  );
}

export function useCooperativesAdminList(params: CooperativesListParams = {}) {
  return useSWR<ApiCooperative[]>(cooperativesListKey(params), async () => {
    const query: Record<string, string> = { pageSize: String(LIST_PAGE_SIZE) };
    if (params.q) query.q = params.q;
    if (params.includeDeleted) query.includeDeleted = 'true';
    const res = await getApiCooperatives({ query });
    const body = unwrap(res) as ApiCooperativeListResponse;
    return body.data;
  });
}

export function useCooperative(id: string | undefined | null) {
  return useSWR<ApiCooperative>(id ? cooperativeKey(id) : null, async () => {
    const res = await getApiCooperativesById({ path: { id: id as string } });
    return unwrap(res) as ApiCooperative;
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

async function revalidateCooperatives(): Promise<void> {
  await globalMutate(matchCooperativesList);
}

export async function createCooperative(body: CreateCooperativeInput): Promise<ApiCooperative> {
  const res = await postApiCooperatives({ body });
  const created = unwrap(res) as ApiCooperative;
  await revalidateCooperatives();
  return created;
}

export async function updateCooperative(
  id: string,
  patch: UpdateCooperativeInput,
): Promise<ApiCooperative> {
  const detailKey = cooperativeKey(id);
  try {
    const res = await patchApiCooperativesById({ path: { id }, body: patch });
    const updated = unwrap(res) as ApiCooperative;
    globalMutate(detailKey, updated, { revalidate: false });
    await revalidateCooperatives();
    return updated;
  } catch (err) {
    // Rollback via revalidation.
    globalMutate(detailKey);
    void revalidateCooperatives();
    throw err;
  }
}

export async function deleteCooperative(id: string): Promise<void> {
  try {
    const res = await deleteApiCooperativesById({ path: { id } });
    unwrap(res);
    globalMutate(cooperativeKey(id), undefined, { revalidate: false });
    await revalidateCooperatives();
  } catch (err) {
    void revalidateCooperatives();
    throw err;
  }
}

/** Undo a cooperative soft-delete (cascades back to its cascade-deleted
 *  farmers + parcels server-side). Raw POST — not in the generated SDK. */
export async function restoreCooperative(id: string): Promise<void> {
  await apiFetch<void>(`/api/cooperatives/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  globalMutate(cooperativeKey(id), undefined, { revalidate: false });
  await revalidateCooperatives();
}

// ── Members ───────────────────────────────────────────────────────────────
// Users with an explicit `user_cooperative_assignments` row for the
// cooperative. Org-wide admins are NOT in this list — there's nothing
// to un-assign on them. Endpoints aren't in the generated SDK yet, so
// we hit them via the raw `apiFetch` helper.

export interface ApiCooperativeMember {
  userId: string;
  name: string;
  email: string;
  status: string;
  isPrimary: boolean;
  scope: 'district' | 'all_districts';
  roles: string[];
  /** True when the user's access comes from `is_all_cooperative` rather
   *  than an explicit assignment — the FE hides the remove control. */
  viaOrgWide: boolean;
}

export function cooperativeMembersKey(id: string) {
  return ['/api/cooperatives', id, 'users'] as const;
}

export function useCooperativeMembers(id: string | undefined | null) {
  return useSWR<ApiCooperativeMember[]>(id ? cooperativeMembersKey(id) : null, async () => {
    const body = await apiFetch<{ data: ApiCooperativeMember[] }>(`/api/cooperatives/${id}/users`);
    return body.data;
  });
}

export async function removeCooperativeMember(
  cooperativeId: string,
  userId: string,
): Promise<void> {
  await apiFetch(`/api/cooperatives/${cooperativeId}/users/${userId}`, { method: 'DELETE' });
  // Re-fetch the members list AND the user (their cooperativeAssignments
  // shrunk by one) so any open user-detail card stays consistent.
  await globalMutate(cooperativeMembersKey(cooperativeId));
}
