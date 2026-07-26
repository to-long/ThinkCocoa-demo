/**
 * SWR hooks + mutation helpers for `/api/roles`.
 *
 * List endpoint is now PAGINATED server-side. The hook key encodes the
 * query so different (page, pageSize, q) combos are cached separately.
 */

import {
  deleteApiRolesById,
  getApiRoles,
  getApiRolesById,
  getApiRolesStats,
  patchApiRolesById,
  postApiRoles,
  putApiRolesByIdPermissions,
} from '@thinkcocoa/shared/impact-cocoa-client';
import useSWR, { mutate as globalMutate } from 'swr';
import { unwrap } from './fetcher';
import type { ApiRole, ApiRoleDetail, CreateRoleInput, UpdateRoleInput } from './types';

// ── Keys ──────────────────────────────────────────────────────────────────

export interface ListRolesQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  /** JSON:API sort spec — `field` (asc) / `-field` (desc),
   *  comma-separated. Supported fields: `name`. */
  sort?: string;
}

export interface ApiRolesPage {
  items: ApiRole[];
  total: number;
  page: number;
  pageSize: number;
}

export const ROLES_LIST_PREFIX = '/api/roles' as const;
export function rolesListKey(query: ListRolesQuery) {
  return [ROLES_LIST_PREFIX, query] as const;
}
export function roleKey(id: string) {
  return [ROLES_LIST_PREFIX, id] as const;
}

// Match helper for invalidate-after-mutation. Revalidates every list-key
// variant (different pagination / search) in the SWR cache.
const isRolesListKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === ROLES_LIST_PREFIX && typeof key[1] === 'object';

// ── Queries ───────────────────────────────────────────────────────────────

export function useRolesList(query: ListRolesQuery = {}) {
  return useSWR<ApiRolesPage>(
    rolesListKey(query),
    async () => {
      const { page, pageSize, q, sort } = query;
      const res = await getApiRoles({
        query: {
          ...(page !== undefined ? { page: String(page) } : {}),
          ...(pageSize !== undefined ? { pageSize: String(pageSize) } : {}),
          ...(q ? { q } : {}),
          ...(sort ? { sort } : {}),
        },
      });
      return unwrap(res) as ApiRolesPage;
    },
    // Roles are slow-changing config data — re-fetching on every
    // window focus (the SWR default) made the search input feel
    // unstable: tab away and back fired a list + stats refetch every
    // ~5–10s. Mutations still revalidate via `globalMutate` so freshly
    // created/edited rows still surface immediately.
    { revalidateOnFocus: false },
  );
}

export function useRole(id: string | undefined | null) {
  return useSWR<ApiRoleDetail>(
    id ? roleKey(id) : null,
    async () => {
      const res = await getApiRolesById({ path: { id: id as string } });
      return unwrap(res) as ApiRoleDetail;
    },
    { revalidateOnFocus: false },
  );
}

// ── Stats ────────────────────────────────────────────────────────────────
export interface RolesStats {
  total: number;
  active: number;
  byRole: { code: string; name: string; userCount: number }[];
  permissions: { assigned: number; unassigned: number };
}

export const ROLES_STATS_KEY = ['/api/roles/stats'] as const;

export function useRolesStats() {
  return useSWR<RolesStats>(
    ROLES_STATS_KEY,
    async () => {
      const res = await getApiRolesStats();
      return unwrap(res) as RolesStats;
    },
    { revalidateOnFocus: false },
  );
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createRole(body: CreateRoleInput): Promise<ApiRoleDetail> {
  const res = await postApiRoles({ body });
  const created = unwrap(res) as ApiRoleDetail;
  await globalMutate(isRolesListKey);
  await globalMutate(ROLES_STATS_KEY);
  return created;
}

// Helpers for paginated-list optimistic updates.
const patchItemInList = (
  list: ApiRolesPage | undefined,
  id: string,
  updater: (r: ApiRole) => ApiRole,
): ApiRolesPage | undefined =>
  list && {
    ...list,
    items: list.items.map((r) => (r.id === id ? updater(r) : r)),
  };

const removeItemFromList = (list: ApiRolesPage | undefined, id: string): ApiRolesPage | undefined =>
  list && {
    ...list,
    items: list.items.filter((r) => r.id !== id),
    total: Math.max(0, list.total - 1),
  };

export async function updateRole(id: string, patch: UpdateRoleInput): Promise<ApiRole> {
  const detailKey = roleKey(id);

  const applyPatch = <T extends ApiRole>(r: T): T => ({
    ...r,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
  });

  globalMutate(
    isRolesListKey,
    (current?: ApiRolesPage) => patchItemInList(current, id, applyPatch),
    { revalidate: false },
  );
  globalMutate(detailKey, (current?: ApiRoleDetail) => current && applyPatch(current), {
    revalidate: false,
  });

  try {
    const res = await patchApiRolesById({
      path: { id },
      body: patch as UpdateRoleInput & { description?: string | null },
    });
    const updated = unwrap(res) as ApiRole;
    globalMutate(detailKey, (current?: ApiRoleDetail) => current && { ...current, ...updated }, {
      revalidate: false,
    });
    await globalMutate(isRolesListKey);
    await globalMutate(ROLES_STATS_KEY);
    return updated;
  } catch (err) {
    globalMutate(isRolesListKey);
    globalMutate(detailKey);
    throw err;
  }
}

export async function deleteRole(id: string): Promise<void> {
  globalMutate(isRolesListKey, (current?: ApiRolesPage) => removeItemFromList(current, id), {
    revalidate: false,
  });
  try {
    const res = await deleteApiRolesById({ path: { id } });
    unwrap(res);
    globalMutate(roleKey(id), undefined, { revalidate: false });
    await globalMutate(isRolesListKey);
    await globalMutate(ROLES_STATS_KEY);
  } catch (err) {
    globalMutate(isRolesListKey);
    throw err;
  }
}

export async function setRolePermissions(
  id: string,
  permissionCodes: string[],
): Promise<ApiRoleDetail> {
  const detailKey = roleKey(id);

  globalMutate(
    detailKey,
    (current?: ApiRoleDetail) =>
      current && {
        ...current,
        permissions: [...permissionCodes].sort(),
        grantCount: permissionCodes.length,
      },
    { revalidate: false },
  );
  globalMutate(
    isRolesListKey,
    (current?: ApiRolesPage) =>
      patchItemInList(current, id, (r) => ({
        ...r,
        grantCount: permissionCodes.length,
      })),
    { revalidate: false },
  );

  try {
    const res = await putApiRolesByIdPermissions({
      path: { id },
      body: { permissionCodes },
    });
    const detail = unwrap(res) as ApiRoleDetail;
    globalMutate(detailKey, detail, { revalidate: false });
    await globalMutate(isRolesListKey);
    await globalMutate(ROLES_STATS_KEY);
    return detail;
  } catch (err) {
    globalMutate(detailKey);
    globalMutate(isRolesListKey);
    throw err;
  }
}
