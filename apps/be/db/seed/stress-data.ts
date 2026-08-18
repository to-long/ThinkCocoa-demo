/**
 * Stress-test seed — inserts ONE row per entity with every text field
 * pushed to its schema cap (or the longest plausible nasty input).
 * Used to eyeball the admin UI for layout regressions: breadcrumbs
 * blowing past the viewport, table cells overflowing, dialog labels
 * wrapping ugly, etc.
 *
 * Idempotent — every row uses a stable `STRESS_*` identifier and the
 * inserts are `onConflictDoNothing` (or `onConflictDoUpdate` where
 * the field set changes shape over time).
 *
 * Enable with `SEED_STRESS_DATA=true`. Off by default so it doesn't
 * pollute the canonical seed run.
 */

import { eq, sql } from 'drizzle-orm';
import { auth } from '../../src/auth';
import type { Db } from '../../src/db/client';
import { auditLogs } from '../../src/db/schema/audit';
import { farmers } from '../../src/db/schema/farmer';
import { cooperatives, permissions, roles, userRoles, users } from '../../src/db/schema/iam';

// Repeat helper that stays under the cap. Use `r(N)` for a long
// no-whitespace string and `rWords(N, w)` to interleave spaces every
// `w` chars so wrap-vs-truncate behaviour can both be eyeballed.
const r = (n: number, ch = 'x') => ch.repeat(n);
const rWords = (n: number, wordLen = 8) => {
  const words: string[] = [];
  while (words.join(' ').length < n) words.push('x'.repeat(wordLen));
  return words.join(' ').slice(0, n);
};

// Caps — keep in sync with `FIELD_LIMITS` in shared. Values that are
// 1 char short of the cap so a future tightening doesn't break seed.
const CAPS = {
  fullName: 199, // user.fullName  (cap 200)
  shortText: 199, // society, role.name, coop.name (cap 200)
  description: 1999, // role/coop description (cap 2000)
  address: 499, // coop.address (cap 500)
  code: 63, // resource codes (cap 64)
  personName: 99, // farmer first/last (cap 100)
  contactPhone: 31, // (cap 32)
  nationalId: 63, // (cap 64)
  email: 253, // (cap 254)
} as const;

const STRESS_COOP_CODE = 'STRESS_LONG_FIELDS_COOP_AT_CAP_AAAAAAAAAAAAAAAAAAAAAAAAAAA';
const STRESS_USER_EMAIL = `stress.${'a'.repeat(120)}.long.user.${'b'.repeat(60)}@cocoa.example`;
const STRESS_ROLE_CODE = 'stress_long_role_code_at_the_field_limit_for_role_codes_aaaaaaa';
const STRESS_PERMISSION_CODE = `stress_resource_at_cap_aaaaaaaaaaaaaaaaa:read_action_at_cap_aaaa`;
const STRESS_FARMER_CODE = 'STRESS-FARMER-CODE-AT-CAP-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TEST_PASSWORD = 'KuanaData2026!';

interface StressIds {
  coopId?: string;
  userId?: string;
  roleId?: string;
  permissionId?: string;
  farmerId?: string;
}

export async function seedStressData(db: Db): Promise<void> {
  console.log('  stress-data: seeding at-cap rows for UI eyeball...');
  const ids: StressIds = {};

  // ── Cooperative ───────────────────────────────────────────────
  // Code, name, description, contact email + phone, address all at
  // their schema caps. `name` uses interleaved spaces so wrapping is
  // possible; `address` uses a single unbroken token to force
  // overflow / truncate behaviour in narrow cells.
  await db
    .insert(cooperatives)
    .values({
      code: STRESS_COOP_CODE.slice(0, CAPS.code),
      name: rWords(CAPS.shortText, 12),
      description: rWords(CAPS.description, 14),
      districtCode: r(CAPS.code, 'D'),
      districtName: rWords(CAPS.shortText, 10),
      contactEmail: `stress.contact.${r(CAPS.email - 'stress.contact.@cocoa.example'.length, 'c')}@cocoa.example`,
      contactPhone: `+1 ${r(CAPS.contactPhone - 5, '0')}`.slice(0, CAPS.contactPhone),
      address: r(CAPS.address, 'a'),
      isActive: true,
    })
    .onConflictDoUpdate({
      target: cooperatives.code,
      set: {
        name: rWords(CAPS.shortText, 12),
        description: rWords(CAPS.description, 14),
        address: r(CAPS.address, 'a'),
        updatedAt: new Date(),
      },
    });
  const [coop] = await db
    .select({ id: cooperatives.id })
    .from(cooperatives)
    .where(eq(cooperatives.code, STRESS_COOP_CODE.slice(0, CAPS.code)));
  ids.coopId = coop?.id;

  // ── Permission ────────────────────────────────────────────────
  // Single resource:action pair where both halves are at cap. Tests
  // the permissions table (Code column truncation, Name wrap) and
  // the role-dialog permission picker (group label + chip width).
  await db
    .insert(permissions)
    .values({
      code: STRESS_PERMISSION_CODE,
      name: rWords(CAPS.shortText, 10),
      description: rWords(CAPS.description, 14),
    })
    .onConflictDoUpdate({
      target: permissions.code,
      set: {
        name: rWords(CAPS.shortText, 10),
        description: rWords(CAPS.description, 14),
      },
    });
  const [perm] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, STRESS_PERMISSION_CODE));
  ids.permissionId = perm?.id;

  // ── Role ──────────────────────────────────────────────────────
  // Long lowercase code (matches role-code regex), long display name,
  // long description. Stress-tests the roles list table + role-dialog
  // header.
  await db
    .insert(roles)
    .values({
      code: STRESS_ROLE_CODE,
      name: rWords(CAPS.shortText, 12),
      description: rWords(CAPS.description, 14),
    })
    .onConflictDoUpdate({
      target: roles.code,
      set: {
        name: rWords(CAPS.shortText, 12),
        description: rWords(CAPS.description, 14),
      },
    });
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, STRESS_ROLE_CODE));
  ids.roleId = role?.id;

  // ── User ──────────────────────────────────────────────────────
  // Goes through better-auth signUpEmail so the password column +
  // accounts row are populated correctly. The email itself is
  // pathological: 200+ chars with dots and a long local part. Tests
  // the user list (truncate + copy), user detail (avatar initials,
  // breadcrumb), and the user dialog (read-only email field width).
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, STRESS_USER_EMAIL))
    .limit(1);
  if (existingUser.length === 0) {
    const result = await auth.api.signUpEmail({
      body: {
        email: STRESS_USER_EMAIL,
        password: TEST_PASSWORD,
        name: rWords(CAPS.fullName, 14),
      },
    });
    ids.userId = result?.user?.id;
    if (ids.userId && ids.coopId) {
      await db
        .update(users)
        .set({ defaultCooperativeId: ids.coopId })
        .where(eq(users.id, ids.userId));
    }
  } else {
    ids.userId = existingUser[0]!.id;
    await db
      .update(users)
      .set({ name: rWords(CAPS.fullName, 14) })
      .where(eq(users.id, ids.userId));
  }

  // Wire the user up with the stress role so the user-detail page
  // also stresses the role-pill row.
  if (ids.userId && ids.roleId) {
    await db
      .insert(userRoles)
      .values({ userId: ids.userId, roleId: ids.roleId })
      .onConflictDoNothing();
  }

  // ── Farmers ──────────────────────────────────────────────────
  // Multiple stress rows so the list page shows several long-field
  // farmers at once (a single row gets lost amongst the 4K seeded
  // farmers and you can't eyeball cell wrap / sort interaction with
  // just one). Each variant pushes a different combo so we cover:
  //
  //   1. EVERYTHING-AT-CAP  — every text field at limit; no spaces.
  //      Tests sticky first column + name cell ellipsis under
  //      pathological input.
  //   2. WORDS-AT-CAP        — same lengths but with spaces every
  //      ~12 chars. Tests `break-all` vs `break-words` wrapping.
  //   3. NAME-ONLY-LONG     — only first/last names long. Other
  //      cells normal-length. Tests row height when one cell wraps
  //      and others stay one-line.
  //   4. CODE-ONLY-LONG     — farmer code at cap, names short.
  //      Tests the truncated farmer-code cell + copy button.
  //   5. PHONE-ID-LONG      — phone + national ID at cap. Tests
  //      the contact column (no whitespace = forced overflow).
  //
  // All bound to the stress coop so they cluster together — filter
  // by that coop in the list to see them on one page.
  type StressFarmer = Omit<
    typeof farmers.$inferInsert,
    'cooperativeId' | 'createdAt' | 'updatedAt'
  >;
  const STRESS_FARMERS: StressFarmer[] = [
    {
      id: 'STRESS-1-EVERYTHING-AT-CAP',
      firstName: r(CAPS.personName, 'F'),
      lastName: r(CAPS.personName, 'L'),
      otherNames: r(CAPS.shortText, 'o'),
      sex: 'unknown',
      phoneNumber: r(CAPS.contactPhone, '0'),
      nationalIdNumber: r(CAPS.nationalId, 'N'),
      nationalIdType: r(CAPS.shortText, 't'),
      society: r(CAPS.shortText, 's'),
      certificationStatus: 'rainforest_alliance',
      householdSize: 99,
      childrenCount: 49,
      isActive: true,
    },
    {
      id: 'STRESS-2-WORDS-AT-CAP',
      firstName: rWords(CAPS.personName, 12),
      lastName: rWords(CAPS.personName, 12),
      otherNames: rWords(CAPS.shortText, 12),
      sex: 'unknown',
      phoneNumber: `+1 ${r(CAPS.contactPhone - 5, '0')}`.slice(0, CAPS.contactPhone),
      nationalIdType: rWords(CAPS.shortText, 10),
      society: rWords(CAPS.shortText, 10),
      certificationStatus: 'unknown',
      householdSize: 50,
      childrenCount: 25,
      isActive: true,
    },
    {
      id: 'STRESS-3-NAME-ONLY-LONG',
      firstName: rWords(CAPS.personName, 11),
      lastName: rWords(CAPS.personName, 11),
      sex: 'female',
      phoneNumber: '+1 30 123 4567',
      society: 'AF',
      certificationStatus: 'rainforest_alliance',
      isActive: true,
    },
    {
      id: STRESS_FARMER_CODE.slice(0, CAPS.code),
      firstName: 'Code',
      lastName: 'Stress',
      sex: 'male',
      society: 'AS',
      certificationStatus: 'rainforest_alliance',
      isActive: true,
    },
    {
      id: 'STRESS-5-PHONE-ID-LONG',
      firstName: 'Phone',
      lastName: 'Stress',
      sex: 'male',
      phoneNumber: r(CAPS.contactPhone, '9'),
      nationalIdNumber: r(CAPS.nationalId, 'X'),
      nationalIdType: 'national_id',
      society: 'TK',
      certificationStatus: 'unknown',
      isActive: true,
    },
  ];

  if (ids.coopId) {
    for (const fdata of STRESS_FARMERS) {
      await db
        .insert(farmers)
        .values({ ...fdata, cooperativeId: ids.coopId })
        .onConflictDoUpdate({
          target: farmers.id,
          set: { ...fdata, updatedAt: new Date() },
        });
    }
    // farmer.id IS the stress code now (migration 0019). No need
    // for a separate lookup.
    ids.farmerId = STRESS_FARMERS[0]!.id;
  }

  // ── Audit logs ────────────────────────────────────────────────
  // One row per stressed entity, with metadata payloads also at cap
  // so the audit-list metadata column + the detail-drawer JSON view
  // both get a real workout. Idempotency: clear any prior STRESS_
  // rows before inserting fresh ones (no natural uniqueness key on
  // audit_logs to upsert against).
  await db.delete(auditLogs).where(sql`metadata->>'stressTag' = 'stress-data-seed'`);

  const longSummary = rWords(500, 14);
  const longUserAgent = rWords(400, 12);
  const stressMeta = (entity: string) => ({
    stressTag: 'stress-data-seed',
    summary: longSummary,
    userAgent: longUserAgent,
    sessionId: `sess_${r(120, 'a')}`,
    targetEntity: entity,
    actorEmail: STRESS_USER_EMAIL,
  });

  const auditTargets: Array<{
    schema: string;
    table: string;
    entityId: string;
    action: string;
  }> = [
    {
      schema: 'iam',
      table: 'cooperatives',
      entityId: ids.coopId ?? 'no-coop',
      action: 'create',
    },
    {
      schema: 'iam',
      table: 'permissions',
      entityId: ids.permissionId ?? 'no-perm',
      action: 'create',
    },
    {
      schema: 'iam',
      table: 'roles',
      entityId: ids.roleId ?? 'no-role',
      action: 'update',
    },
    {
      schema: 'iam',
      table: 'users',
      entityId: ids.userId ?? 'no-user',
      action: 'create',
    },
    {
      schema: 'farmer',
      table: 'farmers',
      entityId: ids.farmerId ?? 'no-farmer',
      action: 'create',
    },
  ];

  const inserted = await db
    .insert(auditLogs)
    .values(
      auditTargets.map((t) => ({
        actorUserId: ids.userId ?? null,
        serviceName: 'admin-ui',
        entitySchema: t.schema,
        entityTable: t.table,
        entityId: t.entityId,
        action: t.action,
        cooperativeId: ids.coopId ?? null,
        metadata: stressMeta(`${t.schema}.${t.table}`),
      })),
    )
    .returning({ id: auditLogs.id });

  // Per-field diff seeding removed — diffs are now offloaded to
  // file storage via `audit_attachment` at write time, not seeded.
  // Detail drawer just shows the audit row itself for stress rows.
  void rWords; // helper retained for other stress payloads

  console.log(
    `    seeded stress rows: 1 coop, 1 user, 1 role, 1 permission, ${STRESS_FARMERS.length} farmers, ${inserted.length} audit logs`,
  );
}
