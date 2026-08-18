// Sentry init MUST run first — before any other import that could
// throw — so the SDK installs its global handlers in time to catch
// startup errors (DB connection, missing env vars, etc.).
// Guarded: no-op when SENTRY_DSN is unset (dev / local).
import 'dotenv/config';
import * as Sentry from '@sentry/bun';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Per-Droplet NODE_ENV is what separates staging vs production
  // events on the Sentry UI. ecosystem.config.cjs has dedicated
  // `env_staging` / `env_production` blocks, and deploy.yml passes
  // `--env <APP_ENV>` to `pm2 start` so each Droplet boots with the
  // right label baked in.
  environment: process.env.NODE_ENV ?? 'development',
  // Enable on any non-dev Droplet. Local `bun run dev` keeps
  // NODE_ENV=development → Sentry stays silent (no noise + no DSN
  // leak through stack traces in dev tooling).
  enabled: !!process.env.SENTRY_DSN && process.env.NODE_ENV !== 'development',
  release: process.env.SENTRY_RELEASE, // = git SHA, set by deploy.yml
  // Trace 10% of requests — keeps us under the 10k spans/mo free-tier
  // quota at realistic KuanaData traffic.
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Skip 4xx — those are client errors, not bugs worth alerting on.
    const status = (event.contexts?.response as { status_code?: number } | undefined)?.status_code;
    if (status === 401 || status === 404 || status === 422) return null;
    return event;
  },
});

import { serve } from '@hono/node-server';
import { app } from './app';
import { pool } from './db/client';
import { recoverOrphanedRuns } from './features/reports';
import { startTokenRevocationListener } from './lib/token-revocation';

// Port + bind. Production: PM2's `ecosystem.config.cjs` picks a free
// slot (8001 or 8002) from the blue-green pool and injects it as
// `PORT`. Dev: default 8100.
//
// nginx in front of the Droplet owns :80/:443 and load-balances
// between the two slots (see /etc/nginx/sites-enabled/kuana-data).
// One slot is always serving; deploys start the NEW slot, health-check,
// then kill OLD. nginx's `max_fails=1 fail_timeout=5s` handles the
// instant when OLD dies — new connections fall back to NEW automatically.
const PORT = Number(process.env.PORT) || 8100;
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  // Access tokens are verified from their claims, so a permission or
  // status change has to invalidate tokens already in the wild. This
  // LISTENs on `perm_changed` (fired by every perm mutation) and
  // blacklists the affected user until their next refresh. Started before
  // serve() so no request is ever handled without the blacklist active.
  await startTokenRevocationListener();

  // Ping the Postgres pool so the app fails fast on bad DATABASE_URL.
  // Done BEFORE serve() binds so the health check in the deploy
  // workflow doesn't see a 200 from an instance that can't actually
  // talk to the database.
  await pool.query('SELECT 1');
  console.log('📦 Postgres connection ready');
  console.log(`🚀 Server:        http://${HOST}:${PORT}`);
  console.log(`📚 API Reference: http://${HOST}:${PORT}/reference`);
  console.log(`📄 OpenAPI JSON:  http://${HOST}:${PORT}/doc`);
  console.log(`🔐 Auth:          http://${HOST}:${PORT}/api/auth`);

  // Flip any report runs left in queued/running back to failed — the
  // previous process died before they finished. Cheap single UPDATE,
  // keeps the FE polling loop from spinning on orphaned runs.
  const recovered = await recoverOrphanedRuns();
  if (recovered > 0) {
    console.log(`📋 Recovered ${recovered} orphaned report run(s) → failed`);
  }

  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
}

start().catch(async (err) => {
  console.error(err);
  // Boot failures (DB ping, startSchedulers, serve) are a handled
  // rejection here, so Sentry's global unhandledRejection hook never
  // fires — capture + flush explicitly before the process exits.
  Sentry.captureException(err);
  await Sentry.flush(2000);
  process.exit(1);
});
