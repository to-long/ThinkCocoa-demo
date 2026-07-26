/**
 * Sync-settings service — read + save only.
 *
 * The Kobo sync engine, scheduler, and run jobs were removed with the
 * Kobo decoupling; the demo's data is seeded. These helpers back the
 * admin Sync page so operators can still view + edit the per-job
 * settings (source URL, interval, field mapping, auto-sync toggle).
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { syncSettings } from '../../db/schema/integration';

export interface SyncSettingsResponse {
  id: string;
  jobKey: string;
  label: string;
  description: string | null;
  sourceUrl: string;
  fieldMapping: Record<string, unknown>;
  autoSyncEnabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunSummary: unknown;
  snapshotHash: string | null;
  snapshotUploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSyncSettingsInput {
  label?: string;
  description?: string | null;
  sourceUrl?: string;
  fieldMapping?: Record<string, unknown>;
  autoSyncEnabled?: boolean;
  intervalMinutes?: number;
}

type Row = typeof syncSettings.$inferSelect;

function toResponse(r: Row): SyncSettingsResponse {
  return {
    id: r.id,
    jobKey: r.jobKey,
    label: r.label,
    description: r.description,
    sourceUrl: r.sourceUrl,
    fieldMapping: (r.fieldMapping ?? {}) as Record<string, unknown>,
    autoSyncEnabled: r.autoSyncEnabled,
    intervalMinutes: r.intervalMinutes,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastRunStatus: r.lastRunStatus,
    lastRunSummary: r.lastRunSummary,
    snapshotHash: r.snapshotHash,
    snapshotUploadedAt: r.snapshotUploadedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listSyncSettings(): Promise<SyncSettingsResponse[]> {
  const rows = await db.select().from(syncSettings).orderBy(asc(syncSettings.label));
  return rows.map(toResponse);
}

export async function getSyncSettings(jobKey: string): Promise<SyncSettingsResponse | null> {
  const [row] = await db
    .select()
    .from(syncSettings)
    .where(eq(syncSettings.jobKey, jobKey))
    .limit(1);
  return row ? toResponse(row) : null;
}

export async function updateSyncSettings(
  jobKey: string,
  input: UpdateSyncSettingsInput,
): Promise<SyncSettingsResponse | null> {
  const patch: Partial<Row> = { updatedAt: new Date() };
  if (input.label !== undefined) patch.label = input.label;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sourceUrl !== undefined) patch.sourceUrl = input.sourceUrl;
  if (input.fieldMapping !== undefined) patch.fieldMapping = input.fieldMapping;
  if (input.autoSyncEnabled !== undefined) patch.autoSyncEnabled = input.autoSyncEnabled;
  if (input.intervalMinutes !== undefined) patch.intervalMinutes = input.intervalMinutes;

  const [row] = await db
    .update(syncSettings)
    .set(patch)
    .where(eq(syncSettings.jobKey, jobKey))
    .returning();
  return row ? toResponse(row) : null;
}
