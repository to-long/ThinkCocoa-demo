/**
 * SWR hooks for `/api/integrations/sync-settings/*`.
 *
 * Mirrors other shared/api/ modules — tuple keys so global
 * `mutate(predicate)` calls can invalidate list + detail caches at
 * once after a sync run.
 */

import useSWR from 'swr';
import { apiFetch } from './fetcher';

export type SyncRunStatus = 'running' | 'success' | 'failed';

export interface ApiSyncSettings {
  id: string;
  jobKey: string;
  label: string;
  description: string | null;
  sourceUrl: string;
  fieldMapping: Record<string, unknown>;
  autoSyncEnabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunStatus: SyncRunStatus | null;
  lastRunSummary: unknown;
  snapshotHash: string | null;
  snapshotUploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunSummary {
  fetched: number;
  upsertedRaw: number;
  /** Projected layer counts — present when the sync ingests into a
   *  domain table (e.g. `internal_inspection` → inspections). The
   *  toast surfaces this instead of raw count because a no-op re-run
   *  shows `upsertedRaw: 0` even though the table is populated. */
  upsertedInspection?: { inserted: number; updated: number };
  snapshotUploaded: boolean;
  unchanged: boolean;
  snapshotKey?: string;
  failed: number;
  /** Rows removed by the "delete unsynced" prune (0 unless requested). */
  pruned?: number;
  errors?: string[];
  durationMs?: number;
}

export const SYNC_SETTINGS_LIST_KEY = ['/api/integrations/sync-settings'] as const;
export const syncSettingsKey = (jobKey: string) =>
  ['/api/integrations/sync-settings', jobKey] as const;

export function useSyncSettingsList() {
  return useSWR<{ items: ApiSyncSettings[] }>(SYNC_SETTINGS_LIST_KEY, () =>
    apiFetch<{ items: ApiSyncSettings[] }>('/api/integrations/sync-settings'),
  );
}

export function useSyncSettings(jobKey: string | null | undefined) {
  return useSWR<ApiSyncSettings>(jobKey ? syncSettingsKey(jobKey) : null, () =>
    apiFetch<ApiSyncSettings>(
      `/api/integrations/sync-settings/${encodeURIComponent(jobKey as string)}`,
    ),
  );
}

export interface UpdateSyncSettingsInput {
  sourceUrl?: string;
  fieldMapping?: Record<string, unknown>;
  autoSyncEnabled?: boolean;
  intervalMinutes?: number;
}

export async function updateSyncSettings(
  jobKey: string,
  input: UpdateSyncSettingsInput,
): Promise<ApiSyncSettings> {
  return apiFetch<ApiSyncSettings>(
    `/api/integrations/sync-settings/${encodeURIComponent(jobKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export interface ResetDemoDataSummary {
  tablesTruncated: number;
  /** Entries removed from the storage root (audit diffs, report files). */
  storageEntriesRemoved: number;
  /** Soft-deleted users / cooperatives brought back by the reset. */
  undeleted: { users: number; cooperatives: number };
  durationMs: number;
  /** Post-reset row count per demo module — proof every one came back. */
  counts: {
    farmers: number;
    parcels: number;
    geometries: number;
    eudr: number;
    inspections: number;
    correctiveActions: number;
    coaching: number;
    clmrsRemediation: number;
    training: number;
    purchases: number;
    primaryLots: number;
    secondaryLots: number;
    vslaGroups: number;
    cooperatives: number;
    users: number;
    rolePermissions: number;
    auditLogs: number;
  };
}

/**
 * Wipe every operational table and rebuild the baseline demo dataset.
 * Unlike `runSyncJob` below this is a REAL call — see
 * `apps/be/src/features/integrations/reset-demo-data.ts`. Takes a couple
 * of seconds (truncate + full seed) and invalidates essentially every
 * cache, so callers should clear SWR wholesale afterwards.
 */
export async function resetDemoData(): Promise<ResetDemoDataSummary> {
  return apiFetch<ResetDemoDataSummary>('/api/integrations/reset-demo-data', {
    method: 'POST',
  });
}

/**
 * "Sync now" — DEMO stub. The Kobo sync engine was removed (all data
 * is seeded), so this performs NO backend call. It simply waits a
 * moment to mimic a running job, then resolves with an "unchanged"
 * summary so the caller's completion notification still fires.
 */
export async function runSyncJob(
  jobKey: string,
  _options: { fromStart?: boolean; deleteUnsync?: boolean } = {},
): Promise<{ jobKey: string; summary: SyncRunSummary }> {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    jobKey,
    summary: {
      fetched: 0,
      upsertedRaw: 0,
      snapshotUploaded: false,
      unchanged: true,
      failed: 0,
    },
  };
}
