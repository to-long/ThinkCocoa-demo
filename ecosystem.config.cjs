/**
 * PM2 process manifest — blue-green slot picker for zero-downtime deploys.
 *
 * Architecture:
 *   nginx (:80) ──┬─→ 127.0.0.1:8001  (slot A)
 *                 └─→ 127.0.0.1:8002  (slot B)
 *
 * At any moment exactly ONE slot is running. The deploy workflow
 * (`.github/workflows/deploy.yml`):
 *   1. Detects active port via `ss -tln` on the Droplet
 *   2. SSHs in and runs `pm2 start ecosystem.config.cjs --env production`
 *   3. THIS file's slot picker (below) auto-selects the FREE port
 *      → starts NEW under name `impact-cocoa-<NEW>`
 *   4. Workflow health-checks NEW on 127.0.0.1:<NEW>/health
 *   5. Workflow does `pm2 delete impact-cocoa-<OLD>` once NEW is healthy
 *
 * nginx's `max_fails=1 fail_timeout=5s` + `proxy_next_upstream` means
 * the brief window where OLD is being killed costs at most ~50 ms of
 * retry latency on 1–2 user requests — no 502s, no nginx reload.
 *
 * We deliberately DROPPED `Bun.serve + reusePort` from this app.
 * SO_REUSEPORT + PM2 IPC ready-handshake was unreliable on Bun; nginx
 * passive failover + a single Bun process per slot is simpler and
 * battle-tested.
 */

const { execSync } = require('node:child_process');

const SLOTS = [8001, 8002];

const isTaken = (port) => {
  try {
    // Parse `ss -tln` output and pull the Local Address:Port column
    // (4th column). Match if ANY bind address is using the port —
    // 127.0.0.1:8001, 0.0.0.0:8001, [::]:8001 all count. This way the
    // picker stays correct even if HOST gets temporarily flipped (e.g.
    // during a debug session) or if a stray process grabs the slot.
    const out = execSync('ss -tln 2>/dev/null', { encoding: 'utf8' });
    return out.split('\n').some((line) => {
      const cols = line.trim().split(/\s+/);
      const local = cols[3];
      return local?.endsWith(`:${port}`);
    });
  } catch {
    return false;
  }
};

const PORT = SLOTS.find((p) => !isTaken(p));
if (!PORT) {
  throw new Error(
    `All blue-green slots [${SLOTS.join(', ')}] are occupied. ` +
      `Run 'pm2 list' on the host and clean up before retry.`,
  );
}

module.exports = {
  apps: [
    {
      name: `impact-cocoa-${PORT}`,
      cwd: './apps/be',
      script: 'bun',
      args: 'dist/main.js',
      interpreter: 'none',

      autorestart: true,
      max_restarts: 5,
      min_uptime: '60s',
      restart_delay: 2000,
      max_memory_restart: '500M',

      out_file: `/var/log/impact-cocoa/${PORT}-out.log`,
      error_file: `/var/log/impact-cocoa/${PORT}-error.log`,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Only boot-time / process-level config goes here. Secrets +
      // operational env (SPACES_*, STORAGE_*, DATABASE_*, KOBO_API_KEY,
      // SENTRY_*, …) come from `apps/be/.env` via `dotenv/config` at
      // app startup. `NODE_ENV` lives in PM2 because several libs
      // (Sentry, better-auth, drizzle) read it at module-init time
      // — before any `import 'dotenv/config'` has run.
      //
      // deploy.yml selects the right block per-Droplet via
      // `pm2 start ecosystem.config.cjs --env <production|staging>`.
      // Staging keeps a distinct NODE_ENV so Sentry events + S3
      // archive prefixes don't collide with production's; the app
      // itself treats anything except 'development' as prod-shaped
      // (no OpenAPI viewer, no LAN-wide CORS, etc.).
      env_production: {
        NODE_ENV: 'production',
        PORT: String(PORT),
        HOST: '127.0.0.1',
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: String(PORT),
        HOST: '127.0.0.1',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: String(PORT),
        HOST: '127.0.0.1',
      },
    },
    // ── Daily storage maintenance ───────────────────────────────
    // PM2 cron entry — runs `scripts/storage-maintenance.ts` once
    // at 02:05 UTC every day. `autorestart: false` means PM2 does
    // NOT relaunch between cron firings (default behaviour for a
    // long-running process). The script tar+zstds yesterday's hot
    // folder, ships to Spaces, and deletes folders > STORAGE_HOT_DAYS.
    //
    // Logs land in /var/log/impact-cocoa/storage-maintenance-*.log
    // and each run prints one NDJSON summary line, easy to grep.
    {
      name: 'storage-maintenance',
      cwd: './apps/be',
      script: 'bun',
      args: 'scripts/storage-maintenance.ts',
      interpreter: 'none',

      autorestart: false,
      cron_restart: '5 2 * * *', // 02:05 UTC daily
      // Stagger with the BE cron schedulers so 02:00 isn't a thundering
      // herd of DB writes. Five-minute offset is plenty.

      out_file: '/var/log/impact-cocoa/storage-maintenance-out.log',
      error_file: '/var/log/impact-cocoa/storage-maintenance-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env_production: { NODE_ENV: 'production' },
      env_staging: { NODE_ENV: 'staging' },
      env_development: { NODE_ENV: 'development' },
    },
  ],
};
