/**
 * SWR hooks for `/api/clmrs-records` — the child-labour register
 * derived from coaching visits (see BE `features/clmrs`). Records are
 * tenant-scoped to the active cooperative cookie server-side; the
 * active-coop code is folded into the SWR key so switching coops
 * refetches.
 */

import useSWR from 'swr';
import type { ClmrsCase, ClmrsRecord } from '@/features/clmrs/lib/mock';
import { apiFetch } from './fetcher';

interface ClmrsRecordsResponse {
  records: ClmrsRecord[];
}

/**
 * Open a real remediation case for a flag (persisted to `clmrs.cases`).
 * Callers should revalidate the CLMRS record + list SWR keys after.
 */
export async function createClmrsCase(
  childId: string,
  followUpDate: string | null,
): Promise<ClmrsCase> {
  return apiFetch<ClmrsCase>(`/api/clmrs-records/${encodeURIComponent(childId)}/case`, {
    method: 'POST',
    body: JSON.stringify({ followUpDate }),
  });
}

/** Change a case's status (open ↔ closed). Revalidate record keys after. */
export async function setClmrsCaseStatus(
  childId: string,
  status: 'open' | 'processing' | 'closed',
  followUpDate: string | null,
): Promise<ClmrsCase> {
  return apiFetch<ClmrsCase>(`/api/clmrs-records/${encodeURIComponent(childId)}/case`, {
    method: 'PATCH',
    body: JSON.stringify({ status, followUpDate }),
  });
}

// `enabled` — pass false to skip the fetch entirely (null SWR key). Call
// sites that only need CLMRS data for a secondary widget (e.g. the farmers
// list's CLMRS column) gate this on `usePermission('clmrs:read')` so a role
// without it never fires the `/api/clmrs-records` call — which would 403
// and, via the global fetcher, bounce the whole page to /403.
export function useClmrsRecords(coopCode?: string | null, enabled = true) {
  return useSWR<ClmrsRecordsResponse>(
    enabled ? ['/api/clmrs-records', coopCode ?? ''] : null,
    () => apiFetch<ClmrsRecordsResponse>('/api/clmrs-records'),
    { keepPreviousData: true },
  );
}

export function useClmrsRecord(childId: string | null | undefined, coopCode?: string | null) {
  return useSWR<ClmrsRecord>(childId ? ['/api/clmrs-records', childId, coopCode ?? ''] : null, () =>
    apiFetch<ClmrsRecord>(`/api/clmrs-records/${encodeURIComponent(childId as string)}`),
  );
}
