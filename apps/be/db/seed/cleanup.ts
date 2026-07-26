/**
 * Idempotent cleanup of legacy / obsolete rows.
 *
 * Runs FIRST in the seed pipeline so subsequent steps don't have to
 * worry about stale data shape. Three buckets:
 *   1. Legacy cooperatives — placeholder rows from earlier bootstrap.
 *   2. Obsolete role codes — old role taxonomy.
 *   3. Obsolete permission codes — pre-CRUD `:manage` super-actions
 *      and resources without a UI route.
 *
 * Anything in this file is a one-way migration: codes here have been
 * removed from `PERMISSION_CATALOG` / `ROLE_ROWS`. Adding a new entry
 * is the way to phase out a code without writing a SQL migration.
 *
 * All operations are safe to re-run on any DB shape (FK cascades or
 * pre-delete role_permissions) — never errors on a clean DB.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { cooperatives } from '../../src/db/schema/iam';
import { permissions, rolePermissions, roles } from '../../src/db/schema/index';

/** Legacy `cooperatives.code` values to purge. `user_cooperative_assignments`
 *  cascade-deletes; `users.default_cooperative_id` falls back to NULL. */
const LEGACY_COOPERATIVE_CODES = ['THINKCOCOA-HQ'] as const;

/** Earlier role naming iteration — drop so the canonical set is the
 *  only source of truth in `iam.roles`. */
const OBSOLETE_ROLE_CODES = [
  'platform_admin',
  'coop_admin',
  'coop_manager',
  'field_inspector',
  'auditor_readonly',
] as const;

/** Permission codes removed from `PERMISSION_CATALOG`. Includes the
 *  pre-CRUD `:manage` super-actions, resources with no UI route, and
 *  experimental codes from earlier iterations. */
const OBSOLETE_PERMISSION_CODES = [
  // Legacy `:manage` super-actions (pre-CRUD split).
  'training:manage',
  'coaching:manage',
  'batch:manage',
  'user:manage',
  // Batch + EUDR resources retired — no sidebar route, features never
  // shipped. Removed from `PERMISSION_CATALOG`; pruned here so the DB
  // drops the orphaned permission rows (their role_permissions links
  // cascade). Runs on every `db:migrate` (deploy included) via
  // `seedAll` → cleanup, so no standalone SQL migration is needed.
  'batch:read',
  'batch:create',
  'batch:update',
  'batch:delete',
  'batch:notification',
  'batch:sync',
  'eudr:read',
  'eudr:create',
  'eudr:update',
  'eudr:delete',
  'eudr:notification',
  'eudr:sync',
  // Sync model overhaul: per-resource `<resource>:sync` retired and the
  // old CRUD sync group (create/read/update/delete/notification)
  // replaced by run / run_all / config. Prune the dropped codes so the
  // DB matches the catalog (role_permissions cascade on delete).
  'sync:create',
  'sync:read',
  'sync:update',
  'sync:delete',
  'sync:notification',
  'coaching:sync',
  'cooperative:sync',
  'farmer:sync',
  'inspection:sync',
  'parcel:sync',
  'primary_evac:sync',
  'purchase:sync',
  'report:sync',
  'secondary_evac:sync',
  'training:sync',
  'vsla:sync',
  // Report trimmed to read + export — drop the run + notification verbs.
  'report:run',
  'report:notification',
  'role:manage',
  'cooperative:manage',
  'sync:manage',
  'reference:manage',
  // Short-lived `cooperative:config` — the CoopSwitcher reads its
  // options from `/me.accessibleCooperatives` now, so `cooperative:read`
  // can double as the admin gate again.
  'cooperative:config',
  // `system:configure` was the pre-CRUD verb; superseded by `system:[crud]`.
  'system:configure',
  // Resources with NO sidebar / UI route. (`dashboard:read` is NOT
  // here — the dashboard is now a gated route with its own permission
  // in `PERMISSION_CATALOG`.)
  'analytics:read',
  'data:approve',
  'reference:read',
  'reference:create',
  'reference:update',
  'reference:delete',
  'system:read',
  'system:create',
  'system:update',
  'system:delete',
  // Dev leftovers leaked in via the admin UI during testing.
  'test:read',
  'test:create',
  'test:update',
  'test:delete',
  'test:verify',
  // Audit perms — replaced by `:notification` suffix gating. The
  // /api/audit-logs endpoints are now scoped per-resource via the
  // caller's `:notification` permissions, so a separate audit perm
  // family no longer adds anything.
  'audit:read',
  'audit:notification',
  // `:history` family collapsed into `:notification`. Both used to
  // mean "see past events for this resource"; keeping a separate
  // perm per concept doubled the catalog and complicated grants
  // without any real product distinction. `:notification` now gates
  // both the bell stream AND the history page.
  'farmer:history',
  'parcel:history',
  'inspection:history',
  'training:history',
  'batch:history',
  'eudr:history',
  'cooperative:history',
  'user:history',
  'role:history',
  'permission:history',
  'sync:history',
  'report:history',
  // Briefly-introduced plural variants — rolled back per the
  // "routes plural, permissions singular" naming convention.
  // Listed so dev DBs that picked them up during the rename get
  // their orphaned rows pruned automatically on re-seed.
  'farmers:create',
  'farmers:read',
  'farmers:update',
  'farmers:delete',
  'farmers:history',
  'farmers:notification',
  'parcels:create',
  'parcels:read',
  'parcels:update',
  'parcels:delete',
  'parcels:import',
  'parcels:history',
  'parcels:notification',
  'inspections:create',
  'inspections:read',
  'inspections:update',
  'inspections:delete',
  'inspections:history',
  'inspections:notification',
  'trainings:create',
  'trainings:read',
  'trainings:update',
  'trainings:delete',
  'trainings:history',
  'trainings:notification',
  'batches:create',
  'batches:read',
  'batches:update',
  'batches:delete',
  'batches:history',
  'batches:notification',
  'cooperatives:create',
  'cooperatives:read',
  'cooperatives:update',
  'cooperatives:delete',
  'cooperatives:history',
  'cooperatives:notification',
  'users:create',
  'users:read',
  'users:update',
  'users:delete',
  'users:history',
  'users:notification',
  'roles:create',
  'roles:read',
  'roles:update',
  'roles:delete',
  'roles:history',
  'roles:notification',
  'permissions:create',
  'permissions:read',
  'permissions:update',
  'permissions:delete',
  'permissions:history',
  'permissions:notification',
  'syncs:create',
  'syncs:read',
  'syncs:update',
  'syncs:delete',
  'syncs:history',
  'syncs:notification',
  'reports:read',
  'reports:run',
  'reports:export',
  'reports:history',
  'reports:notification',
] as const;

export async function cleanupLegacy(db: Db): Promise<void> {
  console.log('  cleanup: pruning legacy + obsolete rows...');

  for (const code of LEGACY_COOPERATIVE_CODES) {
    const res = await db
      .delete(cooperatives)
      .where(eq(cooperatives.code, code))
      .returning({ code: cooperatives.code });
    if (res.length > 0) {
      console.log(`    removed legacy cooperative '${code}'`);
    }
  }

  // Obsolete roles: nuke role_permissions first (no FK cascade), then
  // the role rows themselves. Same shape as the permissions block below.
  const obsoleteRoles = await db
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(inArray(roles.code, [...OBSOLETE_ROLE_CODES]));
  if (obsoleteRoles.length > 0) {
    const ids = obsoleteRoles.map((r) => r.id);
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, ids));
    await db.delete(roles).where(inArray(roles.id, ids));
    console.log(
      `    dropped ${obsoleteRoles.length} obsolete role(s): ${obsoleteRoles.map((r) => r.code).join(', ')}`,
    );
  }

  const obsoletePerms = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, [...OBSOLETE_PERMISSION_CODES]));
  if (obsoletePerms.length > 0) {
    const ids = obsoletePerms.map((p) => p.id);
    await db.delete(rolePermissions).where(inArray(rolePermissions.permissionId, ids));
    await db.delete(permissions).where(inArray(permissions.id, ids));
    console.log(
      `    dropped ${obsoletePerms.length} obsolete permission(s): ${obsoletePerms.map((p) => p.code).join(', ')}`,
    );
  }

  console.log('  cleanup: done.');
}
