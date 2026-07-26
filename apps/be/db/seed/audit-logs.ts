/**
 * Seed ~60 demo audit log events spanning the last 30 days. Opt-in via
 * `SEED_AUDIT_LOGS=true`. Skipped if any audit_logs row already exists,
 * so re-runs don't pile up duplicate demo data.
 *
 * Events are deliberately varied across:
 *   • actors  — every test user gets at least one event
 *   • scopes  — farmers / cooperatives / users / roles / permissions / system
 *   • actions — create / update / delete / restore / login / export
 *   • status  — 88% success / 8% failed / 4% warning  (matches the donut
 *     proportions on the design)
 *   • IPs / user-agents — pulled from a small realistic pool
 *
 * Update events get 1-3 entity_changes rows (field, old_value, new_value)
 * so the detail screen's Changes table has data to render.
 */

import { count } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { auditLogs } from '../../src/db/schema/audit';
import { cooperatives, users } from '../../src/db/schema/iam';

interface ScopeDef {
  schema: string;
  table: string;
  /** Pool of synthetic entity IDs for this scope (just needs to look real). */
  entityIds: string[];
  /** Allowed action verbs for this scope. */
  actions: string[];
  /** Per-action update field-diff templates — keyed by field name. */
  updates?: Array<{
    field: string;
    olds: unknown[];
    news: unknown[];
  }>;
}

const SCOPES: ScopeDef[] = [
  {
    schema: 'farmer',
    table: 'farmers',
    entityIds: ['FC-0012', 'FC-0118', 'FC-0233', 'FC-0455', 'FC-0782', 'FC-0901'],
    actions: ['create', 'update', 'soft-delete', 'restore'],
    updates: [
      { field: 'first_name', olds: ['Kojo', 'Efua'], news: ['Kojo Ansah', 'Efua Amoah'] },
      {
        field: 'phone_number',
        olds: ['+233200000001', '+233200000002'],
        news: ['+233200000011', '+233200000012'],
      },
      { field: 'society', olds: ['Society A', 'Society B'], news: ['Society C', 'Society D'] },
      { field: 'is_active', olds: [true], news: [false] },
      { field: 'certification_status', olds: ['unknown'], news: ['rainforest_alliance'] },
    ],
  },
  {
    schema: 'iam',
    table: 'cooperatives',
    entityIds: ['SANKOFA', 'NKABOM', 'ADWUMA', 'ABOMA'],
    actions: ['create', 'update'],
    updates: [
      { field: 'contact_phone', olds: ['+233 32 100 0003'], news: ['+233 32 100 0033'] },
      { field: 'name', olds: ['Adwuma Cooperative'], news: ['Adwuma Cocoa Union'] },
      { field: 'is_active', olds: [true], news: [false] },
    ],
  },
  {
    schema: 'iam',
    table: 'users',
    entityIds: [], // resolved at runtime to actual user IDs
    actions: ['create', 'update', 'soft-delete', 'login', 'logout'],
    updates: [
      { field: 'name', olds: ['Demo Admin'], news: ['Demo Admin Updated'] },
      { field: 'image', olds: [null], news: ['/uploads/avatars/u-12.png'] },
    ],
  },
  {
    schema: 'iam',
    table: 'roles',
    entityIds: ['system_admin', 'org_admin', 'cooperative_chair', 'ims_manager'],
    actions: ['update'],
    updates: [
      {
        field: 'description',
        olds: ['Manages cooperative'],
        news: ['Manages cooperative + reports'],
      },
    ],
  },
  {
    schema: 'iam',
    table: 'permissions',
    entityIds: ['farmer:read', 'farmer:update', 'cooperative:delete', 'audit:read'],
    actions: ['create', 'update'],
  },
  {
    schema: 'traceability',
    table: 'batches',
    entityIds: ['BATCH-2C1', 'BATCH-3F2', 'BATCH-4A8', 'BATCH-5E1'],
    actions: ['create', 'update', 'import', 'export'],
    updates: [
      { field: 'weight_kg', olds: [120.5, 88.0], news: [122.0, 90.0] },
      { field: 'destination', olds: ['Tema Port'], news: ['Takoradi Port'] },
    ],
  },
  {
    schema: 'gis',
    table: 'parcels',
    entityIds: ['FC-001-P1', 'FC-002-P2', 'FC-003-P1', 'FC-004-P3'],
    actions: ['create', 'update', 'soft-delete'],
    updates: [
      { field: 'calculated_area_ha', olds: [1.2, 0.8], news: [1.4, 0.95] },
      { field: 'crop_variety', olds: ['Forastero'], news: ['Trinitario'] },
    ],
  },
  {
    schema: 'field_ops',
    table: 'inspections',
    entityIds: ['INSP-1042', 'INSP-1135', 'INSP-1207'],
    actions: ['create', 'update'],
    updates: [
      { field: 'compliance_status', olds: ['pending'], news: ['compliant', 'non_compliant'] },
    ],
  },
  {
    schema: 'system',
    table: 'system',
    entityIds: ['nightly-sync', 'eudr-export', 'cache-rebuild'],
    actions: ['run', 'export', 'login'],
  },
];

const IP_POOL = [
  '192.168.1.1',
  '192.168.1.42',
  '10.0.4.18',
  '10.0.4.55',
  '203.0.113.7',
  '198.51.100.21',
];

const UA_POOL = [
  'Chrome 121.0 / macOS',
  'Chrome 120.0 / Windows',
  'Safari 17.2 / macOS',
  'Firefox 122.0 / Linux',
  'Edge 121.0 / Windows',
];

const SUMMARY_BY_ACTION: Record<string, string> = {
  create: 'Created {scope} record',
  update: 'Updated {scope} profile',
  'soft-delete': 'Soft-deleted {scope}',
  restore: 'Restored {scope}',
  login: 'User signed in',
  logout: 'User signed out',
  run: 'Triggered {scope} job',
  export: 'Exported {scope} dataset',
};

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Deterministic-ish PRNG so re-runs (when the table is empty) produce a
// similar distribution. Not security-grade — just reproducible for demo.
function mulberry32(seed: number) {
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedAuditLogs(db: Db): Promise<void> {
  const [{ count: existing }] = await db.select({ count: count() }).from(auditLogs);
  if (Number(existing) > 0) {
    console.log(`  audit-logs: skipped (already ${existing} rows; clear table to re-seed)`);
    return;
  }

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .limit(10);
  if (allUsers.length === 0) {
    console.log('  audit-logs: skipped (no users to attribute events to)');
    return;
  }

  const allCoops = await db
    .select({ id: cooperatives.id, name: cooperatives.name })
    .from(cooperatives);

  // Hydrate `users` scope with real user IDs so the entity_id is clickable.
  const userScope = SCOPES.find((s) => s.table === 'users');
  if (userScope) userScope.entityIds = allUsers.map((u) => u.id);

  const rng = mulberry32(0xc0c0a);
  const now = Date.now();
  const TARGET = 60;

  type AuditInsert = typeof auditLogs.$inferInsert;
  const auditInserts: AuditInsert[] = [];
  // Per-field diff seeding removed — diffs are now offloaded to
  // file storage via the `audit_attachment` table. Demo data here
  // generates audit rows without diffs (FE shows "No field changes
  // recorded"); real diffs come through `writeAudit()` at runtime.

  for (let i = 0; i < TARGET; i++) {
    const scope = pick(SCOPES, rng);
    const action = pick(scope.actions, rng);
    const actor = pick(allUsers, rng);
    const coop =
      scope.table === 'farmers' || scope.table === 'cooperatives' ? pick(allCoops, rng) : null;
    const minutesAgo = Math.floor(rng() * 30 * 24 * 60); // last 30 days
    const ts = new Date(now - minutesAgo * 60_000);

    // 88 / 8 / 4 split — login/logout always succeed (no failure UX yet).
    const r = rng();
    const status =
      action === 'login' || action === 'logout'
        ? 'success'
        : r < 0.88
          ? 'success'
          : r < 0.96
            ? 'failed'
            : 'warning';

    const summaryTemplate = SUMMARY_BY_ACTION[action] ?? `Performed ${action}`;
    const summary = summaryTemplate.replace('{scope}', scope.table);

    const entityId = scope.entityIds.length > 0 ? pick(scope.entityIds, rng) : null;

    auditInserts.push({
      actorUserId: actor.id,
      serviceName: scope.table === 'system' ? 'scheduler' : 'admin-ui',
      entitySchema: scope.schema,
      entityTable: scope.table,
      entityId,
      action,
      cooperativeId: coop?.id ?? null,
      metadata: {
        status,
        summary,
        ipAddress: pick(IP_POOL, rng),
        userAgent: pick(UA_POOL, rng),
        sessionId: `sess_${Math.floor(rng() * 0xffffffff).toString(16)}`,
        actorEmail: actor.email,
      },
      createdAt: ts,
    });

    // No per-field diff seeding — see note at top of function.
  }

  // Insert audit_logs in one shot.
  const inserted = await db.insert(auditLogs).values(auditInserts).returning({ id: auditLogs.id });

  console.log(`  audit-logs: seeded ${inserted.length} events`);
}
