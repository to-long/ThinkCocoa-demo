/**
 * SWR hooks + mutation for `/api/reports`. Polling is built into
 * `useReportRun` so the FE auto-refetches every 10s while the run is in
 * a non-terminal state and stops polling once it lands on
 * `completed` / `failed`.
 */

import useSWR, { useSWRConfig } from 'swr';
import { apiFetch } from './fetcher';

export type ReportCode =
  | 'farmer_coaching_v3'
  | 'traceability_report'
  | 'certification_status'
  | 'corrective_actions'
  | 'gmr_template'
  | 'eudr_compliance';
export type ReportFormat = 'excel' | 'csv' | 'pdf';
export type ReportStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ReportFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ReportRun {
  id: string;
  reportCode: string;
  status: ReportStatus;
  outputFormat: string;
  parameters: Record<string, unknown> | null;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
  file: ReportFile | null;
}

export interface RunReportBody {
  reportCode: ReportCode;
  outputFormat: ReportFormat;
  parameters: {
    /** Legacy season string (e.g. `"2024/25"`). Kept for backwards
     *  compat with runs pre-dating the date-range rollout. */
    season?: string;
    /** ISO date (`YYYY-MM-DD`) — inclusive lower bound. */
    dateFrom?: string | null;
    /** ISO date (`YYYY-MM-DD`) — inclusive upper bound. */
    dateTo?: string | null;
    /** Cooperative UUID — the "district" filter in the UI. Null / omitted
     *  means all districts the user has access to. */
    districtId?: string | null;
    societyId?: string | null;
    /** Users.id of the field officer / trainer / clerk to scope by.
     *  Null / omitted means every officer's records. */
    fieldOfficerUserId?: string | null;
  };
}

const REPORT_RUNS_KEY = '/api/reports/runs' as const;

function runKey(id: string) {
  return [REPORT_RUNS_KEY, id] as const;
}

function listKey(reportCode?: string) {
  return [REPORT_RUNS_KEY, 'list', reportCode ?? 'all'] as const;
}

/** Hook for the history list. Caller passes `reportCode` so the list is
 *  scoped to the currently-selected report type. */
export function useReportRuns(params: { reportCode?: string } = {}) {
  return useSWR<{ items: ReportRun[] }>(
    listKey(params.reportCode),
    () => {
      const sp = new URLSearchParams();
      if (params.reportCode) sp.set('reportCode', params.reportCode);
      const q = sp.toString();
      return apiFetch<{ items: ReportRun[] }>(`${REPORT_RUNS_KEY}${q ? `?${q}` : ''}`);
    },
    { revalidateOnFocus: false },
  );
}

/** Hook for a single run with built-in 10s polling. Returns the SWR
 *  result + a derived `isTerminal` so call sites don't have to re-derive
 *  the boolean. */
export function useReportRun(runId: string | null) {
  return useSWR<ReportRun>(
    runId ? runKey(runId) : null,
    () => apiFetch<ReportRun>(`${REPORT_RUNS_KEY}/${runId}`),
    {
      refreshInterval: (data) => {
        if (!data) return 10_000;
        return data.status === 'queued' || data.status === 'running' ? 10_000 : 0;
      },
      revalidateOnFocus: false,
    },
  );
}

export async function runReport(body: RunReportBody): Promise<{ runId: string }> {
  return apiFetch<{ runId: string }>('/api/reports/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Imperatively revalidate every list-scope hook — call after a new run
 *  is created so the history below the filter row refreshes. */
export function useRevalidateReportRuns() {
  const { mutate } = useSWRConfig();
  return (reportCode?: string) =>
    mutate(
      (key) =>
        Array.isArray(key) &&
        key[0] === REPORT_RUNS_KEY &&
        key[1] === 'list' &&
        (!reportCode || key[2] === reportCode),
    );
}

/** Compose the BE download URL for a run. Hitting it triggers a 302 to
 *  the presigned Spaces URL — set as `<a href>` or `window.location` to
 *  start the file save. */
export function reportDownloadUrl(runId: string): string {
  return `/api/reports/runs/${runId}/download`;
}

/** Distinct societies the active coop has data for in this report's
 *  source table — populates the Society filter dropdown. */
export function useReportSocieties(reportCode: ReportCode | null) {
  return useSWR<{ items: string[] }>(
    reportCode ? ([REPORT_RUNS_KEY, 'societies', reportCode] as const) : null,
    () => apiFetch<{ items: string[] }>(`/api/reports/societies?reportCode=${reportCode}`),
    { revalidateOnFocus: false },
  );
}
