export type UserStatus = 'active' | 'inactive' | 'blocked';

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: UserStatus;
  lastLogin: string | null;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  blocked: number;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  roleIds: string[];
  permissionIds: string[];
  /** Cooperatives this user can access (multi-tenant scope). */
  cooperativeIds: string[];
  /** Org-wide override flag. Independent of `cooperativeIds`. */
  isAllCooperative: boolean;
}

export interface UpdateUserPayload {
  name?: string;
  password?: string;
  roleIds?: string[];
  permissionIds?: string[];
  /** When set, replaces the user's cooperative assignments wholesale. */
  cooperativeIds?: string[];
  /** Toggle the org-wide override flag. */
  isAllCooperative?: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  description: string;
  permissionIds: string[];
}

export interface PermissionOption {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

/**
 * Matches the shape `useUserDetail` returned in TMG — used by the
 * user-detail-page-content component.
 */
export interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  banned: boolean;
  locked: boolean;
  createdAt: number;
  lastSignInAt: number | null;
  directPermissions: { id: string; resource: string; action: string }[];
  roleIds: string[];
  directPermissionIds: string[];
}
