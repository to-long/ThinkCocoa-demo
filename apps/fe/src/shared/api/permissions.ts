/**
 * SWR hooks + mutation helpers for `/api/permissions`.
 *
 * Permissions are mostly static but the admin UI supports ad-hoc creation
 * (e.g. a new resource is introduced mid-cycle). The list endpoint returns
 * a flat `Permission[]` — grouping by resource (`code.split(':')[0]`) happens
 * in the UI.
 */

import {
  deleteApiPermissionsById,
  deleteApiPermissionsGroupsByResource,
  getApiPermissions,
  getApiPermissionsById,
  getApiPermissionsGroups,
  getApiPermissionsStats,
  patchApiPermissionsById,
  postApiPermissions,
  postApiPermissionsGroups,
  putApiPermissionsGroupsByResource,
} from '@cocoaimpact/shared/impact-cocoa-client';
import useSWR, { mutate as globalMutate } from 'swr';
import { unwrap } from './fetcher';
import type { ApiPermission, CreatePermissionInput, UpdatePermissionInput } from './types';

/**
 * Payload for `createPermissionGroups`:
 *   { farm_plan: ["read", "create"], report: ["export"] }
 *
 * The BE reassembles each key/value into `resource:action` codes and
 * inserts idempotently. See `packages/shared/src/validators/permission.ts`
 * for the authoritative shape + validation.
 */
export type CreatePermissionGroupsInput = Record<string, string[]>;

export interface CreatePermissionGroupsResult {
  created: ApiPermission[];
  existed: string[]; // codes that already existed before the call
}

// ── Keys ──────────────────────────────────────────────────────────────────

export const PERMISSIONS_LIST_KEY = ['/api/permissions'] as const;
export function permissionKey(id: string) {
  return ['/api/permissions', id] as const;
}

// ── Queries ───────────────────────────────────────────────────────────────

export function usePermissionsList() {
  return useSWR<ApiPermission[]>(
    PERMISSIONS_LIST_KEY,
    async () => {
      const res = await getApiPermissions();
      return unwrap(res) as ApiPermission[];
    },
    // Permissions are admin-only catalog data — re-fetching every
    // window focus made search inputs feel jumpy. Mutations still
    // trigger explicit revalidation via `globalMutate`.
    { revalidateOnFocus: false },
  );
}

export function usePermission(id: string | undefined | null) {
  return useSWR<ApiPermission>(
    id ? permissionKey(id) : null,
    async () => {
      const res = await getApiPermissionsById({ path: { id: id as string } });
      return unwrap(res) as ApiPermission;
    },
    { revalidateOnFocus: false },
  );
}

// ── Stats ────────────────────────────────────────────────────────────────
export interface PermissionsStats {
  total: number;
  groupCount: number;
  byAction: { action: string; count: number }[];
}

export const PERMISSIONS_STATS_KEY = ['/api/permissions/stats'] as const;

export function usePermissionsStats() {
  return useSWR<PermissionsStats>(
    PERMISSIONS_STATS_KEY,
    async () => {
      const res = await getApiPermissionsStats();
      return unwrap(res) as PermissionsStats;
    },
    { revalidateOnFocus: false },
  );
}

// ── Paginated grouped-by-resource view ──────────────────────────────────
// Used by the permissions admin page. Rows = groups (resources), so
// pagination happens at group-level (BE aggregates distinct resources).

export interface ApiPermissionGroupAction {
  id: string;
  code: string;
  action: string;
  name: string;
  description: string | null;
}

export interface ApiPermissionGroup {
  resource: string;
  actions: ApiPermissionGroupAction[];
  /** Latest `updatedAt` across the group's permission rows. ISO. */
  updatedAt: string;
}

export interface ApiPermissionGroupsPage {
  items: ApiPermissionGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListPermissionGroupsQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  /** JSON:API sort spec — supported fields: `resource`, `updated_at`. */
  sort?: string;
}

export const PERMISSION_GROUPS_PREFIX = '/api/permissions/groups' as const;
export function permissionGroupsListKey(query: ListPermissionGroupsQuery) {
  return [PERMISSION_GROUPS_PREFIX, query] as const;
}
const isPermissionGroupsListKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === PERMISSION_GROUPS_PREFIX && typeof key[1] === 'object';

export function usePermissionGroupsList(query: ListPermissionGroupsQuery = {}) {
  return useSWR<ApiPermissionGroupsPage>(
    permissionGroupsListKey(query),
    async () => {
      const { page, pageSize, q, sort } = query;
      const res = await getApiPermissionsGroups({
        query: {
          ...(page !== undefined ? { page: String(page) } : {}),
          ...(pageSize !== undefined ? { pageSize: String(pageSize) } : {}),
          ...(q ? { q } : {}),
          ...(sort ? { sort } : {}),
        },
      });
      return unwrap(res) as ApiPermissionGroupsPage;
    },
    { revalidateOnFocus: false },
  );
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createPermission(body: CreatePermissionInput): Promise<ApiPermission> {
  // No optimistic insert — id/createdAt come from the server.
  const res = await postApiPermissions({ body });
  const created = unwrap(res) as ApiPermission;
  await globalMutate(PERMISSIONS_LIST_KEY);
  await globalMutate(isPermissionGroupsListKey);
  await globalMutate(PERMISSIONS_STATS_KEY);
  return created;
}

export async function updatePermission(
  id: string,
  patch: UpdatePermissionInput,
): Promise<ApiPermission> {
  const apply = (p: ApiPermission): ApiPermission => ({
    ...p,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
  });

  globalMutate(
    PERMISSIONS_LIST_KEY,
    (current?: ApiPermission[]) => current?.map((p) => (p.id === id ? apply(p) : p)),
    { revalidate: false },
  );
  globalMutate(permissionKey(id), (current?: ApiPermission) => current && apply(current), {
    revalidate: false,
  });
  try {
    const res = await patchApiPermissionsById({
      path: { id },
      body: patch as UpdatePermissionInput & { description?: string | null },
    });
    const updated = unwrap(res) as ApiPermission;
    globalMutate(permissionKey(id), updated, { revalidate: false });
    await globalMutate(PERMISSIONS_LIST_KEY);
    await globalMutate(isPermissionGroupsListKey);
    await globalMutate(PERMISSIONS_STATS_KEY);
    return updated;
  } catch (err) {
    globalMutate(PERMISSIONS_LIST_KEY);
    globalMutate(permissionKey(id));
    throw err;
  }
}

/**
 * Batch create a whole permission group.
 *
 * Not optimistic — the BE owns id + createdAt + the generated name, and the
 * payload may intentionally overlap with existing codes (idempotent upsert).
 * We revalidate the list on success so the UI picks up all created rows.
 */
export async function createPermissionGroups(
  body: CreatePermissionGroupsInput,
): Promise<CreatePermissionGroupsResult> {
  const res = await postApiPermissionsGroups({ body });
  const result = unwrap(res) as CreatePermissionGroupsResult;
  await globalMutate(PERMISSIONS_LIST_KEY);
  await globalMutate(isPermissionGroupsListKey);
  await globalMutate(PERMISSIONS_STATS_KEY);
  return result;
}

export async function deletePermission(id: string): Promise<void> {
  globalMutate(
    PERMISSIONS_LIST_KEY,
    (current?: ApiPermission[]) => current?.filter((p) => p.id !== id),
    { revalidate: false },
  );
  try {
    const res = await deleteApiPermissionsById({ path: { id } });
    unwrap(res);
    globalMutate(permissionKey(id), undefined, { revalidate: false });
    await globalMutate(PERMISSIONS_LIST_KEY);
    await globalMutate(isPermissionGroupsListKey);
    await globalMutate(PERMISSIONS_STATS_KEY);
  } catch (err) {
    globalMutate(PERMISSIONS_LIST_KEY);
    throw err;
  }
}

/**
 * Delete every permission in a group in one BE round-trip.
 *
 * The previous flow looped `deletePermission(id)` per row in the
 * group, which produced ONE audit row per permission — `4` audit
 * entries for a group with 4 actions. The BE now exposes a batch
 * endpoint that deletes the group atomically and writes a SINGLE
 * audit row (mirroring the create-group path).
 */
export async function deletePermissionGroup(resource: string): Promise<void> {
  try {
    const res = await deleteApiPermissionsGroupsByResource({
      path: { resource },
    });
    unwrap(res);
    await globalMutate(PERMISSIONS_LIST_KEY);
    await globalMutate(isPermissionGroupsListKey);
    await globalMutate(PERMISSIONS_STATS_KEY);
  } catch (err) {
    globalMutate(PERMISSIONS_LIST_KEY);
    throw err;
  }
}

/**
 * Set the group's actions to exactly the provided list — BE diffs
 * against the current state and applies the add/remove deltas in one
 * audit-tagged transaction. Replaces the old edit flow that called
 * `createPermissionGroups` for additions and looped `deletePermission`
 * for removals (N+1 audit rows for one admin action).
 *
 * Caller passes the action verbs only (`["read", "create", ...]`);
 * the BE composes them with the resource into full codes.
 */
export async function setPermissionGroupActions(
  resource: string,
  actions: string[],
): Promise<void> {
  try {
    const res = await putApiPermissionsGroupsByResource({
      path: { resource },
      body: { actions },
    });
    unwrap(res);
    await globalMutate(PERMISSIONS_LIST_KEY);
    await globalMutate(isPermissionGroupsListKey);
    await globalMutate(PERMISSIONS_STATS_KEY);
  } catch (err) {
    globalMutate(PERMISSIONS_LIST_KEY);
    throw err;
  }
}
