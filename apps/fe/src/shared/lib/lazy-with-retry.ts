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
 * manual refresh. A reload IS the fix, so do it automatically:
 *
 *   1. Reload once. A `sessionStorage` stamp + cooldown keeps a chunk that
 *      is genuinely gone (broken build) from putting the tab in a reload
 *      loop — the second failure falls through to the error boundary.
 *   2. While the reload is in flight, return a promise that never settles
 *      so Suspense keeps showing its fallback. Otherwise the error UI
 *      flashes for the moment before the document is replaced.
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
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (!reloadOnceForChunkError(err)) throw err;
      // Reload is underway — never resolve, so Suspense holds its
      // fallback instead of flashing the error boundary.
      return new Promise<{ default: T }>(() => {});
    }),
  );
}
