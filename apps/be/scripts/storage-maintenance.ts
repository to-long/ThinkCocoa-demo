/**
 * Daily storage maintenance — entry point for the cron job.
 *
 * Runs `TieredStorage.runDailyMaintenance()` once and logs the
 * summary as a single NDJSON line so it stays grep-friendly in
 * `pm2 logs storage-maintenance`. Exits non-zero on failure so
 * PM2 marks the run as errored (visible in `pm2 list` / DO alerts).
 *
 * Schedule (PM2 ecosystem.config.cjs):
 *   - `cron_restart: '5 2 * * *'` (02:05 UTC daily)
 *   - `autorestart: false` so PM2 doesn't restart it between runs
 *
 * Manual run for ops debug:
 *   cd /opt/kuanadata/apps/be && bun scripts/storage-maintenance.ts
 *
 * Reads env (via `tieredStorageFromEnv()`):
 *   STORAGE_ROOT, STORAGE_S3_PREFIX, STORAGE_HOT_DAYS,
 *   STORAGE_ENV (or SENTRY_ENVIRONMENT or NODE_ENV).
 */

// Sentry init MUST run first (same guard as src/main.ts) so failures in
// this cron surface on Sentry, not only in the PM2 log file. This is a
// separate short-lived process from the HTTP app, so it needs its own
// init + an explicit flush() before exit (events send asynchronously).
import 'dotenv/config';
import * as Sentry from '@sentry/bun';
import { tieredStorageFromEnv } from '../src/lib/tiered-storage';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  enabled: !!process.env.SENTRY_DSN && process.env.NODE_ENV !== 'development',
  release: process.env.SENTRY_RELEASE,
  // One-shot job: no request tracing needed.
  tracesSampleRate: 0,
});
Sentry.setTag('job', 'storage-maintenance');

const t0 = Date.now();
try {
  const ts = tieredStorageFromEnv();
  const summary = await ts.runDailyMaintenance();
  console.log(
    JSON.stringify({
      level: 'info',
      at: 'storage-maintenance',
      ok: true,
      durationMs: summary.durationMs,
      archived: summary.archived,
      purged: summary.purged,
      totalArchivedBytes: summary.archived.reduce((s, a) => s + a.compressedBytes, 0),
      totalRawBytes: summary.archived.reduce((s, a) => s + a.rawBytes, 0),
    }),
  );
  process.exit(0);
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      at: 'storage-maintenance',
      ok: false,
      durationMs: Date.now() - t0,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  // Report to Sentry and wait for delivery before the process exits
  // (no-op when the DSN is unset / dev).
  Sentry.captureException(err);
  await Sentry.flush(2000);
  process.exit(1);
}
