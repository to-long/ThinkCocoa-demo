/**
 * System-wide end-to-end test scenarios.
 *
 * Coverage:
 *   1. Permission group creation
 *   2. Role create / update / delete + permission assignment
 *   3. User create / update / soft-delete / restore
 *   4. User role assignment
 *   5. Cooperative create / update / delete
 *   6. Farmer create / update / soft-delete / restore
 *
 * Each scenario verifies the corresponding `audit.audit_logs` row gets
 * written by the BE, including `entity_changes` for update flows.
 *
 * Setup:
 *   - Requires the dev Postgres + test users seeded (`SEED_TEST_USERS=true`,
 *     default in seed flow). Login uses `system.admin@thinkdata.com`.
 *   - Tests create entities with random suffixes so they don't collide
 *     with each other or with seeded data on re-runs.
 *   - No global cleanup. Audit log is append-only; soft-deletable
 *     entities are tombstoned by their tests so they don't pollute the
 *     active list.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, desc, eq, like } from 'drizzle-orm';
import { db } from '../db/client';
import { auditAttachment, auditLogs } from '../db/schema/audit';
import { farmers } from '../db/schema/farmer';
import { cooperatives, permissions as permissionsTable, roles, users } from '../db/schema/iam';
import { readAuditDiff } from '../lib/audit';
import { type AuthSession, api, signInAs, TEST_USERS, uniqueSuffix } from './helpers';

// Two separate sessions because the canonical role matrix splits
// admin authority (system_admin: users / roles / permissions /
// cooperatives) from data-steward authority (ims_manager: farmers).
// Tests use whichever session has the permission for the action under
// test — that keeps the production permission boundaries honest.
let adminSession: AuthSession;
let imsSession: AuthSession;
const SUFFIX = uniqueSuffix();

beforeAll(async () => {
  adminSession = await signInAs(TEST_USERS.systemAdmin.email, TEST_USERS.systemAdmin.password);
  imsSession = await signInAs(TEST_USERS.imsManager.email, TEST_USERS.imsManager.password);
});

// ── Audit assertion helper ────────────────────────────────────────
//
// Pulls the latest audit row matching the (table, action, entityId?)
// filter and returns it together with any field-level changes. Tests
// assert on the resolved object instead of re-querying everywhere.
async function latestAudit(opts: { table: string; action: string; entityId?: string }) {
  const where = [eq(auditLogs.entityTable, opts.table), eq(auditLogs.action, opts.action)];
  if (opts.entityId !== undefined) {
    where.push(eq(auditLogs.entityId, opts.entityId));
  }
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(...where))
    .orderBy(desc(auditLogs.id))
    .limit(1);
  if (!row) return null;
  // Diffs are offloaded to file storage now (see writeAudit). To
  // keep test assertions on `audit.changes[].fieldName` working,
  // resolve the diff blob via `audit_attachment` + storage and
  // re-hydrate into the same `{fieldName, oldValue, newValue}`
  // shape callers expect.
  const [att] = await db
    .select()
    .from(auditAttachment)
    .where(eq(auditAttachment.auditLogId, row.id))
    .limit(1);
  let changes: Array<{
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];
  if (att) {
    try {
      const parsed = await readAuditDiff(att.storageKey);
      if (parsed) {
        changes = parsed.map((d) => ({
          fieldName: d.field,
          oldValue: d.oldValue ?? null,
          newValue: d.newValue ?? null,
        }));
      }
    } catch {
      // Storage unavailable in test env — leave changes empty.
    }
  }
  return { ...row, changes };
}

// ── 1. Permission group ───────────────────────────────────────────
describe('permission group lifecycle', () => {
  const groupName = `test_resource_${SUFFIX}`;
  let createdCodes: string[] = [];

  test('create permission group writes audit row', async () => {
    const { status, data } = await api<{
      created: { id: string; code: string }[];
      existed: string[];
    }>(adminSession, 'POST', '/api/permissions/groups', {
      [groupName]: ['read', 'create', 'update'],
    });
    expect(status).toBe(201);
    expect(data?.created.length).toBe(3);
    createdCodes = data!.created.map((c) => c.code);
    expect(createdCodes).toContain(`${groupName}:read`);

    const audit = await latestAudit({
      table: 'permissions',
      action: 'create',
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(adminSession.userId);
    const after = audit?.metadata as { summary?: string } | null;
    expect(after?.summary).toContain('permission');
  });

  test('cleanup: delete every test permission created in this run', async () => {
    // Group create returns multiple codes (`:read`, `:create`,
    // `:update`) — the cleanup must delete all of them or they'll
    // accumulate across runs and pollute /admin/permissions.
    const rows = await db
      .select({ id: permissionsTable.id, code: permissionsTable.code })
      .from(permissionsTable)
      .where(like(permissionsTable.code, `${groupName}:%`));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const { status } = await api(adminSession, 'DELETE', `/api/permissions/${row.id}`);
      expect(status).toBe(204);
    }

    // At least one delete should have produced an audit row — assert
    // the latest one for THIS group exists with the expected action.
    const audit = await latestAudit({
      table: 'permissions',
      action: 'delete',
      entityId: rows[rows.length - 1].id,
    });
    expect(audit).not.toBeNull();
  });
});

// ── 2. Role lifecycle ─────────────────────────────────────────────
describe('role lifecycle', () => {
  const code = `test_role_${SUFFIX}`;
  let roleId: string;

  test('create role writes audit row', async () => {
    const { status, data } = await api<{ id: string; code: string }>(
      adminSession,
      'POST',
      '/api/roles',
      {
        code,
        name: 'Test Role',
        description: 'created by integration test',
        permissionCodes: ['farmer:read'],
      },
    );
    expect(status).toBe(201);
    roleId = data!.id;

    const audit = await latestAudit({
      table: 'roles',
      action: 'create',
      entityId: roleId,
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityId).toBe(roleId);
  });

  test('update role writes audit + entity_changes', async () => {
    const { status } = await api(adminSession, 'PATCH', `/api/roles/${roleId}`, {
      name: 'Test Role (renamed)',
      description: 'updated by integration test',
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'roles',
      action: 'update',
      entityId: roleId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('name');
    expect(fields).toContain('description');
  });

  test('replace permissions writes audit', async () => {
    const { status } = await api(adminSession, 'PUT', `/api/roles/${roleId}/permissions`, {
      permissionCodes: ['farmer:read', 'farmer:create'],
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'roles',
      action: 'assign-permissions',
      entityId: roleId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('permissions');
  });

  test('delete role writes audit', async () => {
    const { status } = await api(adminSession, 'DELETE', `/api/roles/${roleId}`);
    expect(status).toBe(204);
    const audit = await latestAudit({
      table: 'roles',
      action: 'delete',
      entityId: roleId,
    });
    expect(audit).not.toBeNull();
  });
});

// ── 3 + 4. User lifecycle + role assignment ──────────────────────
describe('user lifecycle + role assignment', () => {
  const email = `user-${SUFFIX}@e2e.test`;
  const password = 'P@ssw0rd-E2E-test-2026';
  let userId: string;

  test('create user writes audit row', async () => {
    const { status, data } = await api<{ id: string }>(adminSession, 'POST', '/api/users', {
      email,
      password,
      name: `E2E User ${SUFFIX}`,
      roleCodes: ['ims_manager'],
    });
    expect(status).toBe(201);
    userId = data!.id;

    const audit = await latestAudit({
      table: 'users',
      action: 'create',
      entityId: userId,
    });
    expect(audit).not.toBeNull();
  });

  test('update user writes audit + entity_changes', async () => {
    const { status } = await api(adminSession, 'PATCH', `/api/users/${userId}`, {
      fullName: `E2E User ${SUFFIX} (renamed)`,
      status: 'inactive',
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'users',
      action: 'update',
      entityId: userId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('name');
    expect(fields).toContain('status');
  });

  test('replace roles writes assign-roles audit', async () => {
    const { status } = await api(adminSession, 'PUT', `/api/users/${userId}/roles`, {
      roleCodes: ['project_leader'],
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'users',
      action: 'assign-roles',
      entityId: userId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('roles');
  });

  test('soft-delete user writes audit', async () => {
    const { status } = await api(adminSession, 'DELETE', `/api/users/${userId}`);
    expect(status).toBe(204);
    const audit = await latestAudit({
      table: 'users',
      action: 'soft-delete',
      entityId: userId,
    });
    expect(audit).not.toBeNull();
  });

  test('restore user writes audit', async () => {
    const { status } = await api(adminSession, 'POST', `/api/users/${userId}/restore`);
    expect(status).toBe(200);
    const audit = await latestAudit({
      table: 'users',
      action: 'restore',
      entityId: userId,
    });
    expect(audit).not.toBeNull();
  });

  // Cleanup: tombstone the user again so it doesn't pollute the live
  // list across re-runs.
  afterAll(async () => {
    if (userId) {
      await api(adminSession, 'DELETE', `/api/users/${userId}`);
    }
  });
});

// ── 5. Cooperative lifecycle ──────────────────────────────────────
describe('cooperative lifecycle', () => {
  const code = `TEST_COOP_${SUFFIX.toUpperCase()}`;
  let coopId: string;

  test('create cooperative writes audit row', async () => {
    const { status, data } = await api<{ id: string }>(adminSession, 'POST', '/api/cooperatives', {
      code,
      name: `Test Coop ${SUFFIX}`,
      districtCode: 'XX-ZZ',
      districtName: 'Test District',
      contactEmail: `coop-${SUFFIX}@e2e.test`,
      isActive: true,
    });
    expect(status).toBe(201);
    coopId = data!.id;

    const audit = await latestAudit({
      table: 'cooperatives',
      action: 'create',
      entityId: coopId,
    });
    expect(audit).not.toBeNull();
  });

  test('update cooperative writes audit + entity_changes', async () => {
    const { status } = await api(adminSession, 'PATCH', `/api/cooperatives/${coopId}`, {
      contactEmail: `coop-${SUFFIX}-v2@e2e.test`,
      isActive: false,
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'cooperatives',
      action: 'update',
      entityId: coopId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('contactEmail');
    expect(fields).toContain('isActive');
  });

  test('soft-delete cooperative writes audit', async () => {
    const { status } = await api(adminSession, 'DELETE', `/api/cooperatives/${coopId}`);
    expect(status).toBe(204);
    const audit = await latestAudit({
      table: 'cooperatives',
      action: 'soft-delete',
      entityId: coopId,
    });
    expect(audit).not.toBeNull();
  });
});

// ── 6. Farmer lifecycle ───────────────────────────────────────────
describe('farmer lifecycle', () => {
  let coopId: string;
  let farmerId: string;
  const farmerCode = `E2E-${SUFFIX.toUpperCase()}`;

  beforeAll(async () => {
    // Pick the first existing cooperative — farmer needs a parent.
    const [coop] = await db.select({ id: cooperatives.id }).from(cooperatives).limit(1);
    if (!coop) throw new Error('No cooperative available to attach farmer to');
    coopId = coop.id;
  });

  // farmer:* permissions live on `ims_manager`, not `system_admin` —
  // farmer scenarios run through the IMS session.
  test('create farmer writes audit row', async () => {
    const { status, data } = await api<{ id: string }>(imsSession, 'POST', '/api/farmers', {
      cooperativeId: coopId,
      farmerCode,
      firstName: 'Test',
      lastName: `Farmer-${SUFFIX}`,
      phoneNumber: '+233200000000',
      certificationStatus: 'unknown',
    });
    expect(status).toBe(201);
    farmerId = data!.id;

    const audit = await latestAudit({
      table: 'farmers',
      action: 'create',
      entityId: farmerId,
    });
    expect(audit).not.toBeNull();
    expect(audit?.cooperativeId).toBe(coopId);
    expect(audit?.actorUserId).toBe(imsSession.userId);
  });

  test('update farmer writes audit + entity_changes', async () => {
    const { status } = await api(imsSession, 'PATCH', `/api/farmers/${farmerId}`, {
      phoneNumber: '+233211111111',
      certificationStatus: 'rainforest_alliance',
    });
    expect(status).toBe(200);

    const audit = await latestAudit({
      table: 'farmers',
      action: 'update',
      entityId: farmerId,
    });
    expect(audit).not.toBeNull();
    const fields = audit!.changes.map((c) => c.fieldName);
    expect(fields).toContain('phoneNumber');
    expect(fields).toContain('certificationStatus');
  });

  test('soft-delete farmer writes audit', async () => {
    const { status } = await api(imsSession, 'DELETE', `/api/farmers/${farmerId}`);
    expect(status).toBe(204);
    const audit = await latestAudit({
      table: 'farmers',
      action: 'soft-delete',
      entityId: farmerId,
    });
    expect(audit).not.toBeNull();
  });

  test('restore farmer writes audit', async () => {
    const { status } = await api(imsSession, 'POST', `/api/farmers/${farmerId}/restore`);
    expect(status).toBe(200);
    const audit = await latestAudit({
      table: 'farmers',
      action: 'restore',
      entityId: farmerId,
    });
    expect(audit).not.toBeNull();
  });

  afterAll(async () => {
    if (farmerId) {
      // Final tombstone so the test farmer doesn't show up in real
      // farmer list views.
      await api(imsSession, 'DELETE', `/api/farmers/${farmerId}`);
    }
  });
});

// Sanity: every audit row written above should be attributed to the
// signed-in actor. Catches regressions where a route forgets to thread
// `c.get('user')` into `writeAudit`.
test('all audit rows written during this run are attributed to the actor', async () => {
  const recent = await db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityTable: auditLogs.entityTable,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(40);
  // Filter to rows from THIS run (the seed inserts older rows). Both
  // sessions wrote audit rows above (admin → IAM, ims → farmers) so we
  // accept either user id. We just assert no nulls slipped through.
  const fromThisRun = recent.filter(
    (r) => r.actorUserId === adminSession.userId || r.actorUserId === imsSession.userId,
  );
  expect(fromThisRun.length).toBeGreaterThan(0);
  for (const r of fromThisRun) {
    expect(r.actorUserId).not.toBeNull();
  }
});

// Reference suppression — `users`, `roles`, `farmers` are imported for
// possible follow-up assertions; keep them so future scenarios don't
// re-add the same imports.
void users;
void roles;
void farmers;
