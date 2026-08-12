/**
 * SWR hooks for `/api/training-sessions`.
 * Mirrors the coaching/inspections SWR shape.
 */

import useSWR from 'swr';
import { apiFetch, quietFetch, warm } from './fetcher';

export interface ApiTrainingSessionListItem {
  id: string;
  koboUuid: string;
  trainingDate: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  program: string | null;
  trainingType: string | null;
  trainingTopics: string[] | null;
  participantCategory: string | null;
  district: string | null;
  society: string | null;
  venue: string | null;
  trainerName: string | null;
  numMale: number | null;
  numFemale: number | null;
  totalParticipants: number | null;
  consentCount: number | null;
  consentRate: number | null;
  participantEngagement: string | null;
  submittedAt: string;
}

export interface TrainingListResponse {
  items: ApiTrainingSessionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrainingStats {
  totalSessions: number;
  sessionsLast30Days: number;
  totalParticipants: number;
  uniqueFarmers: number;
  avgAttendance: number | null;
  consentRate: number | null;
  programs: string[];
  topics: string[];
  societies: string[];
}

export interface TrainingListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  programs?: string; // CSV
  topics?: string; // CSV
  societies?: string; // CSV
  sort?: string;
}

export interface ApiTrainingAttendee {
  id: string;
  farmerId: string | null;
  farmerCode: string;
  farmerName: string | null;
  gender: string | null;
  cooperative: string | null;
  phone: string | null;
  consent: boolean;
  signatureUrl: string | null;
  isOrphan: boolean;
}

export interface ApiTrainingSessionDetail extends ApiTrainingSessionListItem {
  formVersion: string;
  koboId: number;
  trainerPhone: string | null;
  sessionObjectivesMet: boolean | null;
  trainerRemarks: string | null;
  trainerSignatureUrl: string | null;
  snapshotUrl: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
  rawData: Record<string, unknown>;
  attendance: ApiTrainingAttendee[];
}

export const TRAINING_STATS_KEY = ['/api/training-sessions/stats'] as const;

export function trainingKey(id: string) {
  return ['/api/training-sessions', id] as const;
}

export function useTrainingSession(id: string | null | undefined) {
  return useSWR<ApiTrainingSessionDetail>(id ? trainingKey(id) : null, () =>
    apiFetch<ApiTrainingSessionDetail>(
      `/api/training-sessions/${encodeURIComponent(id as string)}`,
    ),
  );
}

function normalize(p: TrainingListParams) {
  const out: Record<string, string | number> = {};
  if (p.page != null) out.page = p.page;
  if (p.pageSize != null) out.pageSize = p.pageSize;
  if (p.q) out.q = p.q;
  if (p.dateFrom) out.dateFrom = p.dateFrom;
  if (p.dateTo) out.dateTo = p.dateTo;
  if (p.programs) out.programs = p.programs;
  if (p.topics) out.topics = p.topics;
  if (p.societies) out.societies = p.societies;
  if (p.sort) out.sort = p.sort;
  return out;
}

export function trainingListKey(params: TrainingListParams = {}) {
  return ['/api/training-sessions', normalize(params)] as const;
}

/** Warm the default (page 1) training list + stats into SWR cache — route prefetch. */
export function prefetchTrainingList(): void {
  const p: TrainingListParams = { page: 1, pageSize: 10 };
  void warm(trainingListKey(p), () => quietFetch(`/api/training-sessions${buildQuery(p)}`)).catch(
    () => {},
  );
  void warm(TRAINING_STATS_KEY, () => quietFetch(TRAINING_STATS_KEY[0])).catch(() => {});
}

function buildQuery(p: TrainingListParams): string {
  const sp = new URLSearchParams();
  if (p.page != null) sp.set('page', String(p.page));
  if (p.pageSize != null) sp.set('pageSize', String(p.pageSize));
  if (p.q) sp.set('q', p.q);
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.programs) sp.set('programs', p.programs);
  if (p.topics) sp.set('topics', p.topics);
  if (p.societies) sp.set('societies', p.societies);
  if (p.sort) sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useTrainingSessionsList(params: TrainingListParams = {}) {
  return useSWR<TrainingListResponse>(
    trainingListKey(params),
    () => apiFetch<TrainingListResponse>(`/api/training-sessions${buildQuery(params)}`),
    { keepPreviousData: true },
  );
}

export function useTrainingStats() {
  return useSWR<TrainingStats>(
    TRAINING_STATS_KEY,
    () => apiFetch<TrainingStats>('/api/training-sessions/stats'),
    { revalidateOnFocus: false },
  );
}
