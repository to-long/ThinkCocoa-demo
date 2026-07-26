/**
 * Drizzle migrator — runs all migrations under `db/drizzle/` in order.
 * Seeds idempotent baseline data (IAM + reference) after migrations.
 *
 * Workflow:
 *   1. Edit `src/db/schema/*.ts`
 *   2. `bun run db:generate` — drizzle-kit writes a new SQL file under db/drizzle/
 *   3. `bun run db:migrate`  — applies all pending + runs seeds
 *
 * For non-DDL changes (trigger functions, seed data), use
 * `bunx drizzle-kit generate --custom --name <desc>` to create an empty SQL
 * file and fill it by hand, or add TS seed modules under `db/seed/`.
 *
 * Connection routing:
 *   - Migrations run against `directPool`. DDL + drizzle's internal
 *     `__drizzle_migrations` tracking table need a stable backend
 *     connection that doesn't get swapped mid-transaction by PgBouncer.
 *   - Seeds run against the regular `db` (pooler) — they're pure data
 *     inserts with `ON CONFLICT DO NOTHING`, safe under transaction
 *     pooling.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { directPool, pool } from '../src/db/client';
import { seedAll } from './seed/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, 'drizzle');

async function main(): Promise<void> {
  // Use a one-off drizzle instance bound to the direct pool so DDL and
  // migration-tracking statements run on a non-pooled connection.
  const migrator = drizzle(directPool);

  console.log('Running drizzle migrations...');
  await drizzleMigrate(migrator, { migrationsFolder });
  console.log('Drizzle migrations complete.');

  await seedAll();
}

main()
  .then(async () => {
    await Promise.allSettled([pool.end(), directPool.end()]);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await Promise.allSettled([pool.end(), directPool.end()]);
    process.exit(1);
  });
