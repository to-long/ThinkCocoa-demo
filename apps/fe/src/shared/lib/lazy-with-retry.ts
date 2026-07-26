/**
 * `React.lazy` + recovery for "the JS chunk isn't there any more".
 *
 * Route pages and dashboard tabs are lazy `import()`s, so their chunks are
 * fetched at click time. That request legitimately 404s while a tab is
 * open:
 *
 *   - dev: rspack lazy-compilation only builds a route when it's first
 *     imported, and a rebuild (any file save) invalidates the chunk ids
 *     the already-loaded page was holding.
 *   - prod: a redeploy replaces content-hashed filenames, so a tab opened
 *     before the deploy asks for files that no longer exist.
 *
 * Plain `lazy()` handles this badly: it records a rejected payload
 * permanently, so the error boundary's "Retry" re-renders the same
 * component and hits the same rejection — the route stays dead until a
 * manual refresh. Recovery is therefore staged, cheapest first:
 *
 *   1. RE-IMPORT in place. A dropped request, a connection reset on
 *      tab-resume, a chunk still being written — all recover by simply
 *      asking again, and the user sees nothing but the Suspense fallback.
 *      This is the case worth optimising for: no reload, no lost form state,
 *      no scroll position thrown away.
 *   2. Only if the second attempt fails too is the artefact genuinely gone
 *      (redeploy renamed it, or its module id no longer exists in this
 *      compilation). Nothing in-page can fix that, so reload once — with a
 *      `sessionStorage` stamp + cooldown so a broken build can't loop.
 *   3. While that reload is in flight, return a promise that never settles
 *      so Suspense keeps its fallback instead of flashing the error UI.
 *
 * In dev the step-2 case is designed out rather than handled: lazy
 * compilation is off (see `rsbuild.config.ts`), so module ids don't go
 * missing under a running tab in the first place.
 */

import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

const CHUNK_ERROR_RE =
  // Two families, both meaning "the build artefacts moved under this tab":
  //   fetch failures  — the chunk request itself 404s / aborts
  //   graph failures  — the chunk loads but its module id is gone, which
  //                     rspack surfaces as `factory is undefined` and
  //                     webpack as a missing module factory. These throw
  //                     synchronously inside the module evaluation, so
  //                     without them here they reached the error boundary
  //                     as a generic crash with an unusable Retry.
  /loading chunk|chunkloaderror|loading css chunk|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to fetch|factory is undefined|cannot read propert(?:y|ies) of undefined \(reading 'call'\)/i;

const STAMP_KEY = 'thinkcocoa-chunk-reload-at';
/** Two reloads closer together than this are a loop, not a retry. */
const COOLDOWN_MS = 10_000;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return CHUNK_ERROR_RE.test(message);
}

/**
 * Reload the page for a stale-chunk failure, unless we just did.
 * Returns false when the cooldown blocks it, so the caller can surface the
 * error instead of silently doing nothing.
 */
export function reloadOnceForChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(STAMP_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false;
    sessionStorage.setItem(STAMP_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled: one reload attempt still beats a
    // dead route, we just can't dedupe it.
  }
  window.location.reload();
  return true;
}

// biome-ignore lint/suspicious/noExplicitAny: mirrors React.lazy's own signature
type AnyComp = ComponentType<any>;

/**
 * Drop-in `lazy()` that reloads the page once when the chunk can't be
 * fetched. Any other rejection (a module that throws at import time, say)
 * propagates untouched to the error boundary.
 */
export function lazyWithRetry<T extends AnyComp>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;

      // Step 1 — ask again. Short pause so a chunk that is mid-write, or a
      // connection that just dropped, has a moment to settle; long enough to
      // matter, short enough that the user reads it as loading.
      await new Promise((r) => setTimeout(r, 300));
      try {
        return await factory();
      } catch (retryErr) {
        if (!isChunkLoadError(retryErr)) throw retryErr;
        // Step 2 — the artefact really is gone. Reload, or surface it if we
        // already tried that recently.
        if (!reloadOnceForChunkError(retryErr)) throw retryErr;
        // Step 3 — hold the Suspense fallback while the document is replaced.
        return new Promise<{ default: T }>(() => {});
      }
    }
  });
}
