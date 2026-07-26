/**
 * Farmers — DB access + audit-write side effects.
 *
 * Pure async functions that take typed inputs and return typed data.
 * No knowledge of Hono context, headers, or HTTP status codes —
 * route handlers translate query params → typed inputs and map
 * nullable returns / discriminated results into HTTP responses.
 *
 * Audit writes happen here (with the actor passed in) so callers
 * don't need to remember to fire `writeAudit` after each mutation.
 */

import type { CreateFarmerInput, UpdateFarmerInput } from '@cocoaimpact/shared';
import { and, asc, desc, sql as dsql, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { LRUCache } from 'lru-cache';
import { db } from '../../db/client';
import { farmers } from '../../db/schema/farmer';
import { cooperatives } from '../../db/schema/iam';
import { correctiveActions, inspections } from '../../db/schema/inspection';
import { writeAudit } from '../../lib/audit';
import { parseBoolFlag } from '../../lib/query-flags';
import type { ActiveCoopContext } from '../../middleware/active-coop';
import type { CertificationOutcome } from '../inspections/grading';
import { farmerAuditSnapshot, type LatestCertificationSnapshot } from './projection';
import type { FullStatsPayload, StatsPayload } from './schemas';

/** Shape of "who is performing this action" — extracted from the Hono
 *  context by the route layer and passed through so the service stays
 *  HTTP-agnostic. The full Hono `ctx` is also forwarded to `writeAudit`
 *  so it can resolve IP / user-agent / session id from the request. */
export interface ActorContext {
  userId: string;
  /** Hono context — used by writeAudit to extract IP / UA / session id. */
  ctx: Context<ActiveCoopContext>;
}

// ── LIST ─────────────────────────────────────────────────────
export interface ListFarmersFilters {
  /** Hard tenant filter — set by the route from the active-coop
   *  middleware. Always applied as an equality clause on
   *  `farmers.cooperative_id`; widening filters (e.g. user-supplied
   *  `cooperativeCodes` outside this id) are silently dropped to
   *  preserve scope isolation. */
  activeCoopId: string;
  q?: string;
  /** Multi-select: 0+ values. 1 → `=`, 2+ → `IN (...)`, 0 → no filter.
   *  All three multi-select fields below follow the same pattern so the
   *  FE can pass comma-separated lists straight from URL state. */
  cooperativeCodes: string[];
  societies: string[];
  certificationStatuses: string[];
  isActive?: 'true' | 'false';
  includeDeleted: boolean;
  page: number;
  pageSize: number;
  sort?: string;
}

export interface FarmerRow {
  farmer: typeof farmers.$inferSelect;
  coopCode: string;
  coopName: string;
  districtName: string | null;
  /** Most-recent inspection for this farmer — surfaces the derived
   *  certification outcome (Certified / CA / Not Certified) to the FE
   *  without a per-row round-trip. Null when the farmer has no
   *  inspections yet, or when the caller opts out (create/update return
   *  paths — they always start at null since a fresh farmer can't have
   *  an inspection). */
  latestCertification: LatestCertificationSnapshot | null;
  /** Outstanding (not-done) corrective actions across the farmer's
   *  inspections. Only the list query populates it; other paths → 0. */
  correctiveActions?: number;
}

/** Batch-fetch the newest inspection per farmer via `DISTINCT ON`.
 *  Returns a map keyed by farmer id so callers can enrich a farmer
 *  list in O(1) per row. Empty input → empty map (no DB roundtrip). */
async function getLatestCertificationsMap(
  farmerIds: string[],
): Promise<Map<string, LatestCertificationSnapshot>> {
  const out = new Map<string, LatestCertificationSnapshot>();
  if (farmerIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([inspections.farmerId], {
      id: inspections.id,
      farmerId: inspections.farmerId,
      dateInspection: inspections.dateInspection,
      complianceScore: inspections.complianceScore,
      compliancePct: inspections.compliancePct,
      programYear: inspections.programYear,
      certificationOutcome: inspections.certificationOutcome,
    })
    .from(inspections)
    .where(inArray(inspections.farmerId, farmerIds))
    .orderBy(inspections.farmerId, desc(inspections.dateInspection));
  for (const r of rows) {
    if (!r.farmerId) continue;
    out.set(r.farmerId, {
      inspectionId: r.id,
      dateInspection: r.dateInspection,
      complianceScore: r.complianceScore ?? null,
      compliancePct: r.compliancePct != null ? Number(r.compliancePct) : null,
      programYear: r.programYear ?? null,
      outcome: (r.certificationOutcome as CertificationOutcome | null) ?? null,
    });
  }
  return out;
}

// Small label-snapshot fed to writeAudit's `entitySnapshot`. Kept
// minimal — only the three fields the history page + bell popover
// render. Bigger profile data lives in `entity_changes` (per-field
// diff) or has to be re-queried. The `farmerCode` field name is
// preserved for backward-compat with existing audit snapshots, but
// its value is just `farmers.id` (the ProducerID).
function farmerEntitySnapshot(f: typeof farmers.$inferSelect) {
  return {
    farmerCode: f.id,
    firstName: f.firstName,
    lastName: f.lastName,
  };
}

export interface ListFarmersResult {
  rows: FarmerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFarmers(f: ListFarmersFilters): Promise<ListFarmersResult> {
  const offset = (f.page - 1) * f.pageSize;

  // Free-text search: farmer id (= ProducerID), first_name,
  // last_name, phone. Keep it cheap — ILIKE with leading `%` will
  // miss the PK index but the admin workflow tolerates it for 4K
  // rows.
  const whereClauses = [];
  // Hard tenant filter — always applied. Caller-supplied
  // `cooperativeCodes` is still honored below for backwards-compat
  // but can only NARROW within the active coop, never widen out.
  whereClauses.push(eq(farmers.cooperativeId, f.activeCoopId));
  if (!f.includeDeleted) whereClauses.push(isNull(farmers.deletedAt));
  if (f.q) {
    // Tokenize so "bismark ach" matches "Bismark Acheampong" — a
    // whitespace query spans first_name + last_name, which a per-column
    // ILIKE of the whole string can never hit. Each token must match
    // SOME field (AND across tokens, OR within a token). The
    // `first || ' ' || last` concat also lets a single token span the
    // name boundary in the natural order.
    const fullName = dsql`(${farmers.firstName} || ' ' || ${farmers.lastName})`;
    for (const tok of f.q.split(/\s+/).filter(Boolean)) {
      const like = `%${tok}%`;
      whereClauses.push(
        or(
          ilike(farmers.id, like),
          ilike(farmers.firstName, like),
          ilike(farmers.lastName, like),
          ilike(farmers.phoneNumber, like),
          dsql`${fullName} ILIKE ${like}`,
        )!,
      );
    }
  }
  // Multi-select filters: 1 value → `=` (uses index), 2+ → `IN (...)`.
  // Empty arrays leave the column unfiltered.
  if (f.cooperativeCodes.length === 1) {
    whereClauses.push(eq(cooperatives.code, f.cooperativeCodes[0]!));
  } else if (f.cooperativeCodes.length > 1) {
    whereClauses.push(inArray(cooperatives.code, f.cooperativeCodes));
  }
  if (f.societies.length === 1) {
    whereClauses.push(eq(farmers.society, f.societies[0]!));
  } else if (f.societies.length > 1) {
    whereClauses.push(inArray(farmers.society, f.societies));
  }
  if (f.certificationStatuses.length > 0) {
    // The filter matches against the DERIVED outcome of the farmer's
    // most-recent inspection. Subquery pulled inline so pagination +
    // total count stay accurate. Recognised values are the 3-outcome
    // enum plus `disqualified` (parser doesn't emit yet) and the
    // `none` sentinel (no inspection yet — subquery returns NULL).
    const includeNone = f.certificationStatuses.includes('none');
    const realOutcomes = f.certificationStatuses.filter((s) => s !== 'none');
    const latestSubquery = dsql`(
      SELECT certification_outcome FROM inspection.inspections i
      WHERE i.farmer_id = ${farmers.id}
      ORDER BY i.date_inspection DESC
      LIMIT 1
    )`;
    if (realOutcomes.length > 0 && includeNone) {
      const placeholders = dsql.join(
        realOutcomes.map((s) => dsql`${s}`),
        dsql`, `,
      );
      whereClauses.push(
        dsql`(${latestSubquery} IN (${placeholders}) OR ${latestSubquery} IS NULL)`,
      );
    } else if (realOutcomes.length > 0) {
      const placeholders = dsql.join(
        realOutcomes.map((s) => dsql`${s}`),
        dsql`, `,
      );
      whereClauses.push(dsql`${latestSubquery} IN (${placeholders})`);
    } else if (includeNone) {
      whereClauses.push(dsql`${latestSubquery} IS NULL`);
    }
  }
  if (f.isActive !== undefined) {
    whereClauses.push(eq(farmers.isActive, parseBoolFlag(f.isActive)));
  }
  const whereExpr = whereClauses.length > 0 ? and(...whereClauses) : undefined;

  // Parse JSON:API sort spec → drizzle order expressions. Comma-
  // separated fields each become their own `asc`/`desc` clause in
  // priority order — the first field is the primary sort, the
  // second is the tiebreaker, etc. `name` expands to (last_name,
  // first_name) under one direction so the secondary sort the FE
  // table renders matches what Postgres orders by. Unknown columns
  // are silently dropped; if the spec is empty after filtering,
  // we fall back to the desc(createdAt) default.
  const orderExprs = (() => {
    const out: ReturnType<typeof asc>[] = [];
    const fields = (f.sort ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const raw of fields) {
      const isDesc = raw.startsWith('-');
      const field = isDesc ? raw.slice(1) : raw;
      const dir = isDesc ? <T>(c: T) => desc(c as never) : <T>(c: T) => asc(c as never);
      switch (field) {
        case 'name':
          // Sort by the concatenated display form (`firstName lastName`)
          // instead of last_name-first — the CSV-imported dataset stores
          // middle initials INSIDE last_name (e.g. "Kwasi A Ansah" →
          // last_name="A Ansah"), so ordering by raw last_name produced
          // ASCII-correct but user-surprising results ("A Ansah" < "Ababio"
          // because space<b). Concat-order matches what the row visually
          // reads, which is what admins expect when they click the header.
          out.push(dir(dsql`${farmers.firstName} || ' ' || ${farmers.lastName}`));
          break;
        case 'farmer_code':
        case 'farmerCode':
        case 'id':
          out.push(dir(farmers.id));
          break;
        case 'registration_date':
        case 'registrationDate':
          out.push(dir(farmers.registrationDate));
          break;
        case 'society':
          out.push(dir(farmers.society));
          break;
        case 'phone':
        case 'phone_number':
          out.push(dir(farmers.phoneNumber));
          break;
        case 'shade_survival':
        case 'shade_survival_pct':
          out.push(dir(farmers.shadeSurvivalPct));
          break;
        case 'corrective_actions':
          // Not-done corrective actions across the farmer's inspections —
          // index-backed on corrective_actions(farmer_id).
          out.push(
            dir(
              dsql`(SELECT count(*) FROM ${correctiveActions} ca WHERE ca.farmer_id = ${farmers.id} AND ca.status <> 'done')`,
            ),
          );
          break;
        case 'status':
          // Status is a bucket derived from (deleted_at, is_active) — the
          // same rank the FE badge shows: active < inactive < deleted.
          out.push(
            dir(
              dsql`CASE WHEN ${farmers.deletedAt} IS NOT NULL THEN 2 WHEN ${farmers.isActive} THEN 0 ELSE 1 END`,
            ),
          );
          break;
        case 'certificate':
        case 'certification':
          // Rank the farmer's LATEST inspection outcome (same correlated
          // subquery the cert filter uses) so this sorts across the whole
          // dataset, not just one page. Quality order (asc): certified <
          // CA < not-certified < disqualified < none.
          out.push(
            dir(dsql`CASE (
              SELECT certification_outcome FROM inspection.inspections i
              WHERE i.farmer_id = ${farmers.id}
              ORDER BY i.date_inspection DESC
              LIMIT 1
            )
              WHEN 'certified' THEN 0
              WHEN 'certified_with_ca' THEN 1
              WHEN 'not_certified' THEN 2
              WHEN 'disqualified' THEN 3
              ELSE 4 END`),
          );
          break;
        // Unknown field — skip silently rather than 400ing.
      }
    }
    if (out.length === 0) out.push(desc(farmers.createdAt));
    return out;
  })();

  const [rows, countRows] = await Promise.all([
    db
      .select({
        farmer: farmers,
        coopCode: cooperatives.code,
        coopName: cooperatives.name,
        districtName: cooperatives.districtName,
        correctiveActions: dsql<number>`CAST((
          SELECT count(*) FROM ${correctiveActions} ca
          WHERE ca.farmer_id = ${farmers.id} AND ca.status <> 'done'
        ) AS INT)`,
      })
      .from(farmers)
      .innerJoin(cooperatives, eq(cooperatives.id, farmers.cooperativeId))
      .where(whereExpr)
      .orderBy(...orderExprs)
      .limit(f.pageSize)
      .offset(offset),
    db
      .select({ count: dsql<number>`CAST(count(*) AS INT)` })
      .from(farmers)
      .innerJoin(cooperatives, eq(cooperatives.id, farmers.cooperativeId))
      .where(whereExpr),
  ]);

  const certMap = await getLatestCertificationsMap(rows.map((r) => r.farmer.id));
  const enriched: FarmerRow[] = rows.map((r) => ({
    farmer: r.farmer,
    coopCode: r.coopCode,
    coopName: r.coopName,
    districtName: r.districtName ?? null,
    latestCertification: certMap.get(r.farmer.id) ?? null,
    correctiveActions: r.correctiveActions,
  }));
  return {
    rows: enriched,
    total: Number(countRows[0].count),
    page: f.page,
    pageSize: f.pageSize,
  };
}

// ── DETAIL ───────────────────────────────────────────────────
// Tenant-scoped lookup: rows outside the active coop are returned as
// `null` (not 403) so we don't leak the existence of farmer ids the
// caller doesn't have access to. The route layer maps `null` → 404.
export async function getFarmer(id: string, activeCoopId: string): Promise<FarmerRow | null> {
  const [row] = await db
    .select({
      farmer: farmers,
      coopCode: cooperatives.code,
      coopName: cooperatives.name,
      districtName: cooperatives.districtName,
    })
    .from(farmers)
    .innerJoin(cooperatives, eq(cooperatives.id, farmers.cooperativeId))
    .where(and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId)))
    .limit(1);
  if (!row) return null;
  const certMap = await getLatestCertificationsMap([row.farmer.id]);
  return {
    farmer: row.farmer,
    coopCode: row.coopCode,
    coopName: row.coopName,
    districtName: row.districtName ?? null,
    latestCertification: certMap.get(row.farmer.id) ?? null,
  };
}

// ── CREATE ───────────────────────────────────────────────────
export type CreateFarmerResult =
  | { kind: 'ok'; row: FarmerRow }
  | { kind: 'cooperative-not-found' }
  | { kind: 'duplicate'; farmerCode: string };

export async function createFarmer(
  input: CreateFarmerInput,
  actor: ActorContext,
): Promise<CreateFarmerResult> {
  const [coop] = await db
    .select()
    .from(cooperatives)
    .where(eq(cooperatives.id, input.cooperativeId))
    .limit(1);
  if (!coop) return { kind: 'cooperative-not-found' };

  // Farmer id == ProducerID is globally unique by construction in
  // the 2025-2026 dataset (every code carries its own coop prefix),
  // so the dedupe is a simple PK lookup — no per-coop scoping.
  const [dup] = await db
    .select({ id: farmers.id })
    .from(farmers)
    .where(eq(farmers.id, input.farmerCode))
    .limit(1);
  if (dup) {
    return { kind: 'duplicate', farmerCode: input.farmerCode };
  }

  const [row] = await db
    .insert(farmers)
    .values({
      cooperativeId: input.cooperativeId,
      id: input.farmerCode,
      firstName: input.firstName,
      lastName: input.lastName,
      otherNames: input.otherNames ?? null,
      sex: input.sex ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      phoneNumber: input.phoneNumber ?? null,
      nationalIdNumber: input.nationalIdNumber ?? null,
      nationalIdType: input.nationalIdType ?? null,
      society: input.society ?? null,
      dataCollectionConsent: input.dataCollectionConsent ?? null,
      certificationStatus: input.certificationStatus ?? 'unknown',
      registrationDate: input.registrationDate ?? null,
      householdSize: input.householdSize ?? null,
      childrenCount: input.childrenCount ?? null,
      isActive: input.isActive ?? true,
      producerId: input.producerId ?? null,
    })
    .returning();

  invalidateStatsCache();

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'farmer',
    entityTable: 'farmers',
    entityId: row.id,
    action: 'create',
    after: farmerAuditSnapshot(row),
    cooperativeId: row.cooperativeId,
    summary: `${row.firstName} ${row.lastName} (${row.id}) created`,
    entitySnapshot: farmerEntitySnapshot(row),
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      farmer: row,
      coopCode: coop.code,
      coopName: coop.name,
      districtName: coop.districtName ?? null,
      latestCertification: null,
    },
  };
}

// ── UPDATE ───────────────────────────────────────────────────
// `no-fields` is distinct from `not-found` so the route handler can
// preserve the original `'No fields to update'` error string — the FE
// surfaces the two cases differently (validation hint vs hard 404).
export type UpdateFarmerResult =
  | { kind: 'ok'; row: FarmerRow }
  | { kind: 'not-found' }
  | { kind: 'no-fields' };

/**
 * Optional caller hints for service-internal callers (e.g. the
 * inspection apply-changes flow) that want the audit row to carry
 * extra metadata or a clarifying summary suffix — without exposing
 * those fields on the public PATCH API.
 */
export interface UpdateFarmerOptions {
  /** Extra JSON merged into the audit row's `metadata` column. */
  auditMetadata?: Record<string, unknown>;
  /** Appended to the auto-generated summary, e.g. "(from inspection #757…)". */
  auditSummarySuffix?: string;
}

export async function updateFarmer(
  id: string,
  input: UpdateFarmerInput,
  actor: ActorContext,
  activeCoopId: string,
  opts: UpdateFarmerOptions = {},
): Promise<UpdateFarmerResult> {
  const patch: Partial<typeof farmers.$inferInsert> = {};
  // `cooperativeId` in the body is intentionally ignored — admins
  // cannot move a farmer between coops via the regular edit flow,
  // and the active-coop scoping below ensures we only ever touch
  // rows in the caller's current tenant.
  void input.cooperativeId;
  // `farmerCode` in the payload is intentionally ignored — it maps
  // to `farmers.id` (the PK), and changing the PK of an existing
  // row would orphan every FK reference (parcels, purchases,
  // inspections, …). Editors can adjust display fields below.
  void input.farmerCode;
  if (input.firstName !== undefined) patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
  if (input.otherNames !== undefined) patch.otherNames = input.otherNames;
  if (input.sex !== undefined) patch.sex = input.sex;
  if (input.dateOfBirth !== undefined) patch.dateOfBirth = input.dateOfBirth;
  if (input.phoneNumber !== undefined) patch.phoneNumber = input.phoneNumber;
  if (input.nationalIdNumber !== undefined) patch.nationalIdNumber = input.nationalIdNumber;
  if (input.nationalIdType !== undefined) patch.nationalIdType = input.nationalIdType;
  if (input.society !== undefined) patch.society = input.society;
  if (input.dataCollectionConsent !== undefined)
    patch.dataCollectionConsent = input.dataCollectionConsent;
  if (input.certificationStatus !== undefined)
    patch.certificationStatus = input.certificationStatus;
  if (input.registrationDate !== undefined) patch.registrationDate = input.registrationDate;
  if (input.householdSize !== undefined) patch.householdSize = input.householdSize;
  if (input.childrenCount !== undefined) patch.childrenCount = input.childrenCount;
  if (input.hhAssessed !== undefined) patch.hhAssessed = input.hhAssessed;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.producerId !== undefined) patch.producerId = input.producerId;

  if (Object.keys(patch).length === 0) {
    return { kind: 'no-fields' };
  }

  patch.updatedAt = new Date();

  // Pre-load + scope check in one query — rejects ids the caller's
  // active coop doesn't own, returning 404 so we don't leak that the
  // row exists in a sibling tenant.
  const [before] = await db
    .select()
    .from(farmers)
    .where(and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId)))
    .limit(1);
  if (!before) return { kind: 'not-found' };

  const [updated] = await db
    .update(farmers)
    .set(patch)
    .where(and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId)))
    .returning();
  if (!updated) return { kind: 'not-found' };

  const [coop] = await db
    .select()
    .from(cooperatives)
    .where(eq(cooperatives.id, updated.cooperativeId))
    .limit(1);

  invalidateStatsCache();

  const baseSummary = `${updated.firstName} ${updated.lastName} (${updated.id}) updated`;
  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'farmer',
    entityTable: 'farmers',
    entityId: id,
    action: 'update',
    before: farmerAuditSnapshot(before),
    after: farmerAuditSnapshot(updated),
    cooperativeId: updated.cooperativeId,
    summary: opts.auditSummarySuffix ? `${baseSummary} ${opts.auditSummarySuffix}` : baseSummary,
    entitySnapshot: farmerEntitySnapshot(updated),
    metadata: opts.auditMetadata,
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      farmer: updated,
      coopCode: coop!.code,
      coopName: coop!.name,
      districtName: coop!.districtName ?? null,
      latestCertification: null,
    },
  };
}

// ── SOFT DELETE ──────────────────────────────────────────────
export type SoftDeleteFarmerResult = { kind: 'ok' } | { kind: 'not-found' };

export async function softDeleteFarmer(
  id: string,
  actor: ActorContext,
  activeCoopId: string,
): Promise<SoftDeleteFarmerResult> {
  // `deletedAt` is the tombstone; `is_active` stays as-is so a later
  // restore returns the farmer to the exact pre-delete state.
  // Tenant scope baked into the WHERE so cross-coop deletes silently
  // 404 instead of nuking a row the caller can't see.
  const res = await db
    .update(farmers)
    .set({ deletedAt: new Date(), deletedBy: actor.userId })
    .where(
      and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId), isNull(farmers.deletedAt)),
    )
    .returning();
  if (res.length === 0) return { kind: 'not-found' };
  invalidateStatsCache();

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'farmer',
    entityTable: 'farmers',
    entityId: id,
    action: 'soft-delete',
    cooperativeId: res[0].cooperativeId,
    summary: `${res[0].firstName} ${res[0].lastName} (${res[0].id}) soft-deleted`,
    entitySnapshot: farmerEntitySnapshot(res[0]),
    ctx: actor.ctx,
  });

  return { kind: 'ok' };
}

// ── RESTORE ──────────────────────────────────────────────────
export type RestoreFarmerResult =
  | { kind: 'ok'; row: FarmerRow }
  | { kind: 'not-found' }
  | { kind: 'not-deleted' };

export async function restoreFarmer(
  id: string,
  actor: ActorContext,
  activeCoopId: string,
): Promise<RestoreFarmerResult> {
  const [existing] = await db
    .select({ id: farmers.id, deletedAt: farmers.deletedAt })
    .from(farmers)
    .where(and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId)))
    .limit(1);
  if (!existing) return { kind: 'not-found' };
  if (existing.deletedAt === null) {
    return { kind: 'not-deleted' };
  }

  const [updated] = await db
    .update(farmers)
    .set({ deletedAt: null, deletedBy: null })
    .where(and(eq(farmers.id, id), eq(farmers.cooperativeId, activeCoopId)))
    .returning();
  const [coop] = await db
    .select()
    .from(cooperatives)
    .where(eq(cooperatives.id, updated!.cooperativeId))
    .limit(1);

  invalidateStatsCache();

  await writeAudit({
    actorUserId: actor.userId,
    entitySchema: 'farmer',
    entityTable: 'farmers',
    entityId: id,
    action: 'restore',
    cooperativeId: updated!.cooperativeId,
    summary: `${updated!.firstName} ${updated!.lastName} (${updated!.id}) restored`,
    entitySnapshot: farmerEntitySnapshot(updated!),
    ctx: actor.ctx,
  });

  return {
    kind: 'ok',
    row: {
      farmer: updated!,
      coopCode: coop!.code,
      coopName: coop!.name,
      districtName: coop!.districtName ?? null,
      latestCertification: null,
    },
  };
}

// ── Stats cache ──────────────────────────────────────────────
// One cache, keyed on the FULL payload. Slim endpoint slices fields
// from the cached full entry — removes any possibility of the two
// shapes drifting from each other, and each DB round-trip serves
// both endpoints' subsequent reads for the TTL window.
interface StatsCacheEntry {
  payload: FullStatsPayload;
  computedAt: number;
}
const statsCache = new LRUCache<string, StatsCacheEntry>({
  max: 4, // room for the global key + 3 future per-scope variants
  ttl: 60_000, // 60s — stats drift is acceptable on a dashboard
});
const STATS_CACHE_KEY_PREFIX = 'coop:';

/** Slice a slim payload out of a cached full one. */
export function toSlim(full: FullStatsPayload): StatsPayload {
  return {
    total: full.total,
    active: full.active,
    inactive: full.inactive,
    deleted: full.deleted,
    raCertified: full.raCertified,
    withConsent: full.withConsent,
    byTenure: full.byTenure,
    byCertificationOutcome: full.byCertificationOutcome,
  };
}

/** Wipe the cache — call after any farmer mutation so the dashboard
 *  reflects the write on the very next fetch. */
export function invalidateStatsCache(): void {
  statsCache.clear();
}

/** Compute the full stats payload in a single DB round-trip. Scoped
 *  to one cooperative — the active-coop middleware passes the id from
 *  the cookie. `byCooperative` and `byDistrict` collapse to a single
 *  row inside one tenant; the FE still uses them for the donut so we
 *  keep the shape stable. */
async function computeFullStats(activeCoopId: string): Promise<FullStatsPayload> {
  const tenureCase = dsql<string>`
    CASE
      WHEN ${farmers.registrationDate} IS NULL THEN 'unknown'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '1 year'  THEN 'lt1'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '2 years' THEN '1'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '3 years' THEN '2'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '4 years' THEN '3'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '5 years' THEN '4'
      WHEN AGE(NOW(), ${farmers.registrationDate}::date) < INTERVAL '6 years' THEN '5'
      ELSE '5plus'
    END`;
  // Numeric bucketing — picked to match how admins think about
  // households / kids ("small / medium / large"). Kept SQL-side so the
  // donut legend is stable regardless of who reads it.
  const householdCase = dsql<string>`
    CASE
      WHEN ${farmers.householdSize} IS NULL THEN 'unknown'
      WHEN ${farmers.householdSize} <= 2  THEN '1-2'
      WHEN ${farmers.householdSize} <= 5  THEN '3-5'
      WHEN ${farmers.householdSize} <= 10 THEN '6-10'
      ELSE '10+'
    END`;
  const childrenCase = dsql<string>`
    CASE
      WHEN ${farmers.childrenCount} IS NULL THEN 'unknown'
      WHEN ${farmers.childrenCount} = 0   THEN '0'
      WHEN ${farmers.childrenCount} <= 2  THEN '1-2'
      WHEN ${farmers.childrenCount} <= 5  THEN '3-5'
      ELSE '6+'
    END`;
  const LIVE = dsql`${farmers.deletedAt} IS NULL`;
  // Tenant scope baked in once and reused across every query below.
  const SCOPED = eq(farmers.cooperativeId, activeCoopId);
  const SCOPED_LIVE = and(SCOPED, isNull(farmers.deletedAt));

  const [
    headlineRow,
    coopRows,
    districtRows,
    societyRows,
    tenureRows,
    sexRows,
    householdRows,
    childrenRows,
    certOutcomeRows,
  ] = await Promise.all([
    db
      .select({
        total: dsql<number>`CAST(count(*) AS INT)`,
        active: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.isActive} AND ${farmers.deletedAt} IS NULL) AS INT)`,
        inactive: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.isActive} = false AND ${farmers.deletedAt} IS NULL) AS INT)`,
        deleted: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.deletedAt} IS NOT NULL) AS INT)`,
        raCertified: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.certificationStatus} = 'rainforest_alliance' AND ${farmers.deletedAt} IS NULL) AS INT)`,
        withConsent: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.dataCollectionConsent} = true AND ${farmers.deletedAt} IS NULL) AS INT)`,
        withPhone: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.phoneNumber} IS NOT NULL AND length(trim(${farmers.phoneNumber})) > 0 AND ${farmers.deletedAt} IS NULL) AS INT)`,
        withNationalId: dsql<number>`CAST(count(*) FILTER (WHERE ${farmers.nationalIdNumber} IS NOT NULL AND length(trim(${farmers.nationalIdNumber})) > 0 AND ${farmers.deletedAt} IS NULL) AS INT)`,
      })
      .from(farmers)
      .where(SCOPED),

    db
      .select({
        code: cooperatives.code,
        name: cooperatives.name,
        count: dsql<number>`CAST(count(${farmers.id}) AS INT)`,
      })
      .from(cooperatives)
      .leftJoin(farmers, and(eq(farmers.cooperativeId, cooperatives.id), LIVE))
      .where(eq(cooperatives.id, activeCoopId))
      .groupBy(cooperatives.code, cooperatives.name)
      .orderBy(cooperatives.name),

    db
      .select({
        code: cooperatives.districtCode,
        name: cooperatives.districtName,
        count: dsql<number>`CAST(count(${farmers.id}) AS INT)`,
      })
      .from(cooperatives)
      .leftJoin(farmers, and(eq(farmers.cooperativeId, cooperatives.id), LIVE))
      .where(eq(cooperatives.id, activeCoopId))
      .groupBy(cooperatives.districtCode, cooperatives.districtName)
      .orderBy(cooperatives.districtName),

    db
      .select({
        society: farmers.society,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(farmers)
      .where(
        and(
          SCOPED_LIVE,
          dsql`${farmers.society} IS NOT NULL`,
          dsql`length(trim(${farmers.society})) > 0`,
        ),
      )
      .groupBy(farmers.society)
      .orderBy(dsql`count(*) DESC`),

    db
      .select({
        bucket: tenureCase,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(farmers)
      .where(SCOPED_LIVE)
      .groupBy(tenureCase),

    // Sex breakdown — null collapses into 'unknown' via COALESCE so
    // the donut always has a stable bucket list even when every row
    // is missing the value (current Demo Cocoa CSV state).
    db
      .select({
        sex: dsql<string>`COALESCE(${farmers.sex}, 'unknown')`,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(farmers)
      .where(SCOPED_LIVE)
      .groupBy(dsql`COALESCE(${farmers.sex}, 'unknown')`),

    db
      .select({
        bucket: householdCase,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(farmers)
      .where(SCOPED_LIVE)
      .groupBy(householdCase),

    db
      .select({
        bucket: childrenCase,
        count: dsql<number>`CAST(count(*) AS INT)`,
      })
      .from(farmers)
      .where(SCOPED_LIVE)
      .groupBy(childrenCase),

    // Certification-outcome breakdown — bucket farmers by the outcome
    // of their most-recent inspection. `none` catches farmers who have
    // no inspection yet so the totals sum to `total`. LATERAL join
    // pulls one inspection per farmer; using a bare correlated
    // subquery would either require re-writing the same expression in
    // GROUP BY or force PG-14+ ordinal references — LATERAL is the
    // cleanest option that all supported PG versions accept.
    db.execute<{ outcome: string; count: number }>(dsql`
      SELECT
        COALESCE(latest.outcome, 'none') AS outcome,
        CAST(count(*) AS INT) AS count
      FROM farmer.farmers f
      LEFT JOIN LATERAL (
        SELECT certification_outcome AS outcome
        FROM inspection.inspections
        WHERE farmer_id = f.id
        ORDER BY date_inspection DESC
        LIMIT 1
      ) latest ON true
      WHERE f.cooperative_id = ${activeCoopId}
        AND f.deleted_at IS NULL
      GROUP BY latest.outcome
    `),
  ]);

  const TENURE_ORDER = ['lt1', '1', '2', '3', '4', '5', '5plus', 'unknown'];
  const tenureByKey = new Map(tenureRows.map((r) => [r.bucket, Number(r.count)]));
  const byTenure = TENURE_ORDER.map((bucket) => ({
    bucket,
    count: tenureByKey.get(bucket) ?? 0,
  }));

  // Canonical sex order (female first matches Demo Cocoa's CSV ordering).
  // Missing rows collapse into the tail; we only emit buckets that have
  // at least one row so the donut legend doesn't fill with zero-count
  // entries.
  const SEX_ORDER = ['female', 'male', 'other', 'unknown'];
  const sexByKey = new Map(sexRows.map((r) => [r.sex, Number(r.count)]));
  const bySex = SEX_ORDER.flatMap((sex) => {
    const count = sexByKey.get(sex) ?? 0;
    return count > 0 ? [{ sex, count }] : [];
  });

  const HOUSEHOLD_ORDER = ['1-2', '3-5', '6-10', '10+', 'unknown'];
  const householdByKey = new Map(householdRows.map((r) => [r.bucket, Number(r.count)]));
  const byHouseholdSize = HOUSEHOLD_ORDER.map((bucket) => ({
    bucket,
    count: householdByKey.get(bucket) ?? 0,
  }));

  const CHILDREN_ORDER = ['0', '1-2', '3-5', '6+', 'unknown'];
  const childrenByKey = new Map(childrenRows.map((r) => [r.bucket, Number(r.count)]));
  const byChildrenCount = CHILDREN_ORDER.map((bucket) => ({
    bucket,
    count: childrenByKey.get(bucket) ?? 0,
  }));

  const CERT_OUTCOME_ORDER = [
    'certified',
    'certified_with_ca',
    'not_certified',
    'disqualified',
    'none',
  ] as const;
  const certOutcomeByKey = new Map(
    (certOutcomeRows.rows as { outcome: string; count: number }[]).map((r) => [
      r.outcome,
      Number(r.count),
    ]),
  );
  const byCertificationOutcome = CERT_OUTCOME_ORDER.map((outcome) => ({
    outcome,
    count: certOutcomeByKey.get(outcome) ?? 0,
  }));

  return {
    total: Number(headlineRow[0].total),
    active: Number(headlineRow[0].active),
    inactive: Number(headlineRow[0].inactive),
    deleted: Number(headlineRow[0].deleted),
    raCertified: Number(headlineRow[0].raCertified),
    withConsent: Number(headlineRow[0].withConsent),
    withPhone: Number(headlineRow[0].withPhone),
    withNationalId: Number(headlineRow[0].withNationalId),
    byCooperative: coopRows.map((r) => ({
      code: r.code,
      name: r.name,
      count: Number(r.count),
    })),
    byDistrict: districtRows.map((r) => ({
      code: r.code,
      name: r.name,
      count: Number(r.count),
    })),
    bySociety: societyRows
      .filter((r) => r.society !== null)
      .map((r) => ({ society: r.society!, count: Number(r.count) })),
    byTenure,
    bySex,
    byHouseholdSize,
    byChildrenCount,
    byCertificationOutcome,
  };
}

/** Get-or-compute helper used by both stats handlers. Returns the
 *  payload plus a `cacheStatus` hint so the route layer can set the
 *  `X-Cache` header on the response. */
export async function getCachedFullStats(activeCoopId: string): Promise<{
  payload: FullStatsPayload;
  cacheStatus: 'HIT' | 'MISS';
}> {
  const key = STATS_CACHE_KEY_PREFIX + activeCoopId;
  const cached = statsCache.get(key);
  if (cached) {
    return { payload: cached.payload, cacheStatus: 'HIT' };
  }
  const payload = await computeFullStats(activeCoopId);
  statsCache.set(key, { payload, computedAt: Date.now() });
  return { payload, cacheStatus: 'MISS' };
}
