/**
 * "Reset demo data" — wipe every operational table, then rebuild the
 * baseline demo dataset from the seed.
 *
 * This exists because the app IS a demo: a sales run imports CSVs, closes
 * CLMRS cases, edits farmers, and then needs a one-click way back to a
 * known-good state before the next call. Reaching for `bun run db:seed` on
 * the box isn't an option mid-demo.
 *
 * What it does, in order:
 *   1. TRUNCATE every base table in the operational schemas (below), in
 *      one statement with CASCADE so FK order doesn't matter.
 *   2. Clear the sync jobs' run history so the Data Sync page reads
 *      "Never" again — the page this action is triggered from.
 *   3. Re-run the seed as a subprocess, which re-creates farmers,
 *      parcels, geometries, EUDR, inspections, corrective actions,
 *      coaching/CLMRS, training, purchases, primary + secondary
 *      evacuation, VSLA and the demo audit feed — and re-upserts
 *      cooperatives, users, roles and permission grants.
 *   4. Clear soft-delete flags in `iam`. The seed upserts by natural key,
 *      which repairs an edited cooperative name or a wiped
 *      role_permissions row, but a user or cooperative "deleted" during a
 *      demo only has `deleted_at` set — the upsert leaves that stamp in
 *      place, so the record stays invisible in the UI after a reset.
 *
 * What it does NOT truncate:
 *   - `iam` — users, roles, permissions, cooperatives, sessions and
 *     accounts. Wiping these would log the admin out mid-reset and drop
 *     the login credentials the demo runs on, so they are repaired in
 *     place (steps 3 + 4) instead.
 *   - `integration` — `sync_settings` rows come from migration 0000, not
 *     from the seed, so truncating them would empty the Data Sync page
 *     permanently.
 *   - `reference` — RA indicator / EUDR code sets (re-upserted by the
 *     seed anyway, but nothing writes to them at runtime).
 *
 * The seed runs as a SUBPROCESS rather than an in-process `seedAll()`
 * import on purpose: production runs the bundled `dist/main.js`, where
 * `import.meta.url` no longer resolves `db/seed/fixtures/**`, so the
 * farmer dataset would be unreadable. Spawning `bun db/seed/index.ts`
 * keeps the seed running from source, exactly as `db:migrate` does.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { clearStorageContents } from '../../lib/audit-changes';

/** Schemas whose every table is demo/operational data owned by the seed. */
const WIPE_SCHEMAS = [
  'farmer',
  'gis',
  'inspection',
  'field_ops',
  'training',
  'coaching',
  'clmrs',
  'vsla',
  'purchase',
  'primary_evacuation',
  'secondary_evacuation',
  'shade',
  'traceability',
  'reporting',
  'audit',
] as const;

/** Seed steps behind this flag own the entire demo dataset (farmers →
 *  inspections → coaching → ops). Without it the reset would leave an
 *  empty app. */
const SEED_ENV = { SEED_FARMERS_FROM_CSV: 'true' } as const;

export interface ResetDemoDataSummary {
  tablesTruncated: number;
  /** Top-level entries removed from `STORAGE_ROOT` (audit diffs, reports). */
  storageEntriesRemoved: number;
  /** Soft-deleted `iam` rows brought back (0 on an undamaged demo). */
  undeleted: { users: number; cooperatives: number };
  durationMs: number;
  /** Row counts after the re-seed — proof the rebuild actually landed. */
  counts: {
    farmers: number;
    parcels: number;
    geometries: number;
    eudr: number;
    inspections: number;
    correctiveActions: number;
    coaching: number;
    clmrsRemediation: number;
    training: number;
    purchases: number;
    primaryLots: number;
    secondaryLots: number;
    vslaGroups: number;
    cooperatives: number;
    users: number;
    rolePermissions: number;
    auditLogs: number;
  };
}

/**
 * Locate `db/seed/index.ts`. The BE process runs with cwd = `apps/be`
 * both in dev (`bun --watch src/main.ts`) and in production (pm2
 * `cwd: './apps/be'`), but fall back to a repo-root cwd so a manual
 * `bun apps/be/src/main.ts` still works.
 */
function resolveSeedScript(): string | null {
  const candidates = [
    path.join(process.cwd(), 'db/seed/index.ts'),
    path.join(process.cwd(), 'apps/be/db/seed/index.ts'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function runSeedScript(script: string): Promise<void> {
  // `process.execPath` is the bun binary already running the server — no
  // assumption about `bun` being on the deploy user's PATH.
  const child = spawn(process.execPath, [script], {
    cwd: path.resolve(script, '../../..'),
    env: { ...process.env, ...SEED_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise<void>((resolve, reject) => {
    // Keep only the tail — the seed prints a per-step progress block and
    // the whole log is useless in an error message.
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    // Drained but discarded: an unread pipe would block the seed once the
    // OS buffer fills.
    child.stdout?.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Seed exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

export async function resetDemoData(db: Db): Promise<ResetDemoDataSummary> {
  const startedAt = Date.now();

  const script = resolveSeedScript();
  if (!script) {
    // Fail BEFORE truncating — a wipe we can't reseed would leave the
    // demo empty with no way back through the UI.
    throw new Error(
      'Seed script not found (looked for db/seed/index.ts relative to the server cwd) — refusing to wipe data that cannot be rebuilt.',
    );
  }

  // `IN (…)` with an explicit placeholder per schema — passing the array
  // to `= ANY(${arr})` makes drizzle expand it to a parameter TUPLE
  // (`ANY(($1,$2,…))`), which Postgres rejects.
  const schemaList = sql.join(
    WIPE_SCHEMAS.map((s) => sql`${s}`),
    sql`, `,
  );
  const tables = await db.execute<{ qualified: string }>(sql`
    SELECT format('%I.%I', table_schema, table_name) AS qualified
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN (${schemaList})
    ORDER BY table_schema, table_name
  `);
  const qualified = tables.rows.map((r) => r.qualified);

  if (qualified.length > 0) {
    // Identifiers come from `format('%I.%I')`, i.e. already quoted by
    // Postgres — safe to interpolate. One statement + CASCADE so we don't
    // have to hand-maintain a topological FK order.
    await db.execute(sql.raw(`TRUNCATE TABLE ${qualified.join(', ')} RESTART IDENTITY CASCADE`));
  }

  await db.execute(sql`
    UPDATE integration.sync_settings
    SET last_run_at = NULL,
        last_query_at = NULL,
        last_run_status = NULL,
        last_run_summary = NULL,
        snapshot_hash = NULL,
        snapshot_uploaded_at = NULL,
        updated_at = now()
  `);

  // Wipe the storage root's contents. Audit field-diffs live there as JSON
  // files keyed by audit-log id, and `audit.audit_logs` was just truncated —
  // leaving the blobs behind would accumulate orphans nothing can reach.
  const storageEntriesRemoved = await clearStorageContents();

  await runSeedScript(script);

  // Un-delete anything the demo soft-deleted. Scoped to `deleted_at IS NOT
  // NULL` so it's a no-op on a clean DB, and it deliberately covers ALL
  // rows: in a demo database every user and cooperative belongs to the
  // baseline, and leaving one hidden is exactly the bug this fixes.
  const usersRestored = await db.execute(sql`
    UPDATE iam.users SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
    WHERE deleted_at IS NOT NULL
  `);
  const coopsRestored = await db.execute(sql`
    UPDATE iam.cooperatives SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
    WHERE deleted_at IS NOT NULL
  `);

  // One row per domain the demo actually shows, so the caller can prove
  // every module came back — not just farmers and parcels.
  const counts = await db.execute<Record<string, string>>(sql`
    SELECT (SELECT count(*) FROM farmer.farmers)                   AS farmers,
           (SELECT count(*) FROM gis.parcels)                      AS parcels,
           (SELECT count(*) FROM gis.parcel_geometries)            AS geometries,
           (SELECT count(*) FROM gis.eudr_status)                  AS eudr,
           (SELECT count(*) FROM inspection.inspections)           AS inspections,
           (SELECT count(*) FROM inspection.corrective_actions)    AS corrective_actions,
           (SELECT count(*) FROM coaching.coaching_visits)         AS coaching,
           (SELECT count(*) FROM inspection.corrective_actions
              WHERE source = 'coaching')                        AS clmrs_remediation,
           (SELECT count(*) FROM training.training_sessions)       AS training,
           (SELECT count(*) FROM purchase.cocoa_purchases)         AS purchases,
           (SELECT count(*) FROM primary_evacuation.lots)          AS primary_lots,
           (SELECT count(*) FROM secondary_evacuation.lots)        AS secondary_lots,
           (SELECT count(*) FROM vsla.groups)                      AS vsla_groups,
           (SELECT count(*) FROM iam.cooperatives WHERE deleted_at IS NULL) AS cooperatives,
           (SELECT count(*) FROM iam.users WHERE deleted_at IS NULL)        AS users,
           (SELECT count(*) FROM iam.role_permissions)             AS role_permissions,
           (SELECT count(*) FROM audit.audit_logs)                 AS audit_logs
  `);
  const row = counts.rows[0];
  const n = (key: string) => Number(row?.[key] ?? 0);

  return {
    tablesTruncated: qualified.length,
    storageEntriesRemoved,
    undeleted: {
      users: usersRestored.rowCount ?? 0,
      cooperatives: coopsRestored.rowCount ?? 0,
    },
    durationMs: Date.now() - startedAt,
    counts: {
      farmers: n('farmers'),
      parcels: n('parcels'),
      geometries: n('geometries'),
      eudr: n('eudr'),
      inspections: n('inspections'),
      correctiveActions: n('corrective_actions'),
      coaching: n('coaching'),
      clmrsRemediation: n('clmrs_remediation'),
      training: n('training'),
      purchases: n('purchases'),
      primaryLots: n('primary_lots'),
      secondaryLots: n('secondary_lots'),
      vslaGroups: n('vsla_groups'),
      cooperatives: n('cooperatives'),
      users: n('users'),
      rolePermissions: n('role_permissions'),
      auditLogs: n('audit_logs'),
    },
  };
}
