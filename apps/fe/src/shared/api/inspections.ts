/**
 * SWR hooks for `/api/inspections`.
 *
 * Mirrors the parcels SWR module — keys are tuples so global
 * `mutate(predicate)` calls can invalidate every list cache at once
 * after a sync run.
 */

import useSWR from 'swr';
import { apiFetch, quietFetch, warm } from './fetcher';

export type EudrStatus = 'unknown' | 'compliant' | 'non_compliant' | 'needs_review';
export type ComplianceBucket = 'high' | 'mid' | 'low';

export interface ApiInspectionAttachment {
  id: string;
  koboUid: string;
  questionXpath: string;
  filename: string | null;
  mimetype: string | null;
  koboUrl: string | null;
  spacesUrl: string | null;
}

export interface ApiInspectionListItem {
  /** PK = Kobo `_id` (numeric, e.g. 757860568) since BE migration 0024. */
  id: number;
  koboUuid: string;
  formVersion: string;
  cooperativeId: string | null;
  farmerId: string | null;
  parcelId: string | null;
  dateInspection: string;
  inspectorCode: string | null;
  eudrStatus: EudrStatus | null;
  complianceScore: number | null;
  complianceMax: number | null;
  compliancePct: number | null;
  programYear: number | null;
  certificationOutcome: 'certified' | 'certified_with_ca' | 'not_certified' | 'disqualified' | null;
  submittedAt: string;
  syncedAt: string;
  /** Corrective actions + target dates parsed from the raw submission. */
  followUps: InspectionFollowUp[];
  farmerName?: string | null;
  society?: string | null;
  parcelName: string | null;
}

export type CorrectiveActionStatus = 'open' | 'reopen' | 'processing' | 'done';

/** A farm-management item that isn't yet compliant, plus the follow-up
 *  action the farmer must complete and its target date. Backed by the
 *  `inspection.corrective_actions` table (mutable `status` + `id`). */
export interface InspectionFollowUp {
  id: string;
  topic: string;
  action: string;
  /** Deadline for the corrective action. */
  actionDate: string | null;
  status: CorrectiveActionStatus;
  /** Closing note recorded when the action was marked done. */
  lastComment: string | null;
  /** Which record raised it — only set on aggregated (parcel/farmer)
   *  surfaces that mix sources; undefined on single-record cards. */
  source?: 'inspection' | 'coaching';
}

export interface ApiInspectionDetail extends ApiInspectionListItem {
  // (no `koboId` — `id` IS the Kobo `_id` since BE migration 0024)
  eudrScore: number | null;
  eudrNoDeforestation: boolean | null;
  eudrNoForestConversion: boolean | null;
  eudrOutsideHcva: boolean | null;
  eudrLegalRights: boolean | null;
  eudrAssessedAt: string | null;
  // Structured detail (formerly raw_data).
  farmerDob: string | null;
  farmerGender: string | null;
  nationalIdCard: string | null;
  purchasingClerkCard: string | null;
  householdSize: number | null;
  childrenCount: number | null;
  clmrsAssessed: boolean | null;
  fieldSizeHa: string | null;
  yearEstablished: number | null;
  farmMapped: boolean | null;
  gpsLocation: string | null;
  permanentStaff: number | null;
  temporaryStaff: number | null;
  totalHarvestKg: string | null;
  totalSoldKg: string | null;
  nextSeasonEstimateKg: string | null;
  anotherLbc: boolean | null;
  anotherLbcReason: string | null;
  trainingTopics: string | null;
  raChildLabour: string | null;
  raForcedLabour: string | null;
  raDiscrimination: string | null;
  raAbuse: string | null;
  submittedBy: string | null;
  snapshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ApiInspectionAttachment[];
}

export interface InspectionListResponse {
  items: ApiInspectionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InspectionStats {
  total: number;
  thisMonth: number;
  avgCompliancePct: number | null;
  eudr: {
    compliant: number;
    needs_review: number;
    non_compliant: number;
    unknown: number;
  };
  certificate: {
    certified: number;
    certified_with_ca: number;
    not_certified: number;
    disqualified: number;
  };
}

export interface CorrectiveActionStats {
  total: number;
  /** Not-done (open + reopen + processing). */
  outstanding: number;
  byStatus: { open: number; reopen: number; processing: number; done: number };
  /** Count per follow-up topic, descending. */
  byTopic: { topic: string; count: number }[];
  /** Outstanding actions past their deadline. */
  overdue: number;
}

export const CORRECTIVE_ACTION_STATS_KEY = ['/api/inspections/corrective-actions/stats'] as const;

export function useCorrectiveActionStats() {
  return useSWR<CorrectiveActionStats>(
    CORRECTIVE_ACTION_STATS_KEY,
    () => apiFetch<CorrectiveActionStats>('/api/inspections/corrective-actions/stats'),
    { revalidateOnFocus: false },
  );
}

export interface InspectionsListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  eudr?: string;
  compliance?: string;
  inspector?: string;
  farmerId?: string;
  parcelId?: string;
  sort?: string;
}

export const INSPECTION_STATS_KEY = ['/api/inspections/stats'] as const;

function normalize(p: InspectionsListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.eudr) out.eudr = p.eudr;
  if (p.compliance) out.compliance = p.compliance;
  if (p.inspector) out.inspector = p.inspector;
  if (p.farmerId) out.farmerId = p.farmerId;
  if (p.parcelId) out.parcelId = p.parcelId;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function inspectionsListKey(params: InspectionsListParams = {}) {
  return ['/api/inspections', normalize(params)] as const;
}

export function inspectionKey(id: string) {
  return ['/api/inspections', id] as const;
}

function buildQuery(p: InspectionsListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.eudr) sp.set('eudr', p.eudr);
  if (p.compliance) sp.set('compliance', p.compliance);
  if (p.inspector) sp.set('inspector', p.inspector);
  if (p.farmerId) sp.set('farmerId', p.farmerId);
  if (p.parcelId) sp.set('parcelId', p.parcelId);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useInspectionsList(params: InspectionsListParams = {}) {
  return useSWR<InspectionListResponse>(
    inspectionsListKey(params),
    () => apiFetch<InspectionListResponse>(`/api/inspections${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useInspectionStats() {
  return useSWR<InspectionStats>(
    INSPECTION_STATS_KEY,
    () => apiFetch<InspectionStats>('/api/inspections/stats'),
    { revalidateOnFocus: false },
  );
}

export function useInspection(id: string | undefined | null) {
  return useSWR<ApiInspectionDetail>(id ? inspectionKey(id) : null, () =>
    apiFetch<ApiInspectionDetail>(`/api/inspections/${encodeURIComponent(id as string)}`),
  );
}

/** Warm the default Inspections list + its two stat surfaces
 *  (see prefetchParcelsList). */
export function prefetchInspectionsList(): void {
  const p: InspectionsListParams = { page: 1, pageSize: 10 };
  void warm(inspectionsListKey(p), () =>
    quietFetch<InspectionListResponse>(`/api/inspections${buildQuery(p)}`),
  ).catch(() => {});
  void warm(INSPECTION_STATS_KEY, () =>
    quietFetch<InspectionStats>('/api/inspections/stats'),
  ).catch(() => {});
  void warm(CORRECTIVE_ACTION_STATS_KEY, () =>
    quietFetch<CorrectiveActionStats>('/api/inspections/corrective-actions/stats'),
  ).catch(() => {});
}

/** Trigger Kobo sync for the inspection form.
 *
 *  Returns immediately (202) — the actual sync runs in the
 *  background on the BE. Completion and failure show up as
 *  audit-log notifications (visible in the bell). The caller only
 *  needs to know the trigger was accepted.
 */
export async function triggerInspectionSync(): Promise<{ status: 'started' }> {
  return apiFetch('/api/inspections/sync', { method: 'POST' });
}

export interface ApiDiffField {
  key: string;
  label: string;
  inspection: string | null;
  master: string | null;
  isDiff: boolean;
}

export interface ApiComparisonSection {
  fields: ApiDiffField[];
  diffs: number;
  matches: number;
  missing: boolean;
}

export interface ApiInspectionComparison {
  /** Kobo `_id` (numeric) — matches the inspection PK since BE
   *  migration 0024. */
  inspectionId: number;
  farmer: ApiComparisonSection;
  parcel: ApiComparisonSection;
}

export function useInspectionComparison(id: string | undefined | null) {
  return useSWR<ApiInspectionComparison>(
    id ? (['/api/inspections', id, 'comparison'] as const) : null,
    () =>
      apiFetch<ApiInspectionComparison>(
        `/api/inspections/${encodeURIComponent(id as string)}/comparison`,
      ),
    { revalidateOnFocus: false },
  );
}

export interface ApplyChangesResponse {
  applied: string[];
  skipped: string[];
  comparison: ApiInspectionComparison;
}

/** Apply selected diff fields from an inspection snapshot to the
 *  farmer / parcel master row. Returns the fresh comparison so the
 *  caller can mutate SWR cache without a second fetch.
 *
 *  BE permission: `farmer:update` for section='farmer',
 *  `parcel:update` for section='parcel'. Caller should hide the
 *  Apply button when the user lacks the permission. */
export async function applyInspectionChanges(
  inspectionId: string,
  body: { section: 'farmer' | 'parcel'; keys: string[] },
): Promise<ApplyChangesResponse> {
  return apiFetch<ApplyChangesResponse>(
    `/api/inspections/${encodeURIComponent(inspectionId)}/apply-changes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export interface ApiCorrectiveAction {
  id: string;
  inspectionId: number | null;
  topic: string;
  action: string;
  actionDate: string | null;
  status: CorrectiveActionStatus;
  lastComment: string | null;
}

/** Update a corrective action's status and/or reschedule its deadline.
 *  BE permission: `inspection:update`. Returns the updated row so the
 *  caller can patch SWR cache optimistically.
 *
 *  Status transitions enforced server-side:
 *  open/reopen → processing → done → reopen. */
export async function updateCorrectiveAction(
  id: string,
  body: {
    status?: CorrectiveActionStatus;
    actionDate?: string | null;
    lastComment?: string | null;
  },
): Promise<ApiCorrectiveAction> {
  return apiFetch<ApiCorrectiveAction>(
    `/api/inspections/corrective-actions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/** Corrective actions for a parcel (or farmer) across BOTH sources —
 *  inspections + coaching. Powers the aggregated card on parcel detail. */
export function useCorrectiveActions(
  filter: { parcelId?: string | null; farmerId?: string | null } = {},
) {
  const { parcelId, farmerId } = filter;
  const key = parcelId || farmerId;
  return useSWR<{ items: InspectionFollowUp[] }>(
    key ? (['/api/inspections/corrective-actions', parcelId ?? '', farmerId ?? ''] as const) : null,
    () => {
      const sp = new URLSearchParams();
      if (parcelId) sp.set('parcelId', parcelId);
      if (farmerId) sp.set('farmerId', farmerId);
      return apiFetch<{ items: InspectionFollowUp[] }>(
        `/api/inspections/corrective-actions?${sp.toString()}`,
      );
    },
  );
}

export function useLatestInspectionForParcel(parcelId: string | undefined | null) {
  return useSWR<ApiInspectionListItem>(
    parcelId ? (['/api/parcels', parcelId, 'latest-inspection'] as const) : null,
    () =>
      apiFetch<ApiInspectionListItem>(
        `/api/parcels/${encodeURIComponent(parcelId as string)}/latest-inspection`,
      ),
  );
}
