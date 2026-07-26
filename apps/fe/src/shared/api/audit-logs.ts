/**
 * Audit log — SWR hooks for `/api/audit-logs`.
 *
 * Read-only feature: list (paginated + filtered), detail (incl. field-
 * level changes), and stats (totals + breakdown by status / scope).
 * No mutations exist on the FE — audit log is append-only and rows
 * arrive via BE-side instrumentation (future work).
 */

import {
  getApiAuditLogs,
  getApiAuditLogsById,
  getApiAuditLogsStats,
} from '@cocoaimpact/shared/impact-cocoa-client';
import useSWR from 'swr';
import { unwrap } from './fetcher';

// ── Types ─────────────────────────────────────────────────────────────────

export type AuditStatus = 'success' | 'failed' | 'warning';

export interface ApiAuditLog {
  id: number;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorFullName: string | null;
  serviceName: string | null;
  entitySchema: string;
  entityTable: string;
  entityId: string | null;
  action: string;
  cooperativeId: string | null;
  cooperativeName: string | null;
  status: AuditStatus | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  /** Top-N (≤3) field changes attached to this row, surfaced in the
   *  list response so the FE can render inline. Full diff still lives
   *  on the detail endpoint. `null` when no diff is attached (create /
   *  delete / login / etc.). */
  changesPreview: ApiAuditLogChangesPreview | null;
}

export interface ApiAuditLogChangePreviewEntry {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ApiAuditLogChangesPreview {
  preview: ApiAuditLogChangePreviewEntry[];
  /** Total number of changes attached (may exceed `preview.length`). */
  total: number;
}

export interface ApiAuditLogChange {
  id: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ApiAuditLogDetail extends ApiAuditLog {
  changes: ApiAuditLogChange[];
}

export interface AuditLogListResponse {
  data: ApiAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogStats {
  total: number;
  windowDays: number;
  byStatus: { success: number; failed: number; warning: number };
  byScope: { entityTable: string; count: number }[];
}

// ── Filters ───────────────────────────────────────────────────────────────

export interface AuditLogListParams {
  q?: string;
  actorId?: string;
  /** Exact `entity_id` match — used by "follow this object" deep
   *  links from a record detail page into its audit history. */
  entityId?: string;
  /** Comma-joined list — sent verbatim to the BE which splits & treats as IN(). */
  entityTables?: string[];
  /** Filter to events scoped to these cooperatives (audit row's
   *  `cooperative_id`). Comma-joined list, same contract as the
   *  others. */
  cooperativeIds?: string[];
  /** Same comma-list contract for action verbs (create/update/...). */
  actions?: string[];
  /** Same comma-list contract for status (success/failed/warning).
   *  Empty array == no filter; one value is just a list of one. */
  statuses?: AuditStatus[];
  /** ISO timestamps — escape hatch for explicit ranges. The audit
   *  page uses `days` instead so URL state stays readable. */
  from?: string;
  to?: string;
  /** Convenience: "last N days". BE computes `from` server-side and
   *  ignores any client-supplied `from`. */
  days?: number;
  page?: number;
  pageSize?: number;
  /**
   * JSON:API-style sort spec — `field` (asc) or `-field` (desc),
   * comma-separated for multi-column. Default (when omitted) is
   * newest-first on the server.
   */
  sort?: string;
}

function normalizeListParams(p: AuditLogListParams) {
  // Sort arrays so cache keys are stable regardless of multi-select
  // pick order. Empty arrays are dropped to keep the cache key minimal.
  const out: Record<string, string | number> = {};
  if (p.q) out.q = p.q;
  if (p.actorId) out.actorId = p.actorId;
  if (p.entityId) out.entityId = p.entityId;
  if (p.entityTables && p.entityTables.length > 0) {
    out.entityTable = [...p.entityTables].sort().join(',');
  }
  if (p.cooperativeIds && p.cooperativeIds.length > 0) {
    out.cooperativeId = [...p.cooperativeIds].sort().join(',');
  }
  if (p.actions && p.actions.length > 0) {
    out.action = [...p.actions].sort().join(',');
  }
  if (p.statuses && p.statuses.length > 0) {
    out.status = [...p.statuses].sort().join(',');
  }
  if (p.from) out.from = p.from;
  if (p.to) out.to = p.to;
  if (p.days) out.days = p.days;
  if (p.page) out.page = p.page;
  if (p.pageSize) out.pageSize = p.pageSize;
  if (p.sort) out.sort = p.sort;
  return out;
}

// ── Keys ──────────────────────────────────────────────────────────────────

export function auditLogsListKey(params: AuditLogListParams = {}) {
  return ['/api/audit-logs', normalizeListParams(params)] as const;
}

export function auditLogKey(id: number | string) {
  return ['/api/audit-logs', String(id)] as const;
}

export function auditLogsStatsKey(days?: number) {
  return ['/api/audit-logs/stats', { days: days ?? 30 }] as const;
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useAuditLogList(params: AuditLogListParams = {}) {
  // `keepPreviousData` lets the page render the previous result set
  // (dimmed via opacity in the consumer) while the next page or
  // re-filtered request is in flight — no empty-flash transition.
  return useSWR<AuditLogListResponse>(
    auditLogsListKey(params),
    async () => {
      const query: Record<string, string> = {};
      const norm = normalizeListParams(params);
      for (const [k, v] of Object.entries(norm)) query[k] = String(v);
      const res = await getApiAuditLogs({ query });
      return unwrap(res) as AuditLogListResponse;
    },
    // Audit logs are append-only and not high-velocity at admin
    // browse-time — re-fetching on every window focus blows past the
    // pager state. Mutations don't apply here, so freshness comes
    // from the user clicking refresh / re-filtering.
    { keepPreviousData: true, revalidateOnFocus: false },
  );
}

export function useAuditLog(id: string | number | undefined | null) {
  return useSWR<ApiAuditLogDetail>(
    id != null && id !== '' ? auditLogKey(id) : null,
    async () => {
      const res = await getApiAuditLogsById({ path: { id: String(id) } });
      return unwrap(res) as ApiAuditLogDetail;
    },
    { revalidateOnFocus: false },
  );
}

export function useAuditLogStats(days?: number) {
  return useSWR<AuditLogStats>(
    auditLogsStatsKey(days),
    async () => {
      const res = await getApiAuditLogsStats(days ? { query: { days: String(days) } } : undefined);
      return unwrap(res) as AuditLogStats;
    },
    { revalidateOnFocus: false },
  );
}
