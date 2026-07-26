import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// See `src/db/client.ts` for the same workaround. pg-connection-string
// silently turns `sslmode=require` into `verify-full`, which then rejects
// DigitalOcean's CA chain even when `rejectUnauthorized: false` is set.
// Strip sslmode so the explicit ssl object below wins.
function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

const wantSsl = process.env.DATABASE_SSL === 'true';
const rawUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error(
    'DATABASE_URL (or DATABASE_DIRECT_URL) is required for drizzle-kit. Set it in apps/be/.env.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './db/drizzle',
  // Manage every application schema with drizzle-kit. 'public' is excluded:
  //   - Better-auth tables (user/session/account/verification) live in public and
  //     are managed by better-auth itself, not drizzle-kit.
  //   - Drizzle's own migration-tracking tables also live in public.
  //   - Trigger functions set_updated_at / notify_projection_invalidate live in public.
  schemaFilter: [
    'iam',
    'farmer',
    'field_ops',
    'gis',
    'traceability',
    'reporting',
    'audit',
    'reference',
    'inspection',
    'integration',
  ],
  dbCredentials: {
    // drizzle-kit runs DDL (CREATE SCHEMA, ALTER TABLE, ...). Those don't
    // survive transaction-mode PgBouncer pooling, so always prefer the
    // direct URL when one is configured. Falls back to DATABASE_URL in dev
    // where there's only one Postgres endpoint.
    url: wantSsl ? stripSslMode(rawUrl) : rawUrl,
    ssl: wantSsl ? { rejectUnauthorized: false } : (false as const),
  },
  verbose: true,
  strict: false,
  breakpoints: true,
});
