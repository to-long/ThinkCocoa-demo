/**
 * Seed orchestrator — declarative step list, idempotent end-to-end.
 *
 * Each `STEPS` entry is a phase with optional env-gating. The runner
 * walks them in order, prints a header, and skips when the gate
 * doesn't match. Adding a new seed phase = append one entry; no
 * conditionals to thread through.
 *
 * Order matters and reflects the dependency graph:
 *   1. cleanup         — drop legacy / obsolete rows so subsequent
 *                        upserts don't trip on stale FKs.
 *   2. cooperatives    — coop catalog (no chairs yet — chair_user_id
 *                        gets stamped after test-users below).
 *   3. iam             — permissions + roles + role_permissions, and
 *                        sync `users.is_all_cooperative` from role
 *                        membership at the end. (Run BEFORE test
 *                        users so canonical roles exist for them to
 *                        assign to.)
 *   4. reference       — RA + EUDR code sets.
 *   5. test-users      — 9 dev accounts, each with role + coop
 *                        assignment. Re-runs `iam.syncIsAllCooperative`
 *                        afterwards via the post-step hook so freshly
 *                        created users get their flag set.
 *   6. coop chairs     — stamp `chair_user_id` from the per-coop
 *                        chair test users that step 5 just created.
 *   7. farmers (opt)   — ~4K farmer rows from CSV fixtures.
 *   8. audit-logs      — 60 demo audit events (skips if rows exist).
 *   9. stress-data (opt)— at-cap rows in every entity (coop, user,
 *                        role, permission, farmer, audit) for UI
 *                        layout smoke-tests.
 *
 * Flip env flags to skip optional phases:
 *   SEED_TEST_USERS=false       — skip 5 (and therefore 6).
 *   SEED_FARMERS_FROM_CSV=true  — enable 7.
 *   SEED_AUDIT_LOGS=false       — skip 8.
 *   SEED_STRESS_DATA=true       — enable 9.
 */

import 'dotenv/config';
import { db } from '../../src/db/client';
import { seedAuditLogs } from './audit-logs';
import { cleanupLegacy } from './cleanup';
import { seedCoachingClmrs } from './coaching-clmrs';
import { seedCooperatives } from './cooperatives';
import { seedDemoOps } from './demo-ops';
import { seedFarmersFromCsv } from './farmers-from-csv';
import { seedIam } from './iam';
import { seedInspections } from './inspections';
import { seedReference } from './reference';
import { seedStressData } from './stress-data';
import { seedTestUsers } from './test-users';

interface SeedStep {
  name: string;
  /** Returns false to skip; defaults to always run. */
  enabled?: () => boolean;
  run: () => Promise<void>;
}

/** True when the env var is unset OR matches `truthy`. Used so
 *  `SEED_TEST_USERS=false` opts OUT but the default (unset) opts in. */
const optOut = (envVar: string) => process.env[envVar] !== 'false';
/** True only when the env var is explicitly set to `'true'`. Used for
 *  expensive opt-in steps (CSV farmer load, demo audit logs). */
const optIn = (envVar: string) => process.env[envVar] === 'true';

const STEPS: SeedStep[] = [
  {
    name: 'cleanup',
    run: () => cleanupLegacy(db),
  },
  {
    name: 'cooperatives',
    run: () => seedCooperatives(db),
  },
  {
    name: 'iam',
    run: () => seedIam(db),
  },
  {
    name: 'reference',
    run: () => seedReference(db),
  },
  {
    name: 'test-users',
    enabled: () => optOut('SEED_TEST_USERS'),
    // Re-run IAM at the end so `is_all_cooperative` syncs for the
    // newly-created users. Cheap (single UPDATE), keeps the flag
    // canonical even if test-users runs but iam already did.
    run: async () => {
      await seedTestUsers();
      await seedIam(db);
    },
  },
  {
    name: 'coop-chairs',
    enabled: () => optOut('SEED_TEST_USERS'),
    run: () => seedCooperatives(db, { withChairs: true }),
  },
  {
    name: 'farmers',
    enabled: () => optIn('SEED_FARMERS_FROM_CSV'),
    run: () => seedFarmersFromCsv(db),
  },
  {
    // One internal inspection per parcel (RA compliance + EUDR +
    // certification outcome). Depends on parcels, so it only runs
    // alongside the farmer CSV seed. Opt out with SEED_INSPECTIONS=false.
    name: 'inspections',
    enabled: () => optIn('SEED_FARMERS_FROM_CSV') && optOut('SEED_INSPECTIONS'),
    run: () => seedInspections(db),
  },
  {
    // One coaching visit + CLMRS verdict per farmer. Depends on
    // farmers, so it only runs alongside the farmer CSV seed. Opt out
    // with SEED_CLMRS=false.
    name: 'coaching-clmrs',
    enabled: () => optIn('SEED_FARMERS_FROM_CSV') && optOut('SEED_CLMRS'),
    run: () => seedCoachingClmrs(db),
  },
  {
    // VSLA groups + monthly reports, society purchases, primary +
    // secondary evacuation lots. Needs coops (+ farmers/parcels for
    // purchases). Opt out with SEED_OPS=false.
    name: 'demo-ops',
    enabled: () => optIn('SEED_FARMERS_FROM_CSV') && optOut('SEED_OPS'),
    run: () => seedDemoOps(db),
  },
  {
    name: 'audit-logs',
    // On by default — the demo's audit feed is empty without it, and the
    // step self-skips when the table already has rows (60 events, fast).
    // Disable with SEED_AUDIT_LOGS=false.
    enabled: () => optOut('SEED_AUDIT_LOGS'),
    run: () => seedAuditLogs(db),
  },
  {
    // One row per entity (coop, user, role, permission, farmer,
    // audit) with every text field pushed to its schema cap. UI
    // smoke-test fodder for breadcrumb / table / dialog / detail
    // overflow regressions. See `stress-data.ts`.
    name: 'stress-data',
    enabled: () => optIn('SEED_STRESS_DATA'),
    run: () => seedStressData(db),
  },
];

export async function seedAll(): Promise<void> {
  console.log('Seeding...');
  for (const step of STEPS) {
    if (step.enabled && !step.enabled()) {
      console.log(`  ${step.name}: skipped`);
      continue;
    }
    await step.run();
  }
  console.log('Seed complete.');
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('seed/index.ts');
if (isMain || (typeof import.meta.main !== 'undefined' && import.meta.main)) {
  seedAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
