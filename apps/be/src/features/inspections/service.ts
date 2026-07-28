/**
 * Inspection service — list / detail / stats / latest-per-parcel.
 *
 * All reads scope to the caller's active cooperative cookie (via
 * the `requireActiveCoop` middleware in routes), so users never see
 * other coops' data even if they hand-craft a query.
 */

import {
  and,
  asc,
  count,
  desc,
  sql as dsql,
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
import { parcels } from '../../db/schema/gis';
import { correctiveActions, inspectionAttachments, inspections } from '../../db/schema/inspection';
import { buildOrderBy } from '../../lib/sort';
import {
  type CorrectiveActionStatus,
  type InspectionDetail,
  type InspectionFollowUp,
  type InspectionListItem,
  toInspectionDetail,
  toInspectionListItem,
} from './projection';

/** Load corrective-action follow-ups for a set of inspections, grouped
 *  by inspection id. One query for the whole page (avoids N+1). */
async function loadFollowUps(inspectionIds: number[]): Promise<Map<number, InspectionFollowUp[]>> {
  const byInspection = new Map<number, InspectionFollowUp[]>();
  if (inspectionIds.length === 0) return byInspection;
  const rows = await db
    .select({
      id: correctiveActions.id,
      inspectionId: correctiveActions.inspectionId,
      topic: correctiveActions.topic,
      action: correctiveActions.action,
      actionDate: correctiveActions.actionDate,
      status: correctiveActions.status,
      lastComment: correctiveActions.lastComment,
    })
    .from(correctiveActions)
    .where(inArray(correctiveActions.inspectionId, inspectionIds))
    .orderBy(asc(correctiveActions.createdAt));
  for (const r of rows) {
    // inspection_id is nullable since corrective_actions went multi-source,
    // but this query filters to inspection rows so it's always present here.
    if (r.inspectionId == null) continue;
    const list = byInspection.get(r.inspectionId) ?? [];
    list.push({
      id: r.id,
      topic: r.topic,
      action: r.action,
      actionDate: r.actionDate,
      status: r.status as CorrectiveActionStatus,
      lastComment: r.lastComment,
    });
    byInspection.set(r.inspectionId, list);
  }
  return byInspection;
}

/** A corrective action plus which source raised it — for surfaces that
 *  aggregate across both inspections and coaching (e.g. parcel detail). */
export type CorrectiveActionItem = InspectionFollowUp & {
  source: 'inspection' | 'coaching';
};

/**
 * List corrective actions for a parcel or farmer across BOTH sources
 * (inspections + coaching), tenant-scoped. Mirrors the not-done count
 * subquery's `parcel_id` / `farmer_id` predicate so the card and the
 * count on the list stay in agreement. Not-done items first, then most
 * recent.
 */
export async function listCorrectiveActions(
  filter: { parcelId?: string; farmerId?: string },
  activeCoopId: string,
): Promise<CorrectiveActionItem[]> {
  const conds = [eq(correctiveActions.cooperativeId, activeCoopId)];
  if (filter.parcelId) conds.push(eq(correctiveActions.parcelId, filter.parcelId));
  if (filter.farmerId) conds.push(eq(correctiveActions.farmerId, filter.farmerId));
  if (!filter.parcelId && !filter.farmerId) return [];

  const rows = await db
    .select({
      id: correctiveActions.id,
      source: correctiveActions.source,
      topic: correctiveActions.topic,
      action: correctiveActions.action,
      actionDate: correctiveActions.actionDate,
      status: correctiveActions.status,
      lastComment: correctiveActions.lastComment,
    })
    .from(correctiveActions)
    .where(and(...conds))
    .orderBy(
      sql`(${correctiveActions.status} <> 'done') DESC`,
      desc(correctiveActions.dateInspection),
      asc(correctiveActions.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    source: (r.source === 'coaching' ? 'coaching' : 'inspection') as CorrectiveActionItem['source'],
    topic: r.topic,
    action: r.action,
    actionDate: r.actionDate,
    status: r.status as CorrectiveActionStatus,
    lastComment: r.lastComment,
  }));
}

interface ListFilters {
  activeCoopId: string;
  q?: string; // search inspector / farmer / parcel / kobo_uuid
  dateFrom?: string;
  dateTo?: string;
  eudrStatuses?: string[];
  /** Filter by derived certification outcome (see `grading.ts`).
   *  Replaces the old `complianceBuckets` (`high|mid|low`) which was a
   *  raw-pct grouping — now that outcome is a first-class column, the
   *  filter reads naturally against it and matches what the FE badge
   *  renders. */
  certificationOutcomes?: ('certified' | 'certified_with_ca' | 'not_certified' | 'disqualified')[];
  inspectorCodes?: string[];
  farmerId?: string;
  parcelId?: string;
  page: number;
  pageSize: number;
  sort?: string; // 'date' | '-date' | 'compliance_pct' | '-compliance_pct'
}

interface ListResult {
  items: InspectionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listInspections(filters: ListFilters): Promise<ListResult> {
  const conds = [eq(inspections.cooperativeId, filters.activeCoopId)];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conds.push(
      or(
        ilike(inspections.inspectorCode, like),
        ilike(inspections.farmerId, like),
        ilike(inspections.parcelId, like),
        ilike(inspections.koboUuid, like),
      )!,
    );
  }
  if (filters.dateFrom) conds.push(gte(inspections.dateInspection, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(inspections.dateInspection, filters.dateTo));
  if (filters.eudrStatuses && filters.eudrStatuses.length > 0) {
    conds.push(inArray(inspections.eudrStatus, filters.eudrStatuses));
  }
  if (filters.certificationOutcomes && filters.certificationOutcomes.length > 0) {
    conds.push(inArray(inspections.certificationOutcome, filters.certificationOutcomes));
  }
  if (filters.inspectorCodes && filters.inspectorCodes.length > 0) {
    conds.push(inArray(inspections.inspectorCode, filters.inspectorCodes));
  }
  if (filters.farmerId) conds.push(eq(inspections.farmerId, filters.farmerId));
  if (filters.parcelId) conds.push(eq(inspections.parcelId, filters.parcelId));

  const whereExpr = and(...conds);

  // Sort (JSON:API) — parsed against a column whitelist by the shared
  // helper. Joined `farmers.society` + `parcels.parcelName` are OK to
  // order by (the page query already leftJoins both; the count query
  // has no orderBy). Default: newest inspection first.
  const orderBy = buildOrderBy(
    filters.sort,
    {
      inspector: inspections.inspectorCode,
      inspector_code: inspections.inspectorCode,
      date: inspections.dateInspection,
      date_inspection: inspections.dateInspection,
      farmer: inspections.farmerId,
      farmer_id: inspections.farmerId,
      parcel_name: parcels.parcelName,
      parcel: inspections.parcelId,
      parcel_id: inspections.parcelId,
      society: farmers.society,
      eudr: inspections.eudrStatus,
      certification: inspections.certificationOutcome,
      compliance: inspections.compliancePct,
      compliance_pct: inspections.compliancePct,
      submitted: inspections.submittedAt,
      submitted_at: inspections.submittedAt,
      // Not-done corrective-action count from the dedicated table —
      // index-backed on corrective_actions(inspection_id).
      corrective_actions: sql`(select count(*) from ${correctiveActions} ca where ca.inspection_id = ${inspections.id} and ca.status <> 'done')`,
    },
    [desc(inspections.dateInspection)],
  );

  // Total count (cheap when index covers WHERE).
  const [{ value: total }] = await db.select({ value: count() }).from(inspections).where(whereExpr);

  // Page query — LEFT JOIN farmers for display name + society, and
  // parcels for the parcel display name.
  const rows = await db
    .select({
      i: inspections,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      society: farmers.society,
      parcelName: parcels.parcelName,
    })
    .from(inspections)
    .leftJoin(farmers, eq(farmers.id, inspections.farmerId))
    .leftJoin(parcels, eq(parcels.id, inspections.parcelId))
    .where(whereExpr)
    .orderBy(...orderBy)
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  const followUpsByInspection = await loadFollowUps(rows.map((r) => r.i.id));

  return {
    items: rows.map((r) =>
      toInspectionListItem(r.i, {
        farmerName:
          r.farmerFirstName && r.farmerLastName ? `${r.farmerFirstName} ${r.farmerLastName}` : null,
        society: r.society,
        parcelName: r.parcelName,
        followUps: followUpsByInspection.get(r.i.id) ?? [],
      }),
    ),
    total: total ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function getInspection(
  id: number,
  activeCoopId: string,
): Promise<InspectionDetail | null> {
  const [row] = await db
    .select({
      i: inspections,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      society: farmers.society,
      parcelName: parcels.parcelName,
    })
    .from(inspections)
    .leftJoin(farmers, eq(farmers.id, inspections.farmerId))
    .leftJoin(parcels, eq(parcels.id, inspections.parcelId))
    .where(and(eq(inspections.id, id), eq(inspections.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;
  const atts = await db
    .select()
    .from(inspectionAttachments)
    .where(eq(inspectionAttachments.inspectionId, id));
  const followUpsByInspection = await loadFollowUps([id]);
  return toInspectionDetail(row.i, atts, {
    farmerName:
      row.farmerFirstName && row.farmerLastName
        ? `${row.farmerFirstName} ${row.farmerLastName}`
        : null,
    society: row.society,
    parcelName: row.parcelName,
    followUps: followUpsByInspection.get(id) ?? [],
  });
}

/** Allowed status transition per current status — matches the single
 *  button the FE offers (Process / Done / Reopen). */
const NEXT_STATUS: Record<CorrectiveActionStatus, CorrectiveActionStatus> = {
  open: 'processing',
  reopen: 'processing',
  processing: 'done',
  done: 'reopen',
};

export type UpdateCorrectiveActionResult =
  | { kind: 'ok'; row: InspectionFollowUp & { inspectionId: number | null } }
  | { kind: 'not-found' }
  | { kind: 'invalid-transition'; from: CorrectiveActionStatus; to: CorrectiveActionStatus };

/** Update a corrective action's status (validated transition) and/or
 *  reschedule its deadline. Tenant-scoped by cooperative. */
export async function updateCorrectiveAction(
  id: string,
  input: {
    status?: CorrectiveActionStatus;
    actionDate?: string | null;
    lastComment?: string | null;
  },
  activeCoopId: string,
): Promise<UpdateCorrectiveActionResult> {
  const [existing] = await db
    .select()
    .from(correctiveActions)
    .where(and(eq(correctiveActions.id, id), eq(correctiveActions.cooperativeId, activeCoopId)))
    .limit(1);
  if (!existing) return { kind: 'not-found' };

  const set: Partial<typeof correctiveActions.$inferInsert> = { updatedAt: new Date() };
  if (input.status !== undefined) {
    const from = existing.status as CorrectiveActionStatus;
    if (NEXT_STATUS[from] !== input.status) {
      return { kind: 'invalid-transition', from, to: input.status };
    }
    set.status = input.status;
  }
  if (input.actionDate !== undefined) set.actionDate = input.actionDate;
  if (input.lastComment !== undefined) set.lastComment = input.lastComment;

  const [updated] = await db
    .update(correctiveActions)
    .set(set)
    .where(eq(correctiveActions.id, id))
    .returning();
  return {
    kind: 'ok',
    row: {
      id: updated!.id,
      inspectionId: updated!.inspectionId,
      topic: updated!.topic,
      action: updated!.action,
      actionDate: updated!.actionDate,
      status: updated!.status as CorrectiveActionStatus,
      lastComment: updated!.lastComment,
    },
  };
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
  /** Farmers grouped by certification outcome — replaces the pct-
   *  bucket breakdown so the stats card matches the Certificate column
   *  everywhere else. */
  certificate: {
    certified: number;
    certified_with_ca: number;
    not_certified: number;
    disqualified: number;
  };
}

export async function getInspectionStats(activeCoopId: string): Promise<InspectionStats> {
  const where = eq(inspections.cooperativeId, activeCoopId);

  const [{ total, thisMonth, avgPct }] = await db
    .select({
      total: count(),
      thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${inspections.dateInspection} >= date_trunc('month', CURRENT_DATE))`,
      avgPct: sql<string | null>`AVG(${inspections.compliancePct})`,
    })
    .from(inspections)
    .where(where);

  const eudrRows = await db
    .select({
      status: inspections.eudrStatus,
      cnt: count(),
    })
    .from(inspections)
    .where(where)
    .groupBy(inspections.eudrStatus);

  const eudr = { compliant: 0, needs_review: 0, non_compliant: 0, unknown: 0 };
  for (const r of eudrRows) {
    const k = (r.status ?? 'unknown') as keyof typeof eudr;
    if (k in eudr) eudr[k] = Number(r.cnt);
  }

  const [certRow] = await db
    .select({
      certified: sql<number>`COUNT(*) FILTER (WHERE ${inspections.certificationOutcome} = 'certified')`,
      certified_with_ca: sql<number>`COUNT(*) FILTER (WHERE ${inspections.certificationOutcome} = 'certified_with_ca')`,
      not_certified: sql<number>`COUNT(*) FILTER (WHERE ${inspections.certificationOutcome} = 'not_certified')`,
      disqualified: sql<number>`COUNT(*) FILTER (WHERE ${inspections.certificationOutcome} = 'disqualified')`,
    })
    .from(inspections)
    .where(where);

  return {
    total: Number(total),
    thisMonth: Number(thisMonth),
    avgCompliancePct: avgPct ? Math.round(Number.parseFloat(avgPct) * 100) / 100 : null,
    eudr,
    certificate: {
      certified: Number(certRow.certified),
      certified_with_ca: Number(certRow.certified_with_ca),
      not_certified: Number(certRow.not_certified),
      disqualified: Number(certRow.disqualified),
    },
  };
}

export interface CorrectiveActionStats {
  total: number;
  /** Not-done (open + reopen + processing). */
  outstanding: number;
  byStatus: { open: number; reopen: number; processing: number; done: number };
  /** Count per follow-up topic, descending. */
  byTopic: { topic: string; count: number }[];
  /** Outstanding actions whose deadline has passed. */
  overdue: number;
}

/** Corrective-action analytics for the dashboard — status mix, topic
 *  breakdown and overdue count, tenant-scoped by cooperative. */
export async function getCorrectiveActionStats(
  activeCoopId: string,
): Promise<CorrectiveActionStats> {
  const where = eq(correctiveActions.cooperativeId, activeCoopId);

  const [agg] = await db
    .select({
      total: count(),
      open: sql<number>`COUNT(*) FILTER (WHERE ${correctiveActions.status} = 'open')`,
      reopen: sql<number>`COUNT(*) FILTER (WHERE ${correctiveActions.status} = 'reopen')`,
      processing: sql<number>`COUNT(*) FILTER (WHERE ${correctiveActions.status} = 'processing')`,
      done: sql<number>`COUNT(*) FILTER (WHERE ${correctiveActions.status} = 'done')`,
      overdue: sql<number>`COUNT(*) FILTER (WHERE ${correctiveActions.status} <> 'done' AND ${correctiveActions.actionDate} < CURRENT_DATE)`,
    })
    .from(correctiveActions)
    .where(where);

  const topicRows = await db
    .select({ topic: correctiveActions.topic, cnt: count() })
    .from(correctiveActions)
    .where(where)
    .groupBy(correctiveActions.topic)
    .orderBy(desc(count()));

  const open = Number(agg?.open ?? 0);
  const reopen = Number(agg?.reopen ?? 0);
  const processing = Number(agg?.processing ?? 0);
  const done = Number(agg?.done ?? 0);

  return {
    total: Number(agg?.total ?? 0),
    outstanding: open + reopen + processing,
    byStatus: { open, reopen, processing, done },
    byTopic: topicRows.map((r) => ({ topic: r.topic, count: Number(r.cnt) })),
    overdue: Number(agg?.overdue ?? 0),
  };
}

/** Latest inspection of a given parcel — used by Farm Detail EUDR card. */
export async function getLatestInspectionForParcel(
  parcelId: string,
  activeCoopId: string,
): Promise<InspectionListItem | null> {
  const [row] = await db
    .select({
      i: inspections,
      farmerFirstName: farmers.firstName,
      farmerLastName: farmers.lastName,
      society: farmers.society,
    })
    .from(inspections)
    .leftJoin(farmers, eq(farmers.id, inspections.farmerId))
    .where(and(eq(inspections.parcelId, parcelId), eq(inspections.cooperativeId, activeCoopId)))
    .orderBy(desc(inspections.dateInspection))
    .limit(1);
  if (!row) return null;
  return toInspectionListItem(row.i, {
    farmerName:
      row.farmerFirstName && row.farmerLastName
        ? `${row.farmerFirstName} ${row.farmerLastName}`
        : null,
    society: row.society,
  });
}

// ── Snapshot vs master comparison ────────────────────────────────
// An inspection captures the farmer/parcel as the inspector saw them.
// The master rows drift afterwards (or the inspector recorded something
// new), so the detail page offers a field-by-field diff and an "apply to
// master" action. Pairs are declared once here and drive both endpoints.

export interface DiffField {
  key: string;
  label: string;
  inspection: string | null;
  master: string | null;
  isDiff: boolean;
}

export interface ComparisonSection {
  fields: DiffField[];
  diffs: number;
  matches: number;
  /** True when the master row is gone (deleted farmer / parcel). */
  missing: boolean;
}

export interface InspectionComparison {
  inspectionId: number;
  farmer: ComparisonSection;
  parcel: ComparisonSection;
}

type Section = 'farmer' | 'parcel';

/** Normalise for display + equality: null/'' → null, numbers trimmed. */
function norm(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (s === '') return null;
  // Numeric strings compare by value so "3.9300" === "3.93".
  const n = Number(s);
  return Number.isFinite(n) && /^-?\d*\.?\d+$/.test(s) ? String(n) : s;
}

function buildSection(
  pairs: { key: string; label: string; inspection: unknown; master: unknown }[],
  missing: boolean,
): ComparisonSection {
  const fields = pairs.map((p) => {
    const inspection = norm(p.inspection);
    const master = norm(p.master);
    return {
      key: p.key,
      label: p.label,
      inspection,
      master,
      // Only a real disagreement counts — a field the inspection didn't
      // capture isn't a diff, it's just absent.
      isDiff: !missing && inspection != null && inspection !== master,
    };
  });
  return {
    fields,
    diffs: fields.filter((f) => f.isDiff).length,
    matches: fields.filter((f) => !f.isDiff).length,
    missing,
  };
}

/** Year component of a date column, for the parcel `yearEstablished` pair. */
function yearOf(d: string | null): number | null {
  if (!d) return null;
  const y = Number(String(d).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export async function getInspectionComparison(
  id: number,
  activeCoopId: string,
): Promise<InspectionComparison | null> {
  const [row] = await db
    .select({
      i: inspections,
      farmerDeleted: farmers.deletedAt,
      farmerDob: farmers.dateOfBirth,
      farmerSex: farmers.sex,
      farmerNationalId: farmers.nationalIdNumber,
      farmerHousehold: farmers.householdSize,
      farmerChildren: farmers.childrenCount,
      parcelDeleted: parcels.deletedAt,
      parcelArea: parcels.calculatedAreaHa,
      parcelPlanting: parcels.plantingDate,
    })
    .from(inspections)
    .leftJoin(farmers, eq(farmers.id, inspections.farmerId))
    .leftJoin(parcels, eq(parcels.id, inspections.parcelId))
    .where(and(eq(inspections.id, id), eq(inspections.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;

  const i = row.i;
  const farmerMissing = row.farmerDob === undefined && row.farmerSex === undefined;
  const farmer = buildSection(
    [
      { key: 'dob', label: 'Date of birth', inspection: i.farmerDob, master: row.farmerDob },
      { key: 'gender', label: 'Gender', inspection: i.farmerGender, master: row.farmerSex },
      {
        key: 'ghanaCard',
        label: 'Ghana Card',
        inspection: i.ghanaCard,
        master: row.farmerNationalId,
      },
      {
        key: 'householdSize',
        label: 'Household size',
        inspection: i.householdSize,
        master: row.farmerHousehold,
      },
      {
        key: 'childrenCount',
        label: 'Children under 17',
        inspection: i.childrenCount,
        master: row.farmerChildren,
      },
    ],
    farmerMissing || row.farmerDeleted != null,
  );

  const parcelMissing = row.parcelArea === undefined && row.parcelPlanting === undefined;
  const parcel = buildSection(
    [
      {
        key: 'fieldSize',
        label: 'Field size (ha)',
        inspection: i.fieldSizeHa,
        master: row.parcelArea,
      },
      {
        key: 'yearEstablished',
        label: 'Year established',
        inspection: i.yearEstablished,
        master: yearOf(row.parcelPlanting),
      },
    ],
    parcelMissing || row.parcelDeleted != null,
  );

  return { inspectionId: i.id, farmer, parcel };
}

/**
 * Copy chosen snapshot values onto the master row. Unknown keys and
 * non-diff keys are reported as `skipped` rather than failing the call,
 * so a stale UI can't half-apply.
 */
export async function applyInspectionChanges(
  id: number,
  section: Section,
  keys: string[],
  activeCoopId: string,
): Promise<{ applied: string[]; skipped: string[]; comparison: InspectionComparison } | null> {
  const current = await getInspectionComparison(id, activeCoopId);
  if (!current) return null;

  const [row] = await db
    .select({ farmerId: inspections.farmerId, parcelId: inspections.parcelId, i: inspections })
    .from(inspections)
    .where(and(eq(inspections.id, id), eq(inspections.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;

  const sec = section === 'farmer' ? current.farmer : current.parcel;
  const applied: string[] = [];
  const skipped: string[] = [];
  const farmerPatch: Record<string, unknown> = {};
  const parcelPatch: Record<string, unknown> = {};

  for (const key of keys) {
    const field = sec.fields.find((f) => f.key === key);
    if (!field?.isDiff) {
      skipped.push(key);
      continue;
    }
    const i = row.i;
    switch (key) {
      case 'dob':
        // Snapshots from older form versions carry a bare year; the master
        // column is DATE, so widen it the same way the importer does.
        farmerPatch.dateOfBirth = /^\d{4}$/.test(String(i.farmerDob ?? ''))
          ? `${i.farmerDob}-01-01`
          : i.farmerDob;
        break;
      case 'gender':
        farmerPatch.sex = i.farmerGender;
        break;
      case 'ghanaCard':
        farmerPatch.nationalIdNumber = i.ghanaCard;
        break;
      case 'householdSize':
        farmerPatch.householdSize = i.householdSize;
        break;
      case 'childrenCount':
        farmerPatch.childrenCount = i.childrenCount;
        break;
      case 'fieldSize':
        parcelPatch.calculatedAreaHa = i.fieldSizeHa;
        break;
      case 'yearEstablished':
        // Master stores a full date; year-only data lands as YYYY-01-01
        // (same convention as the Kobo importer).
        parcelPatch.plantingDate = i.yearEstablished ? `${i.yearEstablished}-01-01` : null;
        break;
      default:
        skipped.push(key);
        continue;
    }
    applied.push(key);
  }

  if (section === 'farmer' && Object.keys(farmerPatch).length > 0 && row.farmerId) {
    await db
      .update(farmers)
      .set({ ...farmerPatch, updatedAt: dsql`now()` })
      .where(eq(farmers.id, row.farmerId));
  }
  if (section === 'parcel' && Object.keys(parcelPatch).length > 0 && row.parcelId) {
    await db
      .update(parcels)
      .set({ ...parcelPatch, updatedAt: dsql`now()` })
      .where(eq(parcels.id, row.parcelId));
  }

  const comparison = (await getInspectionComparison(id, activeCoopId)) ?? current;
  return { applied, skipped, comparison };
}
