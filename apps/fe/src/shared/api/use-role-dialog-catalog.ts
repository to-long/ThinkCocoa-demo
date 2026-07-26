/**
 * SWR hook for the role-create/edit dialog's permission picker. Only the
 * flat permissions catalog is needed — the picker groups them by resource
 * on the fly. Fired lazily via `enabled=open` so navigating to the roles
 * list no longer pre-fetches the catalog; first dialog-open is the first
 * network hit.
 *
 * See `useUserDialogCatalog` for the parallel rationale on the users page.
 */

import { getApiPermissions } from '@cocoaimpact/shared/impact-cocoa-client';
import useSWR from 'swr';
import { unwrap } from './fetcher';
import type { ApiPermission } from './types';

export const ROLE_DIALOG_CATALOG_KEY = ['/role-dialog-catalog'] as const;

export function useRoleDialogCatalog(enabled: boolean) {
  return useSWR<ApiPermission[]>(
    enabled ? ROLE_DIALOG_CATALOG_KEY : null,
    async () => unwrap(await getApiPermissions()) as ApiPermission[],
    { revalidateOnFocus: false },
  );
}
