/**
 * IAM schema — ImpactCocoa's identity + access tables.
 *
 * This schema is also the home of the better-auth-managed tables:
 *   - iam.users          (better-auth "user"  model)
 *   - iam.sessions       (better-auth "session" model)
 *   - iam.accounts       (better-auth "account" model)
 *   - iam.verifications  (better-auth "verification" model, replaces password_reset_tokens)
 *
 * better-auth is wired through `drizzleAdapter` with `schema` pointing at this
 * file's exports and `usePlural: true` so it reads/writes `users` instead of
 * `user`. Domain-only fields on `users` (status, defaultCooperativeId, …) are
 * declared via `user.additionalFields` in `apps/be/src/auth.ts`.
 *
 * See docs (TBD) for the original "dual table" architecture before Option C.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './_types';

export const iamSchema = pgSchema('iam');

// ── Cooperatives ─────────────────────────────────────────────
// `chairUserId` references a user who acts as the cooperative's chair.
// Declared without an inline FK here to avoid a circular-import / forward-
// reference loop with `users` (which itself FK's `cooperatives.id` for
// `defaultCooperativeId`). The runtime FK is added by the migration SQL
// with `ON DELETE SET NULL` — chair role is human-assigned, not data-
// owning, so deleting the user shouldn't cascade-kill the cooperative.
export const cooperatives = iamSchema.table('cooperatives', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  districtCode: text('district_code'),
  districtName: text('district_name'),
  chairUserId: uuid('chair_user_id'),
  contactEmail: citext('contact_email'),
  contactPhone: text('contact_phone'),
  address: text(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
});

// ── Users (better-auth "user" + domain extensions) ───────────
// Field names here must match better-auth's conventions on the left
// (id/email/emailVerified/name/image/createdAt/updatedAt) so the drizzle
// adapter can read them without extra field mappings. Additional domain
// fields live alongside and are declared in `auth.ts` via `additionalFields`.
export const users = iamSchema.table(
  'users',
  {
    // ── better-auth required fields ──
    id: uuid().primaryKey().defaultRandom(),
    email: citext().notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('full_name').notNull(),
    image: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // ── domain-only fields (declared as additionalFields in auth.ts) ──
    status: text().notNull().default('active'),
    defaultCooperativeId: uuid('default_cooperative_id').references(() => cooperatives.id, {
      onDelete: 'set null',
    }),
    // Independent of `userCooperativeAssignments` — when true, the
    // user has access to EVERY cooperative regardless of their
    // assignment list. Set automatically when an admin role
    // (system_admin / project_leader / buyer) is granted; can
    // also be toggled directly. Kept SEPARATE from cooperative_ids
    // so we never have to denormalise "all" into a flat id list.
    isAllCooperative: boolean('is_all_cooperative').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    // ── soft delete ──
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  },
  (t) => [check('users_status_check', sql`${t.status} IN ('active','inactive','locked')`)],
);

// ── Sessions (better-auth-managed; schema MUST match adapter expectations) ─
export const sessions = iamSchema.table(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ── Accounts (better-auth-managed; credential + OAuth provider details) ───
// For email/password sign-ins, the `password` column holds the argon2 hash.
export const accounts = iamSchema.table(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

// ── Verifications (better-auth: email verify + magic link + password reset) ──
export const verifications = iamSchema.table(
  'verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ── Roles & Permissions ──────────────────────────────────────
export const roles = iamSchema.table('roles', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = iamSchema.table('permissions', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Bumped manually on every admin-side PATCH so the permissions list
  // can show a "last touched" column. Defaults to `now()` for legacy
  // rows that were inserted before this column existed.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = iamSchema.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    // Reverse lookup: which roles hold a given permission (PK leftmost is
    // role_id, so a permission-only filter can't use it).
    index('role_permissions_permission_idx').on(t.permissionId),
  ],
);

export const userRoles = iamSchema.table(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    // Reverse lookup: which users hold a given role.
    index('user_roles_role_idx').on(t.roleId),
  ],
);

export const userCooperativeAssignments = iamSchema.table(
  'user_cooperative_assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cooperativeId: uuid('cooperative_id')
      .notNull()
      .references(() => cooperatives.id, { onDelete: 'cascade' }),
    // Domain scope: 'district' = own district only; 'all_districts' = cross-district.
    // See comment at top of db/seed/iam.ts for which role maps to which scope.
    assignmentScope: text('assignment_scope').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('uca_scope_check', sql`${t.assignmentScope} IN ('district','all_districts')`),
    uniqueIndex('uca_user_coop_uk').on(t.userId, t.cooperativeId),
    // Reverse lookup: members of a cooperative (UK leftmost is user_id).
    index('uca_cooperative_idx').on(t.cooperativeId),
  ],
);

/**
 * Per-user notification opt-out toggles. Each row records that the
 * user has DISABLED a resource's notification stream — absence of a
 * row = enabled (default-on for everything they hold
 * `<resource>:notification` for). Storing only the off-state lets
 * new resources auto-opt-in without per-user backfill.
 *
 * The SSE filter intersects: (caller's `:notification` perms) MINUS
 * (rows in this table for caller).
 */
export const userNotificationPref = iamSchema.table(
  'user_notification_pref',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })],
);

// ── relations ────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  userRoles: many(userRoles),
  sessions: many(sessions),
  accounts: many(accounts),
  defaultCooperative: one(cooperatives, {
    fields: [users.defaultCooperativeId],
    references: [cooperatives.id],
  }),
}));

export const cooperativesRelations = relations(cooperatives, ({ many }) => ({
  users: many(users),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

/**
 * Notification read cursor — one row per user, holding the highest
 * `audit.audit_logs.id` they've seen in the bell. Replaces the old
 * localStorage cursor so "seen" follows the account across devices.
 */
export const userNotificationReads = iamSchema.table('user_notification_reads', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastReadAuditId: bigint('last_read_audit_id', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
