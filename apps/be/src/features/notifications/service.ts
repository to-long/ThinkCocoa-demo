/**
 * Notifications service — read-only.
 *
 * Reads from `audit.audit_logs` filtered by the caller's effective
 * scope:
 *   - resource ∈ user permissions ending in `:notification`
 *   - cooperative_id matches active-coop scope (or org-wide)
 *   - (NO self-action filter — every audit row reaches every
 *     authorized subscriber, including the user who issued it. This
 *     gives live "I just did this" confirmation in the bell + audit
 *     feed across the user's open tabs.)
 *
 * No separate `notifications` table — the audit log IS the source of
 * truth (per `docs/notifications-and-audit-refactor-plan.md`).
 */

import { and, sql as dsql, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { auditLogs } from '../../db/schema/audit';
import { userNotificationPref, userNotificationReads } from '../../db/schema/iam';

// Map audit `entity_table` (plural / DB table name) → permission
// resource prefix (singular). Mirrors
// `audit.resource_from_entity_table()` SQL helper — keep in sync.
const ENTITY_TABLE_TO_RESOURCE: Record<string, string> = {
  farmers: 'farmer',
  parcels: 'parcel',
  inspections: 'inspection',
  trainings: 'training',
  training_sessions: 'training',
  coaching_visits: 'coaching',
  batches: 'batch',
  eudr_assessments: 'eudr',
  cooperatives: 'cooperative',
  users: 'user',
  roles: 'role',
  permissions: 'permission',
  sync_jobs: 'sync',
  sync_settings: 'sync',
  report_runs: 'report',
};

export function resourceFromEntityTable(t: string): string | null {
  return ENTITY_TABLE_TO_RESOURCE[t] ?? null;
}

/**
 * Resources the user is GRANTED notification eligibility for —
 * derived from their permission set. Any code ending in
 * `:notification` qualifies. Doesn't account for per-user opt-outs;
 * use `effectiveSubscribedResources()` for the live SSE filter.
 */
export function grantedNotificationResources(perms: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const code of perms) {
    if (code.endsWith(':notification')) {
      out.add(code.slice(0, -':notification'.length));
    }
  }
  return out;
}

// Backwards-compat alias used by routes.ts.
export const subscribedResources = grantedNotificationResources;

/**
 * Resources the user is granted AND hasn't opted out of. The SSE
 * filter + unread count both call this so disabling a resource in
 * /profile silences both surfaces.
 */
export async function effectiveSubscribedResources(
  userId: string,
  perms: Iterable<string>,
): Promise<Set<string>> {
  const granted = grantedNotificationResources(perms);
  if (granted.size === 0) return granted;
  const disabledRows = await db
    .select({ resource: userNotificationPref.resource })
    .from(userNotificationPref)
    .where(eq(userNotificationPref.userId, userId));
  for (const r of disabledRows) granted.delete(r.resource);
  return granted;
}

/**
 * Read the user's per-resource toggles for the settings UI:
 * returns the set of resources they have explicitly DISABLED.
 * Anything else from `grantedNotificationResources(perms)` is
 * implicitly enabled.
 */
export async function getDisabledResources(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ resource: userNotificationPref.resource })
    .from(userNotificationPref)
    .where(eq(userNotificationPref.userId, userId));
  return new Set(rows.map((r) => r.resource));
}

/** Replace the user's disabled-resource set in one transaction —
 *  caller passes the FULL list of resources they want OFF. */
export async function setDisabledResources(userId: string, disabled: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userNotificationPref).where(eq(userNotificationPref.userId, userId));
    if (disabled.length > 0) {
      await tx
        .insert(userNotificationPref)
        .values(disabled.map((resource) => ({ userId, resource })));
    }
  });
  // Touch unused import to keep tree-shaker honest in case the
  // inArray helper is needed by future settings endpoints.
  void inArray;
}

interface UnreadCountFilter {
  userId: string;
  isAllCooperative: boolean;
  resources: Set<string>;
  /** Active-coop cookie scope. When set, only events on that coop are
   *  counted (mirrors the FE bell which scopes to active coop). */
  activeCoopId: string | null;
  /** Lower bound — only audit rows with id > sinceAuditId count. When
   *  null, count rows from the last 24h as a sane default. */
  sinceAuditId: number | null;
}

export interface UnreadCount {
  count: number;
  /** Highest audit id visible to the caller (cursor target). */
  latestId: number | null;
}

/**
 * COUNT audit_logs rows matching the user's notification scope.
 * Returns at most 999 (reported as `999+` on the UI). Fast: BTree on
 * `audit_logs.id` makes the GT-cursor + filter join hit indexes.
 */
export async function getUnreadCount(f: UnreadCountFilter): Promise<UnreadCount> {
  // No self-action filter — see file-header docstring. Every audit
  // row reaches every authorized subscriber, including the user who
  // issued it. This gives live "I just did this" confirmation in the
  // bell + audit feed across the user's open tabs.
  //
  // Cursor (or 24h fallback) is the FIRST condition so TS infers the
  // array element type from a real drizzle SQL expression.
  const sinceCondition =
    f.sinceAuditId !== null
      ? gt(auditLogs.id, f.sinceAuditId)
      : gte(auditLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000));
  const conditions = [sinceCondition];

  // Coop scope. Org-wide events (`cooperative_id IS NULL` — role /
  // permission / user edits) ALWAYS pass: they're admin-level and
  // visible to every coop scope. Otherwise must match active coop
  // or the user's assignments.
  if (f.activeCoopId) {
    conditions.push(
      dsql`(${auditLogs.cooperativeId} IS NULL OR ${auditLogs.cooperativeId} = ${f.activeCoopId})`,
    );
  } else if (!f.isAllCooperative) {
    conditions.push(
      dsql`(${auditLogs.cooperativeId} IS NULL OR EXISTS (
        SELECT 1 FROM iam.user_cooperative_assignments uca
        WHERE uca.user_id = ${f.userId}
          AND uca.cooperative_id = ${auditLogs.cooperativeId}
      ))`,
    );
  }

  // Resource gate — OR list of equality checks. Drizzle interpolates
  // JS arrays as `($1, $2, …)` records not `text[]`, so a direct
  // `ANY(...::text[])` cast errors at parse time. List is small
  // (≤13 resources), so the OR is cheap.
  if (f.resources.size === 0) return { count: 0, latestId: null };
  const resourceList = Array.from(f.resources);
  const orClauses = resourceList.map(
    (r) => dsql`audit.resource_from_entity_table(${auditLogs.entityTable}) = ${r}`,
  );
  // `or(...)` returns SQL | undefined; we know length>0 so non-null
  conditions.push(orClauses.length === 1 ? orClauses[0]! : or(...orClauses)!);

  const [row] = await db
    .select({ count: dsql<number>`CAST(LEAST(COUNT(*), 999) AS INT)` })
    .from(auditLogs)
    .where(and(...conditions));

  // Highest visible id, ignoring the `since` cursor. The bell writes this
  // back as its new cursor on close — using the max id of the FIRST PAGE
  // instead leaves rows stranded, because seeded/real rows aren't in id
  // order by `created_at` (the list sorts by time), so a newer id can sit
  // on page 3 and the badge never clears.
  const scopeConditions = conditions.slice(1);
  const [latest] = await db
    .select({ latestId: dsql<number | null>`MAX(${auditLogs.id})` })
    .from(auditLogs)
    .where(scopeConditions.length > 0 ? and(...scopeConditions) : undefined);

  return {
    count: Number(row?.count ?? 0),
    latestId: latest?.latestId != null ? Number(latest.latestId) : null,
  };
}

export interface AuditEventPayload {
  id: number;
  resource: string | null;
  cooperativeId: string | null;
  actorUserId: string | null;
}

/**
 * Decide whether a NOTIFY payload should be forwarded to the given
 * subscriber. Same predicate as `getUnreadCount` minus the `since`
 * cursor — applied per event in the SSE stream.
 */
export function eventMatchesSubscriber(
  ev: AuditEventPayload,
  s: {
    userId: string;
    isAllCooperative: boolean;
    resources: Set<string>;
    /** Coop ids the user is assigned to. Empty for org-wide users. */
    coopIds: Set<string>;
    /** Active-coop cookie scope at SSE-connect time. Null = no scope. */
    activeCoopId: string | null;
  },
): boolean {
  // No self-action filter — every audit row reaches every authorized
  // subscriber, including the user who issued it. Gives live
  // "I just did this" confirmation across the user's open tabs.
  // Resource gate.
  if (!ev.resource || !s.resources.has(ev.resource)) return false;
  // Org-wide events (no `cooperative_id` — role / permission / user
  // edits) always reach everyone with `:notification` for that
  // resource, even when the viewer has an active coop selected.
  if (ev.cooperativeId === null) return true;
  // Active-coop scope wins for coop-tied events.
  if (s.activeCoopId) {
    return ev.cooperativeId === s.activeCoopId;
  }
  // Org-wide users see every coop.
  if (s.isAllCooperative) return true;
  // District-scoped users only see their assigned coops.
  return s.coopIds.has(ev.cooperativeId);
}

// ── Read cursor (server-side) ────────────────────────────────────
// One row per user in `iam.user_notification_reads`. The bell POSTs the
// highest id it has shown; the badge count reads it back. Lives on the
// account so a new browser/device doesn't resurrect old notifications.

/** Highest audit id the user has marked read. 0 when never marked. */
export async function getReadCursor(userId: string): Promise<number> {
  const [row] = await db
    .select({ id: userNotificationReads.lastReadAuditId })
    .from(userNotificationReads)
    .where(eq(userNotificationReads.userId, userId))
    .limit(1);
  return row?.id != null ? Number(row.id) : 0;
}

/** Advance the cursor. Monotonic — an older id never rolls it back. */
export async function setReadCursor(userId: string, auditId: number): Promise<number> {
  const [row] = await db
    .insert(userNotificationReads)
    .values({ userId, lastReadAuditId: auditId })
    .onConflictDoUpdate({
      target: userNotificationReads.userId,
      set: {
        lastReadAuditId: dsql`GREATEST(${userNotificationReads.lastReadAuditId}, ${auditId})`,
        updatedAt: dsql`now()`,
      },
    })
    .returning({ id: userNotificationReads.lastReadAuditId });
  return row?.id != null ? Number(row.id) : auditId;
}
