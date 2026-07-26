/**
 * SWR hooks + mutation helpers for `/api/users`.
 *
 * Every call flows through the generated `think-cocoa-client` SDK — the SWR
 * keys are tuples of the form `['/api/users', query]` so that every paginated
 * variant is cached independently.
 *
 * Optimistic updates use `globalMutate(matcher, updater, { revalidate: false })`
 * for fast UI response, followed by a revalidation pass after the server
 * confirms the change.
 */

import {
  deleteApiUsersById,
  getApiUsers,
  getApiUsersById,
  getApiUsersStats,
  patchApiUsersById,
  postApiUsers,
  postApiUsersByIdRestore,
  putApiUsersByIdRoles,
} from '@thinkcocoa/shared/think-cocoa-client';
import useSWR, { mutate as globalMutate } from 'swr';
import { unwrap } from './fetcher';
import type {
  ApiUser,
  ApiUserDetail,
  CreateUserInput,
  UpdateUserInput,
  UsersListResponse,
} from './types';

/**
 * Slim stats payload — matches the Pencil `0M9b6` design on the user
 * list page (total + status buckets + role breakdown).
 */
export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  /** UI alias for DB `status = 'locked'`. */
  blocked: number;
  /** Rows with non-null `deleted_at`. */
  deleted: number;
  /** Scope distribution — counts users by access. `all` is the
   *  org-wide flag count; `byCooperative` lists each coop with the
   *  number of users that can access it (assigned + org-wide). */
  byScope: {
    all: number;
    /** Users with no coop access (no assignment, not org-wide). */
    none: number;
    byCooperative: Array<{
      cooperativeId: string;
      cooperativeName: string;
      count: number;
    }>;
  };
}

export const USER_STATS_KEY = ['/api/users/stats'] as const;

// ── Keys ──────────────────────────────────────────────────────────────────

export interface UsersListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  includeDeleted?: boolean;
  /** Filter to users that hold this role code. */
  roleCode?: string;
  /** UI status: `active` | `inactive` | `blocked` | `deleted`. */
  status?: string;
  /** Access-scope filter: `all` | `none` | `<cooperativeUuid>`. */
  scope?: string;
  /** JSON:API sort spec — `field` (asc) / `-field` (desc), comma-
   *  separated for multi-column. Supported fields: `name`, `last_login`. */
  sort?: string;
}

/** Tuple SWR key: `['/api/users', normalizedQuery]`. */
export function usersListKey(params: UsersListParams = {}) {
  return ['/api/users', normalizeListParams(params)] as const;
}

export function userKey(id: string) {
  return ['/api/users', id] as const;
}

/** Match every variant of the users list (any query combination). */
function matchUsersList(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/users' && typeof key[1] === 'object';
}

function normalizeListParams(p: UsersListParams) {
  // Stripping undefined keys keeps SWR's structural comparison stable.
  const out: Record<string, string | number | boolean> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.includeDeleted) out.includeDeleted = true;
  if (p.roleCode) out.roleCode = p.roleCode;
  if (p.status) out.status = p.status;
  if (p.scope) out.scope = p.scope;
  if (p.sort) out.sort = p.sort;
  return out;
}

// ── Queries ───────────────────────────────────────────────────────────────

export function useUsersList(params: UsersListParams = {}) {
  return useSWR<UsersListResponse>(usersListKey(params), async () => {
    // BE query validator uses `z.string()` for every paginated field — cast
    // here so the SDK serializes them correctly.
    const query: Record<string, string> = {};
    if (params.page != null) query.page = String(params.page);
    if (params.pageSize != null) query.pageSize = String(params.pageSize);
    if (params.q) query.q = params.q;
    if (params.includeDeleted) query.includeDeleted = 'true';
    if (params.roleCode) query.roleCode = params.roleCode;
    if (params.status) query.status = params.status;
    if (params.scope) query.scope = params.scope;
    if (params.sort) query.sort = params.sort;
    const res = await getApiUsers({ query });
    return unwrap(res) as UsersListResponse;
  });
}

export function useUser(id: string | undefined | null) {
  return useSWR<ApiUserDetail>(id ? userKey(id) : null, async () => {
    const res = await getApiUsersById({ path: { id: id as string } });
    return unwrap(res) as ApiUserDetail;
  });
}

/**
 * Slim-stats hook — powers the `UsersSlimStats` row above the user list.
 * The BE computes these via a single SQL round-trip behind a 60s LRU,
 * so this is cheap to mount on every page that wants it.
 */
export function useUserStats() {
  return useSWR<UserStats>(
    USER_STATS_KEY,
    async () => unwrap(await getApiUsersStats()) as UserStats,
    { revalidateOnFocus: false },
  );
}

/** Matches the stats key (for use alongside `matchUsersList` during
 *  post-mutation global revalidation). */
function matchUserStats(key: unknown): boolean {
  return Array.isArray(key) && key[0] === '/api/users/stats';
}

/** Revalidate both the user list and the stats row. Mutation helpers
 *  below call this instead of `globalMutate(matchUsersList)` so the
 *  counts on the stats row never lag behind the table. */
async function revalidateUsers(): Promise<void> {
  await Promise.all([globalMutate(matchUsersList), globalMutate(matchUserStats)]);
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createUser(body: CreateUserInput): Promise<ApiUserDetail> {
  const res = await postApiUsers({ body });
  const created = unwrap(res) as ApiUserDetail;
  // New id comes from the server, so no optimistic insert — just revalidate.
  await revalidateUsers();
  return created;
}

export async function updateUser(id: string, patch: UpdateUserInput): Promise<ApiUser> {
  const detailKey = userKey(id);

  const applyPatchToUser = <T extends ApiUser>(u: T): T => ({
    ...u,
    ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
    ...(patch.image !== undefined ? { image: patch.image } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.defaultCooperativeId !== undefined
      ? { defaultCooperativeId: patch.defaultCooperativeId }
      : {}),
  });

  // Optimistic detail + list updates.
  globalMutate(detailKey, (current?: ApiUserDetail) => current && applyPatchToUser(current), {
    revalidate: false,
  });
  globalMutate(
    matchUsersList,
    (current?: UsersListResponse) =>
      current && {
        ...current,
        items: current.items.map((u) => (u.id === id ? applyPatchToUser(u) : u)),
      },
    { revalidate: false },
  );

  try {
    const res = await patchApiUsersById({ path: { id }, body: patch });
    const updated = unwrap(res) as ApiUser;
    globalMutate(detailKey, (current?: ApiUserDetail) => current && { ...current, ...updated }, {
      revalidate: false,
    });
    await revalidateUsers();
    return updated;
  } catch (err) {
    // Rollback via revalidation.
    globalMutate(detailKey);
    // Rollback stats alongside list on failure so the UI reflects the
    // authoritative server state once the failing request settles.
    void revalidateUsers();
    throw err;
  }
}

export async function deleteUser(id: string): Promise<void> {
  const detailKey = userKey(id);

  globalMutate(
    matchUsersList,
    (current?: UsersListResponse) =>
      current && {
        ...current,
        items: current.items.filter((u) => u.id !== id),
        total: Math.max(0, current.total - 1),
      },
    { revalidate: false },
  );

  try {
    const res = await deleteApiUsersById({ path: { id } });
    unwrap(res);
    globalMutate(detailKey, undefined, { revalidate: false });
    await revalidateUsers();
  } catch (err) {
    // Rollback stats alongside list on failure so the UI reflects the
    // authoritative server state once the failing request settles.
    void revalidateUsers();
    throw err;
  }
}

/**
 * Undo a prior soft-delete. No optimistic update — the row is invisible
 * to every `includeDeleted:false` list query and present only in the
 * `includeDeleted:true` variant where we re-fetch afterwards to pick up
 * the server-returned `deletedAt=null`, `status='active'` shape.
 */
export async function restoreUser(id: string): Promise<ApiUserDetail> {
  const detailKey = userKey(id);
  try {
    const res = await postApiUsersByIdRestore({ path: { id } });
    const restored = unwrap(res) as ApiUserDetail;
    globalMutate(detailKey, restored, { revalidate: false });
    await revalidateUsers();
    return restored;
  } catch (err) {
    globalMutate(detailKey);
    // Rollback stats alongside list on failure so the UI reflects the
    // authoritative server state once the failing request settles.
    void revalidateUsers();
    throw err;
  }
}

export async function setUserRoles(
  id: string,
  roleCodes: string[],
): Promise<{ userId: string; roles: string[] }> {
  const detailKey = userKey(id);

  globalMutate(
    detailKey,
    (current?: ApiUserDetail) => current && { ...current, roles: [...roleCodes].sort() },
    { revalidate: false },
  );

  try {
    const res = await putApiUsersByIdRoles({
      path: { id },
      body: { roleCodes },
    });
    const data = unwrap(res) as { userId: string; roles: string[] };
    globalMutate(
      detailKey,
      (current?: ApiUserDetail) => current && { ...current, roles: data.roles },
      { revalidate: false },
    );
    return data;
  } catch (err) {
    globalMutate(detailKey);
    throw err;
  }
}
