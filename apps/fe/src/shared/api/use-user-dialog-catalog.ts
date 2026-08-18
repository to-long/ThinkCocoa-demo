/**
 * SWR hook bundling every fetch the admin user-create/edit dialog needs:
 *   - every role (+ its permission codes) so toggling a role can union
 *     that role's permissions into the picker
 *   - the flat permissions catalog so role-permission codes can be mapped
 *     to the picker's permission IDs
 *   - the grouped-by-resource permission view the picker actually renders
 *
 * Deliberately NOT fired on the users-list page — only when the dialog
 * opens. Callers pass `enabled=open` so the first dialog-open is the
 * first network hit; subsequent opens pull straight from the SWR cache
 * and render without a spinner (SWR revalidates in the background if the
 * cache is stale).
 *
 * Why a single bundled hook instead of three separate SWR calls: the
 * per-role detail fan-out has to run AFTER the list resolves (we need
 * role ids from the list), which requires sequencing inside a single
 * fetcher anyway. Bundling also means one SWR cache key owns the whole
 * dialog state — easy to invalidate on sign-out.
 */

import {
  getApiPermissions,
  getApiPermissionsGroups,
  getApiRoles,
} from '@kuanadata/shared/kuana-data-client';
import useSWR from 'swr';
import { unwrap } from './fetcher';
import type { ApiPermissionGroup } from './index';
import type { ApiPermission, ApiRoleDetail } from './types';

export interface UserDialogCatalog {
  roleDetails: ApiRoleDetail[];
  permissions: ApiPermission[];
  permissionGroups: ApiPermissionGroup[];
}

export const USER_DIALOG_CATALOG_KEY = ['/user-dialog-catalog'] as const;

export function useUserDialogCatalog(enabled: boolean) {
  return useSWR<UserDialogCatalog>(
    enabled ? USER_DIALOG_CATALOG_KEY : null,
    async () => {
      // Three parallel fetches — no per-role fan-out. The roles list is
      // asked for `includePermissions=true` so each item already carries
      // `permissions: string[]`. Cuts a N+1 cold-open to a constant 3
      // requests regardless of role count.
      const [rolesPage, permissions, groupsPage] = await Promise.all([
        getApiRoles({
          query: { pageSize: '100', includePermissions: 'true' },
        }).then(
          (r) =>
            unwrap(r) as {
              items: ApiRoleDetail[];
              total: number;
              page: number;
              pageSize: number;
            },
        ),
        getApiPermissions().then((r) => unwrap(r) as ApiPermission[]),
        getApiPermissionsGroups({ query: { pageSize: '100' } }).then(
          (r) =>
            unwrap(r) as {
              items: ApiPermissionGroup[];
              total: number;
              page: number;
              pageSize: number;
            },
        ),
      ]);
      return {
        roleDetails: rolesPage.items,
        permissions,
        permissionGroups: groupsPage.items,
      };
    },
    { revalidateOnFocus: false },
  );
}
