/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Source of truth: `iam.permissions` table in the connected database.
 * Regenerate via `bun run sync:permissions` (in apps/be) or
 * `make sync-permissions` (repo root).
 *
 * The BE seed (`apps/be/db/seed/iam.ts`) reads this file to populate the
 * DB on fresh environments. Admins can then add new permissions via the
 * admin UI — re-running the sync script captures those additions back
 * into this file so the `PermissionCode` union stays compile-accurate.
 *
 * NAMING CONVENTIONS — keep in sync to avoid silently broken routing:
 *   - Permission codes use SINGULAR resource prefix: `farmer:`,
 *     `user:`, `role:`, `permission:` — matches the role / actor a
 *     code is granting authority on.
 *   - HTTP route paths use PLURAL: `/api/farmers`, `/api/users` —
 *     standard REST collection-noun convention.
 *   - Audit `entity_table` follows the DB table name (plural for
 *     business entities: `farmers`, `parcels`; multi-word for jobs:
 *     `sync_jobs`, `report_runs`, `eudr_assessments`).
 *
 * The mapping `entity_table → permission resource` lives in
 * `audit.resource_from_entity_table()` (SQL) plus the inline
 * `ENTITY_OVERRIDES` maps in `notifications/service.ts` and
 * `audit/routes.ts`. All three must agree.
 */

export interface PermissionDefinition {
  code: string;
  name: string;
  description: string | null;
}

// The tuple must stay `as const` so TypeScript infers literal types for
// every `code`, from which we derive the `PermissionCode` union below.
export const PERMISSION_CATALOG = [
  // ── coaching ──
  { code: 'coaching:create', name: 'Create', description: 'Record a new coaching visit' },
  { code: 'coaching:delete', name: 'Delete', description: 'Soft-delete a coaching visit' },
  {
    code: 'coaching:notification',
    name: 'Notification',
    description: 'Receive notifications for coaching events',
  },
  {
    code: 'coaching:read',
    name: 'Read',
    description: 'View coaching visits and farmer compliance scores',
  },
  { code: 'coaching:update', name: 'Update', description: 'Modify coaching visit data' },
  // ── cooperative ──
  // `read` is admin-only — gates `/admin/cooperatives` page + the
  // list/detail endpoints. The header CoopSwitcher pulls its options
  // from `/api/users/me.accessibleCooperatives` (resolved BE-side
  // from the user's assignments / org-wide flag), so non-admin roles
  // don't need `cooperative:read` to render the switcher.
  { code: 'cooperative:create', name: 'Create', description: 'Add a new cooperative' },
  { code: 'cooperative:delete', name: 'Delete', description: 'Remove a cooperative' },
  {
    code: 'cooperative:notification',
    name: 'Notification',
    description: 'Receive notifications for cooperative events',
  },
  {
    code: 'cooperative:read',
    name: 'Read',
    description: 'View cooperatives list / detail (admin)',
  },
  { code: 'cooperative:update', name: 'Update', description: 'Edit cooperative details' },
  // ── dashboard ──
  {
    code: 'dashboard:notification',
    name: 'Notification',
    description: 'Receive notifications surfaced on the dashboard',
  },
  {
    code: 'dashboard:read',
    name: 'Read',
    description: 'View the system-wide overview dashboard',
  },
  // ── farmer ──
  { code: 'farmer:create', name: 'Create', description: 'Register a new farmer' },
  { code: 'farmer:delete', name: 'Delete', description: 'Soft-delete a farmer' },
  { code: 'farmer:import', name: 'Import', description: 'Bulk-import farmers from a file' },
  {
    code: 'farmer:notification',
    name: 'Notification',
    description: 'Receive notifications for farmer events',
  },
  { code: 'farmer:read', name: 'Read', description: 'View farmer records and lists' },
  { code: 'farmer:update', name: 'Update', description: 'Modify farmer profile fields' },
  // ── inspection ──
  { code: 'inspection:create', name: 'Create', description: 'Record a new inspection' },
  { code: 'inspection:delete', name: 'Delete', description: 'Soft-delete an inspection' },
  {
    code: 'inspection:notification',
    name: 'Notification',
    description: 'Receive notifications for inspection events',
  },
  { code: 'inspection:read', name: 'Read', description: 'View inspections and findings' },
  { code: 'inspection:update', name: 'Update', description: 'Modify inspection data' },
  // ── parcel ──
  { code: 'parcel:create', name: 'Create', description: 'Add a parcel' },
  { code: 'parcel:delete', name: 'Delete', description: 'Soft-delete a parcel' },
  {
    code: 'parcel:import',
    name: 'Import',
    description: 'Run geo import jobs (GeoJSON/KML/Shapefile)',
  },
  {
    code: 'parcel:notification',
    name: 'Notification',
    description: 'Receive notifications for parcel events',
  },
  { code: 'parcel:read', name: 'Read', description: 'View parcel records and geometries' },
  { code: 'parcel:update', name: 'Update', description: 'Modify parcel fields or geometry' },
  // ── primary_evac ──
  {
    code: 'primary_evac:create',
    name: 'Create',
    description: 'Record a new primary evacuation lot',
  },
  {
    code: 'primary_evac:delete',
    name: 'Delete',
    description: 'Soft-delete a primary evacuation lot',
  },
  {
    code: 'primary_evac:notification',
    name: 'Notification',
    description: 'Receive notifications for primary evacuation events',
  },
  {
    code: 'primary_evac:read',
    name: 'Read',
    description: 'View primary evacuation lots and lot composition',
  },
  {
    code: 'primary_evac:update',
    name: 'Update',
    description: 'Modify primary evacuation lot data',
  },
  // ── secondary_evac ──
  {
    code: 'secondary_evac:create',
    name: 'Create',
    description: 'Record a new secondary evacuation lot',
  },
  {
    code: 'secondary_evac:delete',
    name: 'Delete',
    description: 'Soft-delete a secondary evacuation lot',
  },
  {
    code: 'secondary_evac:notification',
    name: 'Notification',
    description: 'Receive notifications for secondary evacuation events',
  },
  {
    code: 'secondary_evac:read',
    name: 'Read',
    description: 'View secondary evacuation (export) lots and lot composition',
  },
  {
    code: 'secondary_evac:update',
    name: 'Update',
    description: 'Modify secondary evacuation lot data',
  },
  // ── purchase ──
  { code: 'purchase:create', name: 'Create', description: 'Record a new cocoa purchase' },
  { code: 'purchase:delete', name: 'Delete', description: 'Soft-delete a cocoa purchase' },
  {
    code: 'purchase:notification',
    name: 'Notification',
    description: 'Receive notifications for purchase events',
  },
  {
    code: 'purchase:read',
    name: 'Read',
    description: 'View cocoa purchase transactions and society-level rollups',
  },
  { code: 'purchase:update', name: 'Update', description: 'Modify cocoa purchase data' },
  // ── permission ──
  {
    code: 'permission:create',
    name: 'Create',
    description: 'Add a new permission code (or batch-group)',
  },
  {
    code: 'permission:delete',
    name: 'Delete',
    description: 'Remove a permission code from the catalog',
  },
  {
    code: 'permission:notification',
    name: 'Notification',
    description: 'Receive notifications for permission events',
  },
  { code: 'permission:read', name: 'Read', description: 'View the permissions catalog' },
  {
    code: 'permission:update',
    name: 'Update',
    description: 'Edit a permission entry (name / description)',
  },
  // ── report ──
  { code: 'report:export', name: 'Export', description: 'Download generated report files' },
  { code: 'report:read', name: 'Read', description: 'View report runs and files' },
  // ── role ──
  { code: 'role:create', name: 'Create', description: 'Add a new role' },
  { code: 'role:delete', name: 'Delete', description: 'Remove a role' },
  {
    code: 'role:notification',
    name: 'Notification',
    description: 'Receive notifications for role events',
  },
  { code: 'role:read', name: 'Read', description: 'View roles list + detail' },
  {
    code: 'role:update',
    name: 'Update',
    description: 'Rename a role or edit its permission grants',
  },
  // ── sync ──
  { code: 'sync:config', name: 'Config', description: 'View + edit sync settings and job history' },
  {
    code: 'sync:reset',
    name: 'Reset data',
    description: 'Wipe all operational data and rebuild the baseline demo dataset',
  },
  { code: 'sync:run', name: 'Run', description: 'Trigger a single Kobo sync job' },
  { code: 'sync:run_all', name: 'Run all', description: 'Trigger every Kobo sync job at once' },
  // ── training ──
  { code: 'training:create', name: 'Create', description: 'Schedule a new training session' },
  { code: 'training:delete', name: 'Delete', description: 'Cancel / remove a training session' },
  {
    code: 'training:notification',
    name: 'Notification',
    description: 'Receive notifications for training events',
  },
  { code: 'training:read', name: 'Read', description: 'View training sessions and attendance' },
  { code: 'training:update', name: 'Update', description: 'Reschedule / edit a training session' },
  // ── user ──
  { code: 'user:create', name: 'Create', description: 'Invite / provision a new user' },
  { code: 'user:delete', name: 'Delete', description: 'Soft-delete / deactivate a user' },
  {
    code: 'user:notification',
    name: 'Notification',
    description: 'Receive notifications for user events',
  },
  { code: 'user:read', name: 'Read', description: 'View users list + detail' },
  {
    code: 'user:update',
    name: 'Update',
    description: 'Edit user profile, roles, cooperative assignments',
  },
  // ── vsla ──
  {
    code: 'vsla:notification',
    name: 'Notification',
    description: 'Receive notifications for VSLA events (e.g. discrepancy flagged)',
  },
  {
    code: 'vsla:read',
    name: 'Read',
    description: 'View VSLA groups and their monthly reports',
  },
] as const satisfies readonly PermissionDefinition[];

/**
 * Union of every permission code in the catalog. Use this as the argument
 * type for `requirePermission()` on the BE and `hasPermission()` on the
 * FE so typos become compile-time errors.
 */
export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];

/** Flat readonly tuple of permission codes (handy for `inArray` etc). */
export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CATALOG.map((p) => p.code);

/** Resource prefix → ordered list of codes. Used by the admin picker. */
export function permissionsByResource(): Record<string, readonly PermissionCode[]> {
  const out: Record<string, PermissionCode[]> = {};
  for (const p of PERMISSION_CATALOG) {
    const [resource] = p.code.split(':');
    if (!resource) continue;
    if (!out[resource]) {
      out[resource] = [];
    }
    out[resource].push(p.code);
  }
  return out;
}
