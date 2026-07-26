/**
 * Reports service — orchestrates the lifecycle of a report run.
 *
 *   POST /api/reports/run
 *     → enqueueReport()        // inserts report_runs row, kicks off
 *                              //   setImmediate(runReportInBackground)
 *
 *   GET /api/reports/runs
 *     → listRuns()             // history for the FE detail panel
 *
 *   GET /api/reports/runs/:id
 *     → getRunStatus()         // polled by the FE every 10s while running
 *
 *   GET /api/reports/runs/:id/download
 *     → presignDownload()      // 1h presigned GET URL to the Spaces object
 *
 * Worker model: in-process. One report run = one Promise scheduled with
 * `setImmediate`. The query + file build are CPU-cheap for v3 (single
 * coop / single season → at most a few thousand rows). If we ever need
 * concurrency throttling or cross-instance fanout, swap this for a
 * proper job queue.
 *
 * Crash recovery: on BE startup, `recoverOrphanedRuns()` flips any row
 * stuck in `queued|running` to `failed` so the FE polling loop doesn't
 * spin forever on a run whose worker died.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { coachingVisits } from '../../db/schema/coaching';
import { farmers } from '../../db/schema/farmer';
import { parcels } from '../../db/schema/gis';
import { reportFiles, reportRuns } from '../../db/schema/reporting';
import { trainingSessions } from '../../db/schema/training';
import { saveReportFile } from '../../lib/reports-storage';
import { generateCertificationReport } from './generators/certification';
import { generateCorrectiveActionsReport } from './generators/corrective-actions';
import { generateEudrReport } from './generators/eudr';
import {
  type CoachingReportFormat,
  generateFarmerCoachingV3,
} from './generators/farmer-coaching-v3';
import { generateGmrReport } from './generators/gmr';
import { generateTraceabilityReport } from './generators/traceability';
import { generateTrainingAttendanceReport } from './generators/training-attendance';
import { seasonToDateRange } from './lib/season';

export type ReportCode =
  | 'farmer_coaching_v3'
  | 'traceability_report'
  | 'certification_status'
  | 'corrective_actions'
  | 'gmr_template'
  | 'eudr_compliance'
  | 'training_attendance';
export type ReportFormat = CoachingReportFormat; // 'excel' | 'csv'
export type ReportStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ReportRunSummary {
  id: string;
  reportCode: string;
  status: ReportStatus;
  outputFormat: string;
  parameters: Record<string, unknown> | null;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
  file: {
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
}

interface EnqueueArgs {
  reportCode: ReportCode;
  outputFormat: ReportFormat;
  parameters: {
    /** Legacy season string (e.g. `"2024/25"`). Used as a fallback
     *  when the caller doesn't supply an explicit date range. */
    season?: string;
    /** ISO date (`YYYY-MM-DD`) — inclusive lower / upper bound. When
     *  supplied, takes precedence over `season`. */
    dateFrom?: string | null;
    dateTo?: string | null;
    districtId?: string | null;
    societyId?: string | null;
    fieldOfficerUserId?: string | null;
  };
  requestedByUserId: string;
  cooperativeId: string;
}

export async function enqueueReport(args: EnqueueArgs): Promise<{ runId: string }> {
  const [row] = await db
    .insert(reportRuns)
    .values({
      reportCode: args.reportCode,
      outputFormat: args.outputFormat,
      parameters: args.parameters,
      requestedByUserId: args.requestedByUserId,
      cooperativeId: args.cooperativeId,
      status: 'queued',
    })
    .returning({ id: reportRuns.id });

  // Fire-and-forget. We never `await` the worker — the HTTP response
  // returns immediately so the FE can start polling.
  setImmediate(() => {
    runReportInBackground(row!.id).catch((err) => {
      console.error(`[reports] runReportInBackground(${row!.id}) crashed:`, err);
    });
  });

  return { runId: row!.id };
}

/** Background worker — kicks itself via setImmediate, never throws to
 *  the caller. All failure paths land in the `catch` and mark the row
 *  as `failed` with an error message. */
async function runReportInBackground(runId: string): Promise<void> {
  await db
    .update(reportRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(reportRuns.id, runId));

  try {
    const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, runId)).limit(1);
    if (!run) throw new Error(`run ${runId} disappeared between enqueue and worker pickup`);
    if (!run.cooperativeId) throw new Error('run is missing cooperativeId');

    const params = (run.parameters ?? {}) as {
      season?: string;
      dateFrom?: string | null;
      dateTo?: string | null;
      districtId?: string | null;
      societyId?: string | null;
      fieldOfficerUserId?: string | null;
    };

    // Resolve the reporting window. Explicit date range wins; fall back
    // to the season → range helper so pre-date-range runs still work.
    let dateFrom = params.dateFrom ?? null;
    let dateTo = params.dateTo ?? null;
    if ((!dateFrom || !dateTo) && params.season) {
      const range = seasonToDateRange(params.season);
      dateFrom = range.from;
      dateTo = range.to;
    }
    if (!dateFrom || !dateTo) {
      throw new Error('parameters missing both `season` and `dateFrom`/`dateTo`');
    }

    const generated = await dispatchGenerator(run.reportCode, {
      cooperativeId: params.districtId ?? run.cooperativeId,
      dateFrom,
      dateTo,
      societyId: params.societyId ?? null,
      fieldOfficerUserId: params.fieldOfficerUserId ?? null,
      outputFormat: run.outputFormat as ReportFormat,
    });

    // Daily-bucketed storage path so the bucket browser groups runs by
    // date — matches the existing `reports/{YYYY-MM-DD}/…` convention
    // suggested in the plan.
    const today = new Date().toISOString().slice(0, 10);
    const storageKey = `reports/${today}/${runId}/${generated.fileName}`;

    await saveReportFile(storageKey, generated.buffer);

    await db.insert(reportFiles).values({
      reportRunId: runId,
      storageKey,
      fileName: generated.fileName,
      mimeType: generated.mimeType,
      sizeBytes: generated.buffer.byteLength,
    });

    await db
      .update(reportRuns)
      .set({
        status: 'completed',
        generatedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(reportRuns.id, runId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reports] run ${runId} failed:`, err);
    await db
      .update(reportRuns)
      .set({
        status: 'failed',
        errorMessage: msg.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(reportRuns.id, runId));
  }
}

export async function listRuns(args: {
  cooperativeId: string;
  reportCode?: string;
  limit?: number;
}): Promise<ReportRunSummary[]> {
  const limit = Math.min(100, Math.max(1, args.limit ?? 20));
  const conds = [eq(reportRuns.cooperativeId, args.cooperativeId)];
  if (args.reportCode) conds.push(eq(reportRuns.reportCode, args.reportCode));

  const runs = await db
    .select()
    .from(reportRuns)
    .where(and(...conds))
    .orderBy(desc(reportRuns.createdAt))
    .limit(limit);

  if (runs.length === 0) return [];

  // Batch-load matching files in one round-trip instead of N queries.
  const files = await db
    .select()
    .from(reportFiles)
    .where(
      inArray(
        reportFiles.reportRunId,
        runs.map((r) => r.id),
      ),
    );
  const fileByRun = new Map(files.map((f) => [f.reportRunId, f]));

  return runs.map((r) => toSummary(r, fileByRun.get(r.id)));
}

export async function getRunStatus(
  runId: string,
  cooperativeId: string,
): Promise<ReportRunSummary | null> {
  const [run] = await db
    .select()
    .from(reportRuns)
    .where(and(eq(reportRuns.id, runId), eq(reportRuns.cooperativeId, cooperativeId)))
    .limit(1);
  if (!run) return null;

  const [file] = await db
    .select()
    .from(reportFiles)
    .where(eq(reportFiles.reportRunId, runId))
    .limit(1);

  return toSummary(run, file);
}

export async function getRunFile(
  runId: string,
  cooperativeId: string,
): Promise<{ storageKey: string; fileName: string; mimeType: string } | null> {
  const [run] = await db
    .select({ id: reportRuns.id })
    .from(reportRuns)
    .where(and(eq(reportRuns.id, runId), eq(reportRuns.cooperativeId, cooperativeId)))
    .limit(1);
  if (!run) return null;

  const [file] = await db
    .select()
    .from(reportFiles)
    .where(eq(reportFiles.reportRunId, runId))
    .limit(1);
  if (!file) return null;
  return {
    storageKey: file.storageKey,
    fileName: file.fileName ?? 'report',
    mimeType: file.mimeType ?? 'application/octet-stream',
  };
}

/** Distinct society values per report code for the active coop. Each
 *  report reads from a different source table, so we branch on the
 *  report code. */
export async function listReportSocieties(args: {
  cooperativeId: string;
  reportCode: string;
}): Promise<string[]> {
  if (args.reportCode === 'farmer_coaching_v3') {
    const rows = await db
      .selectDistinct({ society: coachingVisits.society })
      .from(coachingVisits)
      .where(
        and(
          eq(coachingVisits.cooperativeId, args.cooperativeId),
          isNotNull(coachingVisits.society),
        ),
      )
      .orderBy(asc(coachingVisits.society));
    return rows.map((r) => r.society).filter((s): s is string => !!s);
  }
  if (
    args.reportCode === 'traceability_report' ||
    args.reportCode === 'gmr_template' ||
    args.reportCode === 'eudr_compliance'
  ) {
    // Both reports are keyed off parcels → farmer.society.
    const rows = await db
      .selectDistinct({ society: farmers.society })
      .from(parcels)
      .innerJoin(farmers, eq(farmers.id, parcels.farmerId))
      .where(
        and(
          eq(parcels.cooperativeId, args.cooperativeId),
          isNotNull(farmers.society),
          sql`${parcels.deletedAt} IS NULL`,
        ),
      )
      .orderBy(asc(farmers.society));
    return rows.map((r) => r.society).filter((s): s is string => !!s);
  }
  if (args.reportCode === 'certification_status' || args.reportCode === 'corrective_actions') {
    // Both reports are keyed off the farmer master.
    const rows = await db
      .selectDistinct({ society: farmers.society })
      .from(farmers)
      .where(
        and(
          eq(farmers.cooperativeId, args.cooperativeId),
          isNotNull(farmers.society),
          sql`${farmers.deletedAt} IS NULL`,
        ),
      )
      .orderBy(asc(farmers.society));
    return rows.map((r) => r.society).filter((s): s is string => !!s);
  }
  if (args.reportCode === 'training_attendance') {
    const rows = await db
      .selectDistinct({ society: trainingSessions.society })
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.cooperativeId, args.cooperativeId),
          isNotNull(trainingSessions.society),
        ),
      )
      .orderBy(asc(trainingSessions.society));
    return rows.map((r) => r.society).filter((s): s is string => !!s);
  }
  return [];
}

/** Dispatch table — keep generator imports + supported report codes in
 *  the same place so adding a new report is a one-line change. */
async function dispatchGenerator(
  reportCode: string,
  params: {
    cooperativeId: string;
    dateFrom: string;
    dateTo: string;
    societyId: string | null;
    fieldOfficerUserId?: string | null;
    outputFormat: ReportFormat;
  },
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  // Generators still accept the legacy `season` shape — synthesize one
  // from the date range so their filename slugs stay identical (they
  // encode the season, not the raw range) and their WHERE clauses keep
  // using `seasonToDateRange()`. Once every generator moves to accept
  // `dateFrom`/`dateTo` directly, we can drop this adapter.
  const generatorArgs = {
    cooperativeId: params.cooperativeId,
    season: seasonFromRange(params.dateFrom, params.dateTo),
    societyId: params.societyId,
    outputFormat: params.outputFormat,
  };
  switch (reportCode) {
    case 'farmer_coaching_v3':
      return generateFarmerCoachingV3(generatorArgs);
    case 'traceability_report':
      return generateTraceabilityReport(generatorArgs);
    case 'certification_status':
      return generateCertificationReport(generatorArgs);
    case 'corrective_actions':
      return generateCorrectiveActionsReport(generatorArgs);
    case 'gmr_template':
      return generateGmrReport(generatorArgs);
    case 'eudr_compliance':
      return generateEudrReport(generatorArgs);
    case 'training_attendance':
      return generateTrainingAttendanceReport(generatorArgs);
    default:
      throw new Error(`unknown reportCode "${reportCode}"`);
  }
}

/** Encode the picked window as a lossless `from..to` range token that
 *  `seasonToDateRange()` reads back verbatim. This lets a report cover
 *  a single calendar year OR several seasons at once without the old
 *  `YYYY/YY` round-trip — which threw on any span that wasn't exactly
 *  one consecutive cocoa year (e.g. a Jan–Dec range collapsed to
 *  `2026/26` and failed). The generators still use the true dateFrom /
 *  dateTo for their WHERE bounds; the token just carries them. */
function seasonFromRange(dateFrom: string, dateTo: string): string {
  return `${dateFrom.slice(0, 10)}..${dateTo.slice(0, 10)}`;
}

/** Startup pass — single update statement. Cheap, idempotent. */
export async function recoverOrphanedRuns(): Promise<number> {
  const result = await db
    .update(reportRuns)
    .set({
      status: 'failed',
      errorMessage: 'Process restarted before report finished generating.',
      updatedAt: new Date(),
    })
    .where(
      and(
        // Postgres CHECK constraint enumerates statuses — keep strings
        // matching the migration exactly.
        sql`${reportRuns.status} IN ('queued','running')`,
      ),
    )
    .returning({ id: reportRuns.id });
  return result.length;
}

// ── helpers ─────────────────────────────────────────────────────────

function toSummary(
  run: typeof reportRuns.$inferSelect,
  file: typeof reportFiles.$inferSelect | undefined,
): ReportRunSummary {
  return {
    id: run.id,
    reportCode: run.reportCode,
    status: run.status as ReportStatus,
    outputFormat: run.outputFormat,
    parameters: (run.parameters ?? null) as Record<string, unknown> | null,
    errorMessage: run.errorMessage,
    generatedAt: run.generatedAt ? run.generatedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    file: file
      ? {
          storageKey: file.storageKey,
          fileName: file.fileName ?? 'report',
          mimeType: file.mimeType ?? 'application/octet-stream',
          sizeBytes: Number(file.sizeBytes ?? 0),
        }
      : null,
  };
}
