import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';

// Dev-only: proxy `/api` and `/api/auth/*` to the BE so the browser
// issues same-origin requests to `<fe-origin>/api/...` — kills CORS
// and lets better-auth cookies land on the FE origin like prod.
//
// Upstream is the same `PUBLIC_API_URL` env that drives the SDK base
// URL in non-dev builds: one variable, one source of truth. Falls
// back to `http://localhost:8100` when nothing is set.
const isDev = process.env.NODE_ENV !== 'production';
const backendUrl = process.env.PUBLIC_API_URL || 'http://localhost:8100';

// In prod the FE and BE are separate origins, and every page makes API
// calls — warm the TCP+TLS connection early so the first request doesn't
// pay the full handshake RTT. Only emit when the API is a real absolute
// cross-origin URL (dev proxies same-origin, so nothing to preconnect).
function apiOrigin(): string | null {
  if (isDev) return null;
  try {
    return new URL(backendUrl).origin;
  } catch {
    return null;
  }
}
const API_ORIGIN = apiOrigin();
const preconnectTags = API_ORIGIN
  ? [
      {
        tag: 'link',
        attrs: { rel: 'preconnect', href: API_ORIGIN, crossorigin: 'use-credentials' },
      },
      { tag: 'link', attrs: { rel: 'dns-prefetch', href: API_ORIGIN } },
    ]
  : [];

// Security headers shipped both on the Rsbuild dev server (via
// `server.headers`) and as `<meta http-equiv>` tags inside the
// bundled HTML. The meta variant matters because the prod static
// host (PM2 / nginx) is the operator's responsibility and a meta
// CSP fires inside the browser even when the host serves no headers.
//
// CSP notes:
// - `script-src 'self'` blocks inline JS — verified Rsbuild output
//   chunks all scripts to files. Add a nonce/hash if a future plugin
//   needs inline.
// - `style-src 'self' 'unsafe-inline'` — Tailwind/shadcn ship inline
//   styles for component-level customisation. Tightenable to nonce
//   when the build emits one.
// - `connect-src 'self'` — same-origin fetches only. The dev FE proxies
//   /api → BE so this is enough; in prod where FE + BE are separate
//   origins, append the BE URL: `connect-src 'self' https://api.host`.
// - `frame-ancestors 'none'` — modern equivalent of X-Frame-Options
//   DENY; both are sent for legacy-browser coverage.
const CSP =
  "default-src 'self'; " +
  "img-src 'self' data: blob: https://*.google.com https://*.openstreetmap.org; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; " +
  "script-src 'self'; " +
  `connect-src 'self' ${isDev ? backendUrl : ''}`.trim() +
  '; ' +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  plugins: [pluginReact(), pluginSvgr()],
  server: {
    port: Number(process.env.PORT) || 3130,
    headers: SECURITY_HEADERS,
    proxy: isDev
      ? {
          '/api': {
            target: backendUrl,
            changeOrigin: true,
            // Forward `X-Forwarded-For` / `X-Forwarded-Host` so the
            // BE's audit writer captures the client IP even though the
            // request technically originates from the FE dev server.
            xfwd: true,
          },
        }
      : undefined,
  },
  html: {
    title: 'Think!Cocoa',
    favicon: 'public/cocoa-traceability.webp',
    // Meta-tag versions of the same headers — applies in any host
    // setup, including bare static servers without nginx in front.
    // X-Content-Type-Options + Strict-Transport-Security CANNOT be
    // set via meta (browsers ignore them), so prod must also set
    // them via the reverse proxy.
    tags: [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP } },
      { tag: 'meta', attrs: { 'http-equiv': 'X-Frame-Options', content: 'DENY' } },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' } },
      ...preconnectTags,
    ],
  },
  output: {
    manifest: true,
  },
  dev: {
    // Lazy compilation OFF. It is the direct cause of the
    // `factory is undefined` class of runtime error: a route's module is
    // only compiled when first imported, and a rebuild then invalidates the
    // module ids an already-loaded tab is holding — the chunk downloads but
    // its factory is no longer registered, so the import throws while
    // evaluating and no in-page retry can fix it (the id is simply gone from
    // this compilation).
    //
    // Compiling every route up front costs a few seconds on the first dev
    // build and removes the failure mode outright, which is the trade this
    // codebase wants: the alternative was a page reload on every rebuild
    // that happened to touch a lazily-built route.
    lazyCompilation: false,
  },
});
