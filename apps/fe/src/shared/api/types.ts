/**
 * Runtime types that mirror the BE response shapes for the IAM endpoints.
 *
 * These are hand-authored (rather than generated from swagger.json) to keep
 * the FE hooks self-contained. If a field here drifts from the BE, the SWR
 * hooks will keep working but TypeScript will flag the mismatch at use sites.
 */

export type UserStatusApi = 'active' | 'inactive' | 'locked';
export type AssignmentScope = 'district' | 'all_districts';

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  image: string | null;
  emailVerified: boolean;
  status: UserStatusApi;
  defaultCooperativeId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Role codes granted to the user (returned by both list + detail). */
  roles: string[];
  /** Org-wide override flag. When true, the user has access to every
   *  cooperative regardless of `cooperativeAssignments`. */
  isAllCooperative: boolean;
  /** Explicit cooperative assignments — same shape as on `ApiUserDetail`.
   *  Returned by the LIST response too so the admin users table can
   *  render the Scope column tags without per-row detail fetches. */
  cooperativeAssignments: Array<{
    cooperativeId: string;
    cooperativeCode: string;
    cooperativeName: string;
    scope: AssignmentScope;
    isPrimary: boolean;
  }>;
  /** Soft-delete tombstone. `null` for live users. Always returned. */
  deletedAt: string | null;
}

export interface ApiUserDetail extends ApiUser {
  roles: string[];
  /**
   * Effective permission codes (`resource:action`) — union of every
   * permission reachable through any of the user's roles. Returned by the
   * detail endpoint so the bootstrap doesn't have to loop `/api/roles/:id`.
   */
  permissions: string[];
  cooperativeAssignments: Array<{
    cooperativeId: string;
    cooperativeCode: string;
    cooperativeName: string;
    scope: AssignmentScope;
    isPrimary: boolean;
  }>;
  /**
   * Resolved coop catalog the user can switch into via the header
   * CoopSwitcher — included on `/me` so the switcher renders without
   * a second `/api/cooperatives` round-trip. For org-wide admins this
   * is every live coop; otherwise it mirrors the `cooperativeAssignments`
   * list above (id/code/name only).
   */
  accessibleCooperatives: Array<{
    id: string;
    code: string;
    name: string;
  }>;
}

export interface UsersListResponse {
  items: ApiUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiRole {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  grantCount: number;
}

export interface ApiRoleDetail extends ApiRole {
  permissions: string[];
}

export interface ApiPermission {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  status?: UserStatusApi;
  defaultCooperativeId?: string;
  roleCodes?: string[];
  /** Cooperatives this user can access (multi-tenant scope). BE infers
   *  `assignmentScope` from the role codes (org-wide → all_districts). */
  cooperativeIds?: string[];
  /** Org-wide override. Independent of `cooperativeIds`. */
  isAllCooperative?: boolean;
}

export interface UpdateUserInput {
  fullName?: string;
  image?: string | null;
  status?: UserStatusApi;
  defaultCooperativeId?: string | null;
  roleCodes?: string[];
  /** When set, replaces the user's cooperative assignments wholesale. */
  cooperativeIds?: string[];
  /** Toggle the org-wide override flag. */
  isAllCooperative?: boolean;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string;
  permissionCodes?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
}

export interface CreatePermissionInput {
  code: string;
  name: string;
  description?: string;
}

export interface UpdatePermissionInput {
  name?: string;
  description?: string;
}
