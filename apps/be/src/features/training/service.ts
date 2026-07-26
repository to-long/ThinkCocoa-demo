/**
 * Training service — list + stats for `training.training_sessions`.
 *
 * Scoped to caller's active cooperative cookie.
 */

import {
  and,
  arrayOverlaps,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { trainingAttendance, trainingSessions } from '../../db/schema/training';
import { buildOrderBy } from '../../lib/sort';

export interface TrainingSessionListItem {
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

interface ListFilters {
  activeCoopId: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  programs?: string[];
  topics?: string[];
  societies?: string[];
  page: number;
  pageSize: number;
  sort?: string;
}

interface ListResult {
  items: TrainingSessionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listTrainingSessions(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(trainingSessions.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(trainingSessions.trainerName, like),
        ilike(trainingSessions.society, like),
        ilike(trainingSessions.venue, like),
        ilike(trainingSessions.koboUuid, like),
      )!,
    );
  }
  if (filters.dateFrom) conds.push(gte(trainingSessions.trainingDate, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(trainingSessions.trainingDate, filters.dateTo));
  if (filters.programs && filters.programs.length > 0) {
    conds.push(inArray(trainingSessions.program, filters.programs));
  }
  if (filters.societies && filters.societies.length > 0) {
    conds.push(inArray(trainingSessions.society, filters.societies));
  }
  if (filters.topics && filters.topics.length > 0) {
    // training_topics is text[]; match any-overlap with the requested set.
    conds.push(arrayOverlaps(trainingSessions.trainingTopics, filters.topics));
  }

  const where = and(...conds);

  const orderBy = buildOrderBy(
    filters.sort,
    {
      date: trainingSessions.trainingDate,
      program: trainingSessions.program,
      location: trainingSessions.venue,
      trainer: trainingSessions.trainerName,
      attendance: trainingSessions.totalParticipants,
      consent: trainingSessions.consentRate,
    },
    [desc(trainingSessions.trainingDate)],
  );

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(trainingSessions)
    .where(where);

  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select()
    .from(trainingSessions)
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset(offset);

  const items: TrainingSessionListItem[] = rows.map((r) => ({
    id: r.id,
    koboUuid: r.koboUuid,
    trainingDate: r.trainingDate,
    startTime: r.startTime,
    endTime: r.endTime,
    durationMinutes: r.durationMinutes,
    program: r.program,
    trainingType: r.trainingType,
    trainingTopics: r.trainingTopics,
    participantCategory: r.participantCategory,
    district: r.district,
    society: r.society,
    venue: r.venue,
    trainerName: r.trainerName,
    numMale: r.numMale,
    numFemale: r.numFemale,
    totalParticipants: r.totalParticipants,
    consentCount: r.consentCount,
    consentRate: r.consentRate != null ? Number(r.consentRate) : null,
    participantEngagement: r.participantEngagement,
    submittedAt: r.submittedAt.toISOString(),
  }));

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

// ── Detail ─────────────────────────────────────────────────────

export interface TrainingAttendeeItem {
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

export interface TrainingSessionDetail extends TrainingSessionListItem {
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
  attendance: TrainingAttendeeItem[];
}

export async function getTrainingSession(
  id: string,
  activeCoopId: string,
): Promise<TrainingSessionDetail | null> {
  const [row] = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.id, id), eq(trainingSessions.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;

  // LEFT JOIN farmer.farmers on farmerCode (= farmers.id, the producer
  // code) so the roster can show real farmer name / phone / gender even
  // when the Kobo submission stored only the code (e.g. flattened
  // multi-instance repeat groups). The row's own value wins; the farmer
  // record fills the gaps.
  const attendees = await db
    .select({
      id: trainingAttendance.id,
      farmerId: trainingAttendance.farmerId,
      farmerCode: trainingAttendance.farmerCode,
      farmerName: trainingAttendance.farmerName,
      gender: trainingAttendance.gender,
      cooperative: trainingAttendance.cooperative,
      phone: trainingAttendance.phone,
      consent: trainingAttendance.consent,
      signatureUrl: trainingAttendance.signatureUrl,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      farmerOtherNames: farmers.otherNames,
      farmerPhone: farmers.phoneNumber,
      farmerSex: farmers.sex,
      matchedFarmerId: farmers.id,
    })
    .from(trainingAttendance)
    .leftJoin(farmers, eq(farmers.id, trainingAttendance.farmerCode))
    .where(eq(trainingAttendance.sessionId, id))
    .orderBy(trainingAttendance.farmerCode);

  return {
    id: row.id,
    koboUuid: row.koboUuid,
    koboId: Number(row.koboId),
    formVersion: row.formVersion,
    trainingDate: row.trainingDate,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    program: row.program,
    trainingType: row.trainingType,
    trainingTopics: row.trainingTopics,
    participantCategory: row.participantCategory,
    district: row.district,
    society: row.society,
    venue: row.venue,
    trainerName: row.trainerName,
    trainerPhone: row.trainerPhone,
    numMale: row.numMale,
    numFemale: row.numFemale,
    totalParticipants: row.totalParticipants,
    consentCount: row.consentCount,
    consentRate: row.consentRate != null ? Number(row.consentRate) : null,
    participantEngagement: row.participantEngagement,
    sessionObjectivesMet: row.sessionObjectivesMet,
    trainerRemarks: row.trainerRemarks,
    trainerSignatureUrl: row.trainerSignatureUrl,
    snapshotUrl: row.snapshotUrl,
    submittedAt: row.submittedAt.toISOString(),
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attendance: attendees.map((a) => {
      const joinedName = a.farmerFirstName
        ? [a.farmerFirstName, a.farmerOtherNames, a.farmerLastName].filter(Boolean).join(' ')
        : null;
      return {
        id: a.id,
        farmerId: a.matchedFarmerId ?? a.farmerId,
        farmerCode: a.farmerCode,
        farmerName: a.farmerName ?? joinedName,
        gender: a.gender ?? a.farmerSex,
        cooperative: a.cooperative,
        phone: a.phone ?? a.farmerPhone,
        consent: a.consent,
        signatureUrl: a.signatureUrl,
        // Orphan = the code doesn't resolve to any farmer record.
        isOrphan: a.matchedFarmerId == null,
      };
    }),
  };
}

// ── Stats ───────────────────────────────────────────────────────

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

export async function getTrainingStats(activeCoopId: string): Promise<TrainingStats> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const [sessionRow] = await db
    .select({
      totalSessions: count(),
      sessionsLast30Days: sql<number>`COUNT(*) FILTER (WHERE ${trainingSessions.trainingDate} >= ${cutoff})`,
      totalParticipants: sql<number | null>`SUM(${trainingSessions.totalParticipants})`,
      avgAttendance: sql<
        number | null
      >`ROUND(AVG(${trainingSessions.totalParticipants})::numeric, 1)`,
      avgConsent: sql<number | null>`ROUND(AVG(${trainingSessions.consentRate})::numeric, 1)`,
    })
    .from(trainingSessions)
    .where(eq(trainingSessions.cooperativeId, activeCoopId));

  const [farmerRow] = await db
    .select({
      uniqueFarmers: sql<number>`COUNT(DISTINCT ${trainingAttendance.farmerCode})`,
    })
    .from(trainingAttendance)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingAttendance.sessionId))
    .where(eq(trainingSessions.cooperativeId, activeCoopId));

  const programRows = await db
    .selectDistinct({ program: trainingSessions.program })
    .from(trainingSessions)
    .where(eq(trainingSessions.cooperativeId, activeCoopId))
    .orderBy(trainingSessions.program);

  const societyRows = await db
    .selectDistinct({ society: trainingSessions.society })
    .from(trainingSessions)
    .where(eq(trainingSessions.cooperativeId, activeCoopId))
    .orderBy(trainingSessions.society);

  // training_topics is text[]; UNNEST + DISTINCT gives the flat option
  // list. Wrapped in a raw SQL to avoid drizzle composing it weirdly.
  const topicRows = await db.execute<{ topic: string }>(
    sql`SELECT DISTINCT UNNEST(${trainingSessions.trainingTopics}) AS topic
        FROM ${trainingSessions}
        WHERE ${trainingSessions.cooperativeId} = ${activeCoopId}
          AND ${trainingSessions.trainingTopics} IS NOT NULL
        ORDER BY topic`,
  );

  return {
    totalSessions: Number(sessionRow?.totalSessions ?? 0),
    sessionsLast30Days: Number(sessionRow?.sessionsLast30Days ?? 0),
    totalParticipants: Number(sessionRow?.totalParticipants ?? 0),
    uniqueFarmers: Number(farmerRow?.uniqueFarmers ?? 0),
    avgAttendance: sessionRow?.avgAttendance != null ? Number(sessionRow.avgAttendance) : null,
    consentRate: sessionRow?.avgConsent != null ? Number(sessionRow.avgConsent) : null,
    programs: programRows.map((r) => r.program).filter((s): s is string => !!s),
    topics: (topicRows.rows ?? topicRows)
      .map((r: { topic: string | null }) => r.topic)
      .filter((s): s is string => !!s),
    societies: societyRows.map((r) => r.society).filter((s): s is string => !!s),
  };
}
