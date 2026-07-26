/**
 * Drizzle client for the ThinkCocoa Postgres database.
 *
 * Usage:
 *   import { db } from '@/db/client';
 *   import { farmers } from '@/db/schema';
 *   const rows = await db.select().from(farmers).where(eq(farmers.id, farmerId));
 *
 * Two connection pools share the process:
 *
 *   - `pool` / `db`  → primary pool. In production this points at the
 *     DigitalOcean PgBouncer (port 25061, transaction mode). Use for all
 *     ordinary query work — short-lived transactions, request/response
 *     cycles. Better-auth reuses this pool too.
 *
 *   - `directPool`   → direct-to-Postgres pool (port 25060). Use ONLY for
 *     features that need a persistent backend connection: LISTEN/NOTIFY,
 *     prepared statements, `SET LOCAL`, advisory locks. The drizzle
 *     migrator also uses this pool because DDL statements must not be
 *     routed through transaction-mode PgBouncer.
 *
 * In dev (single local Postgres on 5539) `DATABASE_DIRECT_URL` is unset and
 * `directPool` transparently falls back to the same connection string as
 * `pool` — no behaviour change locally.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

// pg-connection-string v2.12+ silently upgrades `sslmode=require` to
// `verify-full`, which then rejects DigitalOcean's intermediate CA chain
// even when we pass `ssl: { rejectUnauthorized: false }` explicitly (the
// URL-derived option wins). When the caller asks for SSL via DATABASE_SSL,
// we strip every `sslmode` query param from the URL and let the explicit
// ssl object below take effect — this is the only way to make
// rejectUnauthorized:false actually trust DO's cert.
function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error(
    'DATABASE_URL is required. Set it in apps/be/.env (see .env.example for the format).',
  );
}

const wantSsl = process.env.DATABASE_SSL === 'true';
const connectionString = wantSsl ? stripSslMode(rawConnectionString) : rawConnectionString;
const directConnectionString = wantSsl
  ? stripSslMode(process.env.DATABASE_DIRECT_URL ?? rawConnectionString)
  : (process.env.DATABASE_DIRECT_URL ?? rawConnectionString);

// Managed Postgres (DigitalOcean, RDS, etc.) presents a CA-signed cert but
// node-postgres can't always chase the chain — `rejectUnauthorized: false`
// trusts the server cert without pinning. Toggle via DATABASE_SSL so dev
// keeps connecting to the local container without TLS.
const sslConfig: pg.PoolConfig['ssl'] = wantSsl ? { rejectUnauthorized: false } : undefined;

export const pool = new pg.Pool({
  connectionString,
  ssl: sslConfig,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

export const directPool = new pg.Pool({
  connectionString: directConnectionString,
  ssl: sslConfig,
  // Direct pool stays tiny — it's only for SSE LISTEN + migration. Each
  // SSE subscriber holds one connection for the lifetime of the stream,
  // so we cap it deliberately low to avoid eating the Postgres connection
  // budget (DO Basic plan = 22 backend slots).
  max: Number(process.env.DATABASE_DIRECT_POOL_MAX ?? 2),
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Db = typeof db;
