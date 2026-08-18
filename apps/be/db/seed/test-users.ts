/**
 * Dev-only seed: per-role test accounts.
 *
 * All test users share the same password: `KuanaData2026!`
 *
 * Org-wide accounts (1 each, all home to the first Demo Cocoa coop —
 * scope is `all_districts` so the home assignment is just bookkeeping):
 *   - project.leader@kuanadata.com
 *   - system.admin@kuanadata.com
 *   - buyer@kuanadata.com
 *
 * Coop-bound accounts (one per Demo Cocoa coop — `district` scope, view
 * naturally limited to their cooperative):
 *   - chair.{coop}@kuanadata.com         (cooperative_chair)
 *   - ims.manager.{coop}@kuanadata.com   (ims_manager)
 *   - field.officer.{coop}@kuanadata.com (field_officer)
 *
 * Per-coop project leaders (one per Demo Cocoa coop — `all_districts`
 * scope so the role's org-wide semantics stay intact, but anchored
 * to a specific coop so they appear in that coop's member list):
 *   - project.leader.{coop}@kuanadata.com (project_leader)
 *
 * 4 coops × 4 coop-bound roles + 3 org-wide = 19 test accounts total.
 *
 * Idempotent: skips users that already exist; re-grants roles; upserts
 * coop assignments. Pre-step also purges the old single-user variants
 * (`field.officer@…`, `ims.manager@…`) from databases that were seeded
 * before the per-coop split.
 */

import 'dotenv/config';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { auth } from '../../src/auth';
import { db } from '../../src/db/client';
import {
  accounts,
  cooperatives,
  roles,
  userCooperativeAssignments,
  userRoles,
  users,
} from '../../src/db/schema/iam';
import { DEMO_COOPERATIVES } from './cooperatives';

// Home cooperative for test users. Picked as the first Demo Cocoa coop so every
// seeded admin lands in a real-data coop; the per-role permission gates don't
// care which specific coop — just that one exists.
const DEFAULT_COOP_CODE = DEMO_COOPERATIVES[0].code;

const TEST_PASSWORD = 'KuanaData2026!';

/** Deterministic "last seen" within the past 10 days — derived from the
 *  email so a re-seed doesn't reshuffle the column. */
function seededLastLogin(email: string): Date {
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const minutesAgo = (h >>> 0) % (10 * 24 * 60);
  return new Date(Date.now() - minutesAgo * 60_000);
}

interface TestUser {
  email: string;
  name: string;
  roleCode:
    | 'field_officer'
    | 'ims_manager'
    | 'project_leader'
    | 'system_admin'
    | 'buyer'
    | 'cooperative_chair';
  /** Scope in user_cooperative_assignments.assignment_scope */
  scope: 'district' | 'all_districts';
  /** Override the home cooperative. Defaults to the first Demo Cocoa coop. */
  coopCode?: string;
}

// Slugify a coop code for use in an email local-part:
//   "NKABOM" → "nkabom"
function coopSlug(code: string): string {
  return code.toLowerCase().replace(/_/g, '');
}

// One coop-bound test user per (coop × role) for the four roles that
// need a working sample account on every coop. Three are district-
// scoped (chair / ims_manager / field_officer); the project_leader
// stays `all_districts` (per the SRS — operational oversight across
// all coops) but each per-coop entry creates an explicit assignment
// row so the user shows up in that coop's member list — without it,
// org-wide users are invisible to `/api/cooperatives/{id}/users`.
const PER_COOP_USERS: TestUser[] = DEMO_COOPERATIVES.flatMap((c) => [
  {
    email: `chair.${coopSlug(c.code)}@kuanadata.com`,
    name: `${c.name} Cooperative Chair`,
    roleCode: 'cooperative_chair',
    scope: 'district',
    coopCode: c.code,
  },
  {
    email: `ims.manager.${coopSlug(c.code)}@kuanadata.com`,
    name: `${c.name} IMS Manager`,
    roleCode: 'ims_manager',
    scope: 'district',
    coopCode: c.code,
  },
  {
    email: `field.officer.${coopSlug(c.code)}@kuanadata.com`,
    name: `${c.name} Field Officer`,
    roleCode: 'field_officer',
    scope: 'district',
    coopCode: c.code,
  },
  {
    email: `project.leader.${coopSlug(c.code)}@kuanadata.com`,
    name: `${c.name} Project Leader`,
    roleCode: 'project_leader',
    scope: 'all_districts',
    coopCode: c.code,
  },
]);

export const TEST_USERS: TestUser[] = [
  // Org-wide accounts — `all_districts` scope, see every coop.
  {
    email: 'project.leader@kuanadata.com',
    name: 'Project Leader Test',
    roleCode: 'project_leader',
    scope: 'all_districts',
  },
  {
    email: 'system.admin@kuanadata.com',
    name: 'System Admin Test',
    roleCode: 'system_admin',
    scope: 'all_districts',
  },
  {
    email: 'buyer@kuanadata.com',
    name: 'Buyer Test',
    roleCode: 'buyer',
    scope: 'all_districts',
  },
  ...PER_COOP_USERS,
];

// Pre-split single-user variants. Removed by `seedTestUsers()` so a
// dev who's been running the old seed gets a clean per-coop matrix
// without having to nuke the DB. Cascades wipe their role + coop
// assignment rows automatically.
const LEGACY_TEST_EMAILS = ['field.officer@kuanadata.com', 'ims.manager@kuanadata.com'];

async function ensureUser(tu: TestUser, coopId: string): Promise<{ id: string; created: boolean }> {
  // 1. Already exists?
  const [existing] = await db.select().from(users).where(eq(users.email, tu.email)).limit(1);

  if (existing) {
    // A user row can exist without a credential account when it was
    // bootstrapped via magic-link (no password → no accounts row).
    // Without this backfill, email/password sign-in stays 401 forever
    // for that account even though the user "exists". Idempotent.
    await ensureCredential(existing.id);
    // Per-coop display names are built from the cooperative name
    // (`${c.name} Field Officer`), so renaming a cooperative leaves them
    // stale — and because this branch used to return without touching the
    // row, not even a re-seed or a demo reset could repair them. Refresh
    // when it drifted; no-op otherwise.
    if (existing.name !== tu.name) {
      await db.update(users).set({ name: tu.name }).where(eq(users.id, existing.id));
    }
    // Give the users list a populated "Last Login" column. Only stamped when
    // it's still NULL, so a real sign-in during the demo is never overwritten
    // by a re-seed. Spread deterministically over the past ~10 days from the
    // email, so the column sorts meaningfully instead of showing one instant.
    await db
      .update(users)
      .set({ lastLoginAt: seededLastLogin(tu.email) })
      .where(and(eq(users.id, existing.id), isNull(users.lastLoginAt)));
    return { id: existing.id, created: false };
  }

  // 2. Sign up through better-auth (hashes password, writes users + accounts).
  const result = await auth.api.signUpEmail({
    body: { email: tu.email, password: TEST_PASSWORD, name: tu.name },
  });
  if (!result?.user?.id) {
    throw new Error(`sign-up failed for ${tu.email}`);
  }

  // 3. Stamp default cooperative.
  await db.update(users).set({ defaultCooperativeId: coopId }).where(eq(users.id, result.user.id));

  return { id: result.user.id, created: true };
}

async function ensureCredential(userId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1);
  if (existing) return;

  const ctx = await auth.$context;
  const hash = await ctx.password.hash(TEST_PASSWORD);
  await db.insert(accounts).values({
    providerId: 'credential',
    accountId: userId,
    userId,
    password: hash,
  });
}

async function ensureRole(userId: string, roleCode: TestUser['roleCode']): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.code, roleCode)).limit(1);
  if (!role) throw new Error(`role '${roleCode}' not found — run db:seed first`);

  await db.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
}

async function ensureCoopAssignment(
  userId: string,
  cooperativeId: string,
  scope: TestUser['scope'],
): Promise<void> {
  const existing = await db
    .select()
    .from(userCooperativeAssignments)
    .where(
      and(
        eq(userCooperativeAssignments.userId, userId),
        eq(userCooperativeAssignments.cooperativeId, cooperativeId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].assignmentScope !== scope) {
      await db
        .update(userCooperativeAssignments)
        .set({ assignmentScope: scope })
        .where(eq(userCooperativeAssignments.id, existing[0].id));
    }
    return;
  }

  await db.insert(userCooperativeAssignments).values({
    userId,
    cooperativeId,
    assignmentScope: scope,
    isPrimary: true,
  });
}

export async function seedTestUsers(): Promise<void> {
  console.log('Seeding test users...');

  // Drop pre-split test accounts (single ims_manager / field_officer
  // pinned to SANKOFA) — replaced by the per-coop matrix below.
  // FK cascades clean up user_roles + user_cooperative_assignments.
  const removed = await db
    .delete(users)
    .where(inArray(users.email, LEGACY_TEST_EMAILS))
    .returning({ email: users.email });
  if (removed.length > 0) {
    console.log(
      `  removed ${removed.length} legacy test account(s): ${removed.map((r) => r.email).join(', ')}`,
    );
  }

  // Pre-load every coop so each user can be homed to its own (chairs)
  // or fall back to DEFAULT_COOP_CODE (per-role users).
  const allCoops = await db.select().from(cooperatives);
  const coopByCode = new Map(allCoops.map((c) => [c.code, c]));
  const defaultCoop = coopByCode.get(DEFAULT_COOP_CODE);
  if (!defaultCoop) {
    throw new Error(`default cooperative '${DEFAULT_COOP_CODE}' not found — run db:seed first`);
  }

  for (const tu of TEST_USERS) {
    const homeCoop = tu.coopCode ? coopByCode.get(tu.coopCode) : defaultCoop;
    if (!homeCoop) {
      throw new Error(
        `cooperative '${tu.coopCode}' not found for user ${tu.email} — run db:seed first`,
      );
    }
    const { id, created } = await ensureUser(tu, homeCoop.id);
    await ensureRole(id, tu.roleCode);
    await ensureCoopAssignment(id, homeCoop.id, tu.scope);
    // `users.is_all_cooperative` is NOT touched here — `seedIam()`
    // owns that flag (see syncIsAllCooperativeFlag) and re-derives
    // it from role membership at the end of every IAM seed. The
    // orchestrator runs IAM after this so the flag ends up correct.
    console.log(
      `  ${created ? '+' : '='} ${tu.email.padEnd(40)}  role=${tu.roleCode.padEnd(18)}  coop=${homeCoop.code.padEnd(12)}  scope=${tu.scope}`,
    );
  }

  console.log('Test users ready. Password for all: KuanaData2026!');
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
