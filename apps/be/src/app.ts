/**
 * Hono app composition. Exported as `app` so the test runner can call
 * `app.fetch(req)` directly without spinning up an HTTP server. The
 * `main.ts` entrypoint imports this and wraps it with `serve()` for
 * the actual dev / prod runtime.
 */

import { serveStatic } from '@hono/node-server/serve-static';
import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import * as Sentry from '@sentry/bun';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { auth } from './auth';
import { auditRoutes } from './features/audit/index';
import { clmrsRoutes } from './features/clmrs/index';
import { coachingRoutes } from './features/coaching/index';
import { cooperativesRoutes } from './features/cooperatives/index';
import { farmersRoutes } from './features/farmers/index';
import { generalRoutes } from './features/general/index';
import { inspectionsRoutes } from './features/inspections/index';
import { integrationsRoutes } from './features/integrations/index';
import { notificationsRoutes } from './features/notifications/index';
import { parcelsRoutes } from './features/parcels/index';
import { permissionsRoutes } from './features/permissions/index';
import { primaryEvacRoutes } from './features/primary-evacuation/index';
import { purchaseRoutes } from './features/purchases/index';
import { reportsRoutes } from './features/reports/index';
import { rolesRoutes } from './features/roles/index';
import { secondaryEvacRoutes } from './features/secondary-evacuation/index';
import { shadeTreesRoutes } from './features/shade-trees/index';
import { trainingRoutes } from './features/training/index';
import { usersRoutes } from './features/users/index';
import { vslaRoutes } from './features/vsla/index';
import {
  ACCESS_COOKIE,
  accessCookie,
  accessTokenTtlSeconds,
  clearedAccessCookie,
  mintAccessToken,
  verifyAccessToken,
} from './lib/access-token';
import { notifyPermChanged } from './lib/perm-signal';
import { accessLog } from './middleware/access-log';
import { rateLimit } from './middleware/rate-limit';
import { validationHook } from './middleware/validation-hook';

export const app = new OpenAPIHono({ defaultHook: validationHook });

// Access log — first thing so we capture every request, including
// those that bail out early in auth/CORS/body-limit. The middleware
// itself is non-blocking: it runs `await next()`, then appends one
// NDJSON line to `/var/log/impact-cocoa/access.log` after the route
// has finished. See `middleware/access-log.ts` for the format.
app.use('*', accessLog);

// Security headers — set on every response. Picks defaults that match
// modern OWASP guidance:
//   - X-Frame-Options: DENY  → blocks every <iframe> embed (clickjacking).
//   - X-Content-Type-Options: nosniff  → browsers respect declared MIME.
//   - Strict-Transport-Security: 1y + preload  → enforces HTTPS once seen.
//   - Referrer-Policy: strict-origin-when-cross-origin → no leaking
//     full URLs (incl. tokens) to third parties via Referer.
//   - Cross-Origin-Opener-Policy: same-origin → window.opener isolation.
//   - X-Permitted-Cross-Domain-Policies: none → blocks Flash/PDF embeds.
// `contentSecurityPolicy: false` because the FE bundle already ships
// its own CSP via the index.html meta tag (Rsbuild output) — declaring
// it here too would double the header and cause stricter-of-two behaviour
// the FE author can't predict. Wire CSP from the FE side instead.
app.use(
  '*',
  secureHeaders({
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginOpenerPolicy: 'same-origin',
    xPermittedCrossDomainPolicies: 'none',
    // X-XSS-Protection is deprecated by modern browsers in favour of CSP.
    xXssProtection: '0',
    // CSP intentionally not configured here — the FE bundle ships its
    // own via the index.html meta tag (Rsbuild output), so declaring
    // a server-side default would double the header and force whichever
    // is stricter at the browser. Wire CSP from the FE side instead.
  }),
);

// Hard cap request body size — protects against payload DoS that would
// otherwise pin the BE on JSON.parse / bcrypt for huge inputs. 1 MiB
// covers every JSON write today (the largest is the Permission catalog
// admin import which sits well under). GeoJSON routes are exempted
// because farm shapefiles routinely exceed 1MB.
app.use('*', async (c, next) => {
  // import-geojson streams its own parse (50MB limit enforced inside),
  // so we bypass Hono's body limit parser entirely.
  if (c.req.path === '/api/parcels/import-geojson') {
    return next();
  }

  // validate-geojson-ids accepts large feature IDs array, cap it explicitly at 50MB.
  if (c.req.path === '/api/parcels/validate-geojson-ids') {
    return bodyLimit({
      maxSize: 50 * 1024 * 1024,
      onError: (c) => c.json({ error: 'Payload too large (max 50MB)' }, 413),
    })(c, next);
  }

  return bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  })(c, next);
});

// CORS allowlist — comma-separated `FE_URL` env (one URL each). In
// production where FE and BE share the same origin (served from the
// same Hono process via the static handler below) CORS never trips on
// real traffic, but the allowlist still gates direct browser tools.
// Required — set in apps/be/.env. No code-level fallback so a missing
// env var fails loudly at boot instead of silently allowing only
// localhost in production.
const feUrlEnv = process.env.FE_URL;
if (!feUrlEnv) {
  throw new Error(
    'FE_URL is required. Set it in apps/be/.env (comma-separated for multiple origins).',
  );
}
const corsOrigins = feUrlEnv
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  '*',
  cors({
    origin: corsOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

// Throttle credential-stuffing on the auth-credential endpoints only.
// 20 attempts per IP per minute is generous for legitimate users
// (typo recovery, magic-link request, password reset) and tight
// enough to make a brute-force script useless. Better-auth itself
// does NOT ship a rate limiter; this is the only line of defense
// before the bcrypt compare. Better-auth's CSRF check (via
// trustedOrigins) still runs after this on POST.
//
// IMPORTANT: the limiter is scoped to credential-sensitive routes,
// NOT all of `/api/auth/*`. The previous catch-all caused 429s in
// normal use because `/api/auth/get-session` fires on every page
// mount + focus and quickly drained the 10-req budget on the same
// IP that was also trying to sign in.
app.use(
  '/api/auth/sign-in/*',
  rateLimit({ keyPrefix: 'auth-signin', limit: 20, windowMs: 60_000 }),
);
app.use(
  '/api/auth/sign-up/*',
  rateLimit({ keyPrefix: 'auth-signup', limit: 10, windowMs: 60_000 }),
);
app.use(
  '/api/auth/forget-password',
  rateLimit({ keyPrefix: 'auth-forgot', limit: 5, windowMs: 60_000 }),
);
app.use(
  '/api/auth/reset-password',
  rateLimit({ keyPrefix: 'auth-reset', limit: 10, windowMs: 60_000 }),
);
app.use('/api/auth/magic-link', rateLimit({ keyPrefix: 'auth-magic', limit: 5, windowMs: 60_000 }));

// ── Token refresh ────────────────────────────────────────────────────
// Registered BEFORE the better-auth catch-all below, or the wildcard
// would swallow it. Exchanges the session cookie (the refresh credential)
// for a fresh access token: the session is checked against the DB, so a
// signed-out, deleted or deactivated user cannot renew, and the new token
// carries the CURRENT permission set — which is how a revoked token turns
// back into a working one after a role change.
app.post('/api/auth/refresh', async (c) => {
  const token = await mintAccessToken(c.req.raw.headers);
  if (!token) {
    // Refresh credential is gone/invalid → the client must sign in again.
    // Clear the stale access cookie so it stops being sent.
    c.header('Set-Cookie', clearedAccessCookie(), { append: true });
    return c.json({ error: 'Unauthorized', code: 'refresh_failed' }, 401);
  }
  c.header('Set-Cookie', accessCookie(token), { append: true });
  return c.json({ ok: true, expiresIn: accessTokenTtlSeconds() }, 200);
});

// Better Auth routes — use Hono's wildcard matcher (`*`) not `**`; the
// double-star is a different framework convention and silently produces
// no matches in Hono's regex router after the tsconfig `module: ESNext`
// switch.
//
// Wrapped rather than passed straight through so the access token rides
// along with better-auth's own cookies:
//   sign-in / magic-link callback → mint + set the access cookie, so the
//     very first authenticated request already has one
//   sign-out                      → expire it, otherwise a signed-out tab
//     keeps a valid (still-signature-checking) token until it lapses
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const res = await auth.handler(c.req.raw);
  const path = new URL(c.req.url).pathname;

  if (path.startsWith('/api/auth/sign-out')) {
    // Clearing the cookie only stops THIS browser from sending the token —
    // a copy lifted from devtools would still verify until it expires. So
    // blacklist the user too, which also drops their SSE connections.
    // Verified (not just decoded) so a forged cookie can't be used to
    // blacklist somebody else.
    const token = getCookie(c, ACCESS_COOKIE);
    if (token) {
      const verified = await verifyAccessToken(token);
      if (verified.ok) await notifyPermChanged(verified.claims.sub);
    }
    const out = new Response(res.body, res);
    out.headers.append('Set-Cookie', clearedAccessCookie());
    return out;
  }

  // Only mint when better-auth actually issued a session on this response.
  // `getSetCookie()` is the only reliable signal — the same handler serves
  // ~20 endpoints and most of them must not touch the access cookie.
  const issuedSession = res.headers
    .getSetCookie()
    .some((ck) => ck.startsWith('better-auth.session_token=') && !/session_token=;/.test(ck));
  if (!res.ok || !issuedSession) return res;

  // Mint against the session that was just issued: it exists in the
  // RESPONSE, not the request, so hand its cookie pair to the mint call.
  const sessionCookie = res.headers
    .getSetCookie()
    .map((ck) => ck.split(';')[0])
    .join('; ');
  const token = await mintAccessToken(new Headers({ cookie: sessionCookie }));
  if (!token) return res;

  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', accessCookie(token));
  return out;
});

// Feature routes
app.route('/', generalRoutes);
app.route('/', permissionsRoutes);
app.route('/', rolesRoutes);
app.route('/', usersRoutes);
app.route('/', cooperativesRoutes);
app.route('/', farmersRoutes);
app.route('/', parcelsRoutes);
app.route('/', auditRoutes);
app.route('/', notificationsRoutes);
app.route('/', inspectionsRoutes);
app.route('/', coachingRoutes);
app.route('/', integrationsRoutes);
app.route('/', clmrsRoutes);
app.route('/', trainingRoutes);
app.route('/', purchaseRoutes);
app.route('/', primaryEvacRoutes);
app.route('/', secondaryEvacRoutes);
app.route('/', shadeTreesRoutes);
app.route('/', vslaRoutes);
app.route('/', reportsRoutes);

// OpenAPI JSON spec + interactive Scalar viewer.
//
// Gated on local dev only. The schema documents every endpoint,
// parameter shape, and the entire authz model — useful for devs /
// SDK regen, but staging + prod expose it and an attacker's recon
// drops from minutes (poking endpoints) to seconds (reading the
// JSON). Staging is internet-reachable, so it behaves like prod
// for this surface. If staging/prod tooling needs the schema,
// regenerate the FE SDK from a snapshot file rather than hitting
// the live BE.
if (process.env.NODE_ENV === 'development') {
  // Server URL shown in the OpenAPI viewer — pull from BACKEND_URL
  // (or fall back to BETTER_AUTH_URL, which always equals the public
  // BE base in our deploys). Dev .env sets BACKEND_URL to the local
  // BE address.
  const docServerUrl = process.env.BACKEND_URL ?? process.env.BETTER_AUTH_URL ?? '';
  app.doc('/doc', {
    openapi: '3.0.0',
    info: {
      title: 'Think!Cocoa API',
      version: '1.0.0',
      description: 'Think!Cocoa — Cocoa Traceability Platform API',
    },
    servers: docServerUrl ? [{ url: docServerUrl, description: 'Backend' }] : [],
  });

  app.get(
    '/reference',
    apiReference({
      url: '/doc',
      title: 'CocoaImpact API Reference',
      theme: 'kepler',
    }),
  );
}

// ── FE static fallback ───────────────────────────────────────────────
// In production (single-tunnel deploy), this same Bun process serves
// the FE bundle so Cloudflare Tunnel only has to route one origin.
// `FE_DIST` points to the absolute path of `apps/fe/dist`; when unset
// (dev), neither handler is registered and the FE keeps running on its
// own Vite dev server.
//
// Order matters: every `/api/*`, `/doc`, and `/reference` route above
// already had its chance to match. Anything that falls through here is
// either a real static asset (JS/CSS/image) or an SPA route that needs
// `index.html` for client-side React Router to take over.
const feDist = process.env.FE_DIST;
if (feDist) {
  app.use(
    '/*',
    serveStatic({
      root: feDist,
      // serveStatic resolves paths relative to CWD by default; passing the
      // file URL through rewriteRequestPath lets us point at an absolute
      // path regardless of where the BE was started from.
      rewriteRequestPath: (p) => p,
    }),
  );
  // SPA fallback — any unmatched path returns the FE shell so React
  // Router can render the correct route on the client.
  app.get('*', serveStatic({ root: feDist, path: 'index.html' }));
}

// 404 — only reached for /api/* paths that no route claimed, since
// the FE static handler above absorbs everything else when enabled.
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Catch-all error handler — anything that throws past a route handler
// lands here. Logs an NDJSON line to stderr (PM2 routes that to
// `/var/log/impact-cocoa/error.log`) with route + user context so it's
// greppable later, then returns a generic 500 to the client.
//
// `console.error` is used instead of a write-stream because PM2 already
// captures stderr into a rotated file — adding a second sink would
// double-log. When Sentry lands, swap this to
// `Sentry.captureException(err, { user, tags })` and keep the stderr
// fallback for offline debugging.
app.onError((err, c) => {
  const user = (c.var as { user?: { id?: string; email?: string } }).user;
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      level: 'error',
      msg: err.message,
      name: err.name,
      stack: err.stack,
      route: c.req.path,
      method: c.req.method,
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
    }),
  );

  // Forward to Sentry with route + user context. `captureException`
  // is a no-op when SENTRY_DSN is unset, so dev runs are silent.
  Sentry.captureException(err, {
    tags: { route: c.req.path, method: c.req.method },
    user: user ? { id: user.id ?? undefined, email: user.email ?? undefined } : undefined,
  });

  return c.json({ error: 'Internal Server Error' }, 500);
});
