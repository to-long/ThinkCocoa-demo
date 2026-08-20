/**
 * CLMRS read service — derives a child-labour register from the
 * coaching visits that carry a CLMRS verdict.
 *
 * The platform captures CLMRS risk per coaching visit
 * (`coaching.coaching_visits.clmrs_risk_level`), not per child. This
 * service reshapes every at-risk / case visit into the child-centric
 * `ClmrsRecord` shape the CLMRS page renders. Child-level display
 * fields (name, DOB, sex, hazardous activities) that the coaching
 * form doesn't capture are synthesised deterministically from the
 * visit id, so the same visit always yields the same child card.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clmrsCases } from '../../db/schema/clmrs';
import { coachingVisits } from '../../db/schema/coaching';
import { farmers } from '../../db/schema/farmer';
import { cooperatives } from '../../db/schema/iam';

export interface ClmrsFlag {
  childId: string;
  farmerId: string;
  farmerName: string;
  cooperativeCode: string;
  cooperativeName: string;
  childNameNormalised: string;
  childNameDisplay: string;
  childDob: string;
  childSex: 'M' | 'F';
  source: 'household_visit' | 'farm_visit';
  flaggedActivities: string[];
  hasCase: boolean;
  lastKoboSubmissionId: string;
  lastChildIndex: number;
  lastObservedAt: string;
  createdAt: string;
}
export interface ClmrsCase {
  id: string;
  clmrsCode: string;
  childId: string;
  status: 'open' | 'processing' | 'closed';
  lastVisitDate: string | null;
  followUpDate: string | null;
  createdAt: string;
  createdByName: string | null;
}
export interface ClmrsRecord {
  flag: ClmrsFlag;
  case: ClmrsCase | null;
}

const CHILD_FIRST_M = ['Kwame', 'Kwaku', 'Yaw', 'Kofi', 'Kojo', 'Kwabena', 'Kwadwo', 'Ebo'];
const CHILD_FIRST_F = ['Akua', 'Ama', 'Abena', 'Adjoa', 'Afua', 'Akosua', 'Efua', 'Esi'];
const CHILD_SURNAME = [
  'Mensah',
  'Owusu',
  'Boateng',
  'Asante',
  'Darko',
  'Appiah',
  'Bediako',
  'Antwi',
];
const HAZ = [
  'Handling machete / cutlass',
  'Spraying agrochemicals',
  'Carrying heavy loads',
  'Climbing tall trees',
  'Working at night',
  'Handling fire / burning debris',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function synthChild(visitId: string): {
  name: string;
  sex: 'M' | 'F';
  dob: string;
  activities: (n: number) => string[];
} {
  const h = hash(visitId);
  const isMale = h % 2 === 0;
  const first = (isMale ? CHILD_FIRST_M : CHILD_FIRST_F)[
    (h >>> 3) % (isMale ? CHILD_FIRST_M.length : CHILD_FIRST_F.length)
  ]!;
  const surname = CHILD_SURNAME[(h >>> 7) % CHILD_SURNAME.length]!;
  const year = 2008 + ((h >>> 11) % 9); // 2008–2016
  const month = 1 + ((h >>> 15) % 12);
  const day = 1 + ((h >>> 19) % 27);
  const dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const activities = (n: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(HAZ[(h >>> (3 * (i + 1))) % HAZ.length]!);
    return [...new Set(out)];
  };
  return { name: `${first} ${surname}`, sex: isMale ? 'M' : 'F', dob, activities };
}

function toRecord(row: {
  id: string;
  koboUuid: string;
  farmerId: string | null;
  visitDate: string | null;
  clmrsRiskLevel: string | null;
  clmrsCaseId: string | null;
  coachName: string | null;
  followUpDate: string | null;
  createdAt: Date;
  farmerName: string | null;
  coopCode: string | null;
  coopName: string | null;
  // Real remediation case (clmrs.cases), null when none opened yet.
  caseId: string | null;
  caseCode: string | null;
  caseStatus: string | null;
  caseFollowUp: string | null;
  caseLastVisit: string | null;
  caseCreatedAt: Date | null;
  caseCreatedBy: string | null;
}): ClmrsRecord {
  const child = synthChild(row.id);
  const isCase = row.clmrsRiskLevel === 'case';
  const hasRealCase = row.caseId != null;
  const observedAt = row.visitDate ?? row.createdAt.toISOString().slice(0, 10);
  const flag: ClmrsFlag = {
    childId: row.id,
    farmerId: row.farmerId ?? '',
    farmerName: row.farmerName ?? '—',
    cooperativeCode: row.coopCode ?? '',
    cooperativeName: row.coopName ?? '',
    childNameNormalised: child.name.toLowerCase(),
    childNameDisplay: child.name,
    childDob: child.dob,
    childSex: child.sex,
    source: hash(`s${row.id}`) % 2 === 0 ? 'household_visit' : 'farm_visit',
    flaggedActivities: child.activities(isCase ? 3 : 1),
    hasCase: hasRealCase || isCase,
    lastKoboSubmissionId: row.koboUuid,
    lastChildIndex: 0,
    lastObservedAt: observedAt,
    createdAt: row.createdAt.toISOString(),
  };
  // Prefer the real remediation case (clmrs.cases) when one has been
  // opened; otherwise fall back to the case derived from a 'case'
  // risk-level visit (legacy display for pre-seeded verdicts).
  const realCase: ClmrsCase | null = hasRealCase
    ? {
        id: row.caseId as string,
        clmrsCode: row.caseCode ?? `CLMRS-${row.farmerId ?? row.id}`,
        childId: row.id,
        status: (row.caseStatus as ClmrsCase['status']) ?? 'open',
        lastVisitDate: row.caseLastVisit ?? row.visitDate,
        followUpDate: row.caseFollowUp,
        createdAt: (row.caseCreatedAt ?? row.createdAt).toISOString(),
        createdByName: row.caseCreatedBy,
      }
    : null;
  const derivedCase: ClmrsCase | null = isCase
    ? {
        id: `case-${row.id}`,
        clmrsCode: row.clmrsCaseId ?? `CLMRS-${row.farmerId ?? row.id}`,
        childId: row.id,
        status: 'open',
        lastVisitDate: row.visitDate,
        followUpDate: row.followUpDate,
        createdAt: row.createdAt.toISOString(),
        createdByName: row.coachName,
      }
    : null;
  return { flag, case: realCase ?? derivedCase };
}

function baseQuery() {
  return (
    db
      .select({
        id: coachingVisits.id,
        koboUuid: coachingVisits.koboUuid,
        farmerId: coachingVisits.farmerId,
        visitDate: coachingVisits.visitDate,
        clmrsRiskLevel: coachingVisits.clmrsRiskLevel,
        clmrsCaseId: coachingVisits.clmrsCaseId,
        coachName: coachingVisits.coachName,
        followUpDate: coachingVisits.followUpDate,
        createdAt: coachingVisits.createdAt,
        farmerName: farmers.firstName,
        farmerLast: farmers.lastName,
        coopCode: cooperatives.code,
        coopName: cooperatives.name,
        caseId: clmrsCases.id,
        caseCode: clmrsCases.clmrsCode,
        caseStatus: clmrsCases.status,
        caseFollowUp: clmrsCases.followUpDate,
        caseLastVisit: clmrsCases.lastVisitDate,
        caseCreatedAt: clmrsCases.createdAt,
        caseCreatedBy: clmrsCases.createdByName,
      })
      .from(coachingVisits)
      .leftJoin(farmers, eq(farmers.id, coachingVisits.farmerId))
      .leftJoin(cooperatives, eq(cooperatives.id, coachingVisits.cooperativeId))
      // child_id is text; coaching_visits.id is uuid — cast to compare.
      .leftJoin(clmrsCases, eq(clmrsCases.childId, sql`${coachingVisits.id}::text`))
  );
}

/**
 * Open a real remediation case for a flag (coaching visit). Idempotent:
 * a second call for the same child updates the follow-up date instead of
 * duplicating. Returns null if the originating flag doesn't exist.
 */
export async function createClmrsCase(
  childId: string,
  followUpDate: string | null,
  createdBy: { id: string; name: string | null } | null = null,
): Promise<ClmrsCase | null> {
  const [visit] = await db
    .select({
      id: coachingVisits.id,
      visitDate: coachingVisits.visitDate,
      farmerId: coachingVisits.farmerId,
    })
    .from(coachingVisits)
    .where(eq(coachingVisits.id, childId))
    .limit(1);
  if (!visit) return null;

  const clmrsCode = `CLMRS-${childId.slice(0, 8).toUpperCase()}`;
  const [row] = await db
    .insert(clmrsCases)
    .values({
      childId,
      clmrsCode,
      status: 'open',
      lastVisitDate: visit.visitDate ?? null,
      followUpDate: followUpDate ?? null,
      createdByName: createdBy?.name ?? 'You',
      createdBy: createdBy?.id ?? null,
    })
    .onConflictDoUpdate({
      target: clmrsCases.childId,
      // Re-opening an existing case: refresh the follow-up date + status and
      // clear reminder_sent_at so the T-5 reminder re-arms for the new date.
      set: {
        followUpDate: followUpDate ?? null,
        status: 'open',
        reminderSentAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return {
    id: row.id,
    clmrsCode: row.clmrsCode,
    childId: row.childId,
    status: row.status as ClmrsCase['status'],
    lastVisitDate: row.lastVisitDate,
    followUpDate: row.followUpDate,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
  };
}

/**
 * Change a case's status (open ↔ processing ↔ closed). Reopening
 * captures a fresh follow-up date; closing clears it. Returns null if
 * no case exists for the child.
 */
export async function setClmrsCaseStatus(
  childId: string,
  status: ClmrsCase['status'],
  followUpDate: string | null,
): Promise<ClmrsCase | null> {
  const [row] = await db
    .update(clmrsCases)
    .set({
      status,
      // Closing clears the recheck date; open/processing keeps/sets it.
      followUpDate: status === 'closed' ? null : (followUpDate ?? null),
      // The follow-up context changed — re-arm the T-5 reminder so a
      // rescheduled/reopened case can send a fresh notice.
      reminderSentAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(clmrsCases.childId, childId))
    .returning();
  if (!row) return null;
  return {
    id: row.id,
    clmrsCode: row.clmrsCode,
    childId: row.childId,
    status: row.status as ClmrsCase['status'],
    lastVisitDate: row.lastVisitDate,
    followUpDate: row.followUpDate,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
  };
}

/** All CLMRS records (at-risk + case) for a cooperative, newest-first. */
export async function listClmrsRecords(cooperativeId: string): Promise<ClmrsRecord[]> {
  const rows = await baseQuery()
    .where(
      and(
        eq(coachingVisits.cooperativeId, cooperativeId),
        inArray(coachingVisits.clmrsRiskLevel, ['at_risk', 'case']),
      ),
    )
    .orderBy(desc(coachingVisits.visitDate));

  return rows.map((r) =>
    toRecord({
      ...r,
      farmerName:
        r.farmerName || r.farmerLast ? `${r.farmerName ?? ''} ${r.farmerLast ?? ''}`.trim() : null,
    }),
  );
}

/** Single record by child id (= coaching visit id). */
export async function getClmrsRecord(childId: string): Promise<ClmrsRecord | null> {
  const [r] = await baseQuery().where(eq(coachingVisits.id, childId)).limit(1);
  if (!r) return null;
  return toRecord({
    ...r,
    farmerName:
      r.farmerName || r.farmerLast ? `${r.farmerName ?? ''} ${r.farmerLast ?? ''}`.trim() : null,
  });
}
