/**
 * Idempotent IAM baseline — matches the KuanaData product spec.
 *
 * Roles (6):
 *   field_officer      — primary field data collection. Scope: own district.
 *   ims_manager        — data cleaning/validation, all modules. Scope: own district.
 *   project_leader     — operational oversight, final RA validator. Scope: all districts.
 *   system_admin       — user mgmt, system config. Scope: all districts.
 *   buyer              — Buyer view-only. Scope: all districts.
 *   cooperative_chair  — Co-op President view-only. Scope: own district.
 *
 * Scope (own-district vs all-districts) is NOT encoded in the role
 * itself — it's enforced at the API layer using
 * `iam.user_cooperative_assignments.assignment_scope` AND mirrored on
 * `users.is_all_cooperative` for fast org-wide checks. This seed
 * keeps the flag in lock-step with the role taxonomy at the end —
 * see `syncIsAllCooperativeFlag()`.
 *
 * Permission catalog lives in `@kuanadata/shared` (FE + BE share
 * the union); obsolete-data cleanup lives in `cleanup.ts`. This
 * module is responsible for: permissions upsert, role upsert,
 * role_permissions rebuild, and the org-wide flag sync.
 */

import { ORG_WIDE_ROLE_CODES, PERMISSION_CATALOG, type PermissionCode } from '@kuanadata/shared';
import { sql as dsql, inArray } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { permissions, rolePermissions, roles } from '../../src/db/schema/index';

export const ROLE_ROWS = [
  {
    code: 'field_officer',
    name: 'Field Officer',
    description: 'Field data collector.',
  },
  {
    code: 'ims_manager',
    name: 'IMS Manager',
    description: 'Data steward and trainer.',
  },
  {
    code: 'project_leader',
    name: 'Project Leader',
    description: 'Ops oversight and RA certification sign-off.',
  },
  {
    code: 'system_admin',
    name: 'System Administrator',
    description: 'User, role, and system configuration.',
  },
  {
    code: 'buyer',
    name: 'Buyer',
    description: 'External read-only observer.',
  },
  {
    code: 'cooperative_chair',
    name: 'Cooperative Chair',
    description: 'Cooperative chair — read-only access.',
  },
] as const;

type RoleCode = (typeof ROLE_ROWS)[number]['code'];

export const ROLE_GRANTS: Record<RoleCode, readonly PermissionCode[]> = {
  // `:notification` perm is the gate for receiving notifications about
  // a given resource — granted alongside `:history` so users who can
  // audit a resource also get its notification stream. Loss of the
  // perm immediately stops the SSE stream from forwarding events.

  field_officer: [
    // Dashboard is the landing page — every canonical role gets it so
    // they have a valid home. Revoking it per-role sends that role to
    // the 403 page on `/`.
    'dashboard:read',
    'dashboard:notification',
    'farmer:read',
    'farmer:create',
    'farmer:update',
    'farmer:import',
    'farmer:notification',
    'parcel:read',
    'parcel:create',
    'parcel:update',
    'parcel:import',
    'parcel:notification',
    'inspection:read',
    'inspection:create',
    'inspection:update',
    'inspection:notification',
    'training:read',
    'training:create',
    'training:update',
    'training:notification',
    // CLMRS read only — field officers surface child-labour flags on
    // household/farm visits, so they see the register for their district;
    // opening/updating remediation cases stays with IMS/admin.
    'clmrs:read',
  ],

  ims_manager: [
    'dashboard:read',
    'dashboard:notification',
    'farmer:read',
    'farmer:create',
    'farmer:update',
    'farmer:delete',
    'farmer:import',
    'farmer:notification',
    'parcel:read',
    'parcel:create',
    'parcel:update',
    'parcel:delete',
    'parcel:import',
    'parcel:notification',
    'inspection:read',
    'inspection:create',
    'inspection:update',
    'inspection:delete',
    'inspection:notification',
    'training:read',
    'training:create',
    'training:update',
    'training:delete',
    'training:notification',
    'coaching:read',
    'coaching:create',
    'coaching:update',
    'coaching:delete',
    'coaching:notification',
    'clmrs:read',
    'clmrs:create',
    'clmrs:update',
    'purchase:read',
    'purchase:create',
    'purchase:update',
    'purchase:delete',
    'purchase:notification',
    'primary_evac:read',
    'primary_evac:create',
    'primary_evac:update',
    'primary_evac:delete',
    'primary_evac:notification',
    'secondary_evac:read',
    'secondary_evac:create',
    'secondary_evac:update',
    'secondary_evac:delete',
    'secondary_evac:notification',
    'report:read',
    'report:export',
    // Sync capability is centralised on the `sync` resource now
    // (per-resource `<resource>:sync` was retired). ims_manager owns
    // data ingestion so they get the full trio. system_admin auto-gets
    // via the catalog map below.
    'sync:run',
    'sync:run_all',
    'sync:config',
  ],

  project_leader: [
    'dashboard:read',
    'dashboard:notification',
    'farmer:read',
    'farmer:notification',
    'parcel:read',
    'parcel:notification',
    'inspection:read',
    'inspection:update',
    'inspection:notification',
    'training:read',
    'training:notification',
    // CLMRS read for oversight of child-labour compliance across districts.
    'clmrs:read',
    'report:read',
    'report:export',
    // No `cooperative:read` — header CoopSwitcher reads its options
    // from `/api/users/me.accessibleCooperatives` (resolved BE-side).
  ],

  // System admin = full access. Pulls every code from the catalog so
  // any future permission added to PERMISSION_CATALOG is granted to
  // this role automatically — no risk of the seed drifting behind
  // the catalog.
  system_admin: PERMISSION_CATALOG.map((p) => p.code),

  buyer: [
    // View-only across all districts. Notification stream mirrors the
    // read scope so the external observer can see live activity but
    // not interact.
    'dashboard:read',
    'dashboard:notification',
    'report:read',
    'report:export',
    'farmer:read',
    'farmer:notification',
    'parcel:read',
    'parcel:notification',
    'inspection:read',
    'inspection:notification',
    'training:read',
    'training:notification',
  ],

  cooperative_chair: [
    // View-only, scoped to own district at API layer. Notification
    // view is granted on every business resource so the chair can
    // audit changes their staff (field officers, IMS managers) made.
    'dashboard:read',
    'dashboard:notification',
    'report:read',
    'report:export',
    'farmer:read',
    'farmer:notification',
    'parcel:read',
    'parcel:notification',
    'inspection:read',
    'inspection:notification',
    'training:read',
    'training:notification',
    // CLMRS read — the chair oversees child-labour compliance in their own
    // cooperative (view-only, like every other resource on this role).
    'clmrs:read',
  ],
};

const CANONICAL_ROLE_CODES = ROLE_ROWS.map((r) => r.code);

export async function seedIam(db: Db): Promise<void> {
  console.log('  iam: upserting permissions...');
  for (const p of PERMISSION_CATALOG) {
    await db
      .insert(permissions)
      .values(p)
      .onConflictDoUpdate({
        target: permissions.code,
        set: { name: p.name, description: p.description },
      });
  }

  console.log('  iam: upserting canonical roles...');
  for (const r of ROLE_ROWS) {
    await db
      .insert(roles)
      .values(r)
      .onConflictDoUpdate({
        target: roles.code,
        set: { name: r.name, description: r.description },
      });
  }

  console.log('  iam: rebuilding role_permissions...');
  const allRoles = await db.select().from(roles);
  const allPerms = await db.select().from(permissions);
  const roleByCode = new Map(allRoles.map((r) => [r.code, r]));
  const permByCode = new Map(allPerms.map((p) => [p.code, p]));

  const canonicalRoleIds = CANONICAL_ROLE_CODES.map((c) => roleByCode.get(c)!.id);
  await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, canonicalRoleIds));

  for (const role of ROLE_ROWS) {
    const roleId = roleByCode.get(role.code)!.id;
    const permCodes = ROLE_GRANTS[role.code];
    const rows = permCodes.map((code) => {
      const p = permByCode.get(code);
      if (!p) {
        throw new Error(`Unknown permission '${code}' referenced by role '${role.code}'`);
      }
      return { roleId, permissionId: p.id };
    });
    if (rows.length > 0) await db.insert(rolePermissions).values(rows);
  }

  await syncIsAllCooperativeFlag(db);
  console.log('  iam: done.');
}

/**
 * Mirror the org-wide role taxonomy onto `users.is_all_cooperative`.
 * Single SQL UPDATE keyed off `iam.user_roles ⋈ iam.roles` membership
 * — every user's flag is derived from "do they hold ANY org-wide
 * role". Idempotent (running twice produces the same flag values),
 * cheap (one round-trip).
 *
 * Centralised here so callers that mutate role assignments (test-user
 * seed, admin role-assign endpoint) don't each have to maintain the
 * flag separately. Run after `role_permissions` rebuild so the new
 * membership is reflected immediately.
 */
async function syncIsAllCooperativeFlag(db: Db): Promise<void> {
  console.log('  iam: syncing is_all_cooperative flag...');
  const codes = ORG_WIDE_ROLE_CODES.map((c) => `'${c}'`).join(',');
  await db.execute(
    dsql.raw(`
    UPDATE iam.users u
       SET is_all_cooperative = EXISTS (
         SELECT 1
           FROM iam.user_roles ur
          INNER JOIN iam.roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id
            AND r.code IN (${codes})
       )
     WHERE u.deleted_at IS NULL
  `),
  );
}
