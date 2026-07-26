/**
 * Post-load route warm-up.
 *
 * Every registered route is warmed automatically once the CURRENT screen
 * has finished loading — the page's JS/CSS chunk plus its default
 * (page 1, no filter) SWR list + stat-card data. By the time the user
 * reaches for the sidebar the target route already renders from cache,
 * with no per-link hover heuristics and no work wasted on links the
 * pointer merely crossed on its way somewhere else.
 *
 * Pacing is the whole point — a blind "warm everything on mount" sweep
 * would fight the current screen for the main thread and the connection
 * pool, making the page the user is actually looking at slower:
 *   - Starts only after `window.load`, so the current navigation's own
 *     CSS / JS / images are done first.
 *   - Drains in small idle-scheduled slices (one chunk + one data call
 *     per slice) instead of firing ~30 imports at once.
 *   - Ordered by route declaration, which follows sidebar order, so the
 *     likeliest next screens land first.
 *
 * Best-effort by construction: chunk loaders memoise their import and
 * data preloads go through `quietFetch`, so a failed speculative warm
 * costs nothing and never surfaces to the user.
 */

import { preloadWhenIdle, routePreloaders } from './lazy-route';
import { routeDataPreloaders } from './route-data-prefetch';

/** Tasks per idle slice. Two keeps a slice short (typically one chunk
 *  request + one list request) while still draining the full route table
 *  in a few seconds of idle time. */
const SLICE = 2;

function buildQueue(currentPath: string): Array<() => unknown> {
  const queue: Array<() => unknown> = [];
  // The screen the user is on is already loading its own chunk + data —
  // re-warming it would just duplicate those requests.
  const skip = (path: string) => path === currentPath;
  for (const [path, loadChunk] of routePreloaders) {
    if (skip(path)) continue;
    queue.push(loadChunk);
    const loadData = routeDataPreloaders[path];
    if (loadData) queue.push(loadData);
  }
  // Data-only paths — a list endpoint whose page chunk isn't registered
  // under the same path (VD detail-only routes) still gets warmed.
  for (const [path, loadData] of Object.entries(routeDataPreloaders)) {
    if (!routePreloaders.has(path) && !skip(path)) queue.push(loadData);
  }
  return queue;
}

/**
 * Kick off the warm-up. Call from an authenticated shell — the data half
 * hits protected endpoints, so running it on the guest screens would just
 * fire 401s. Returns a cancel function for the effect cleanup.
 *
 * One-shot by design: the sweep covers the whole route table, so there is
 * nothing left for a per-navigation re-run to do. The landing route is
 * read straight off `location` (rather than taken as a prop) so callers
 * don't have to thread a router value through a mount-only effect.
 */
export function warmRoutesAfterLoad(): () => void {
  // No-op in dev. rspack's lazy compilation only builds a route when it is
  // first imported — that's the point of it — so sweeping every route on
  // each page load compiles the whole app, makes every later HMR rebuild
  // heavier, and widens the window in which a tab holds chunk ids the next
  // rebuild invalidates (the "page failed to load" class of error). The
  // warm-up is a production nicety; verify it with `bun run build` +
  // preview rather than in the dev server.
  if (import.meta.env.MODE === 'development') return () => {};

  const queue = buildQueue(window.location.pathname);
  let cancelled = false;
  let cancelIdle: (() => void) | null = null;

  const drain = () => {
    if (cancelled) return;
    for (const task of queue.splice(0, SLICE)) {
      try {
        // Swallow both shapes of failure: a sync throw and a rejected
        // import/fetch promise (offline, stale deploy hash).
        Promise.resolve(task()).catch(() => {});
      } catch {
        // ignore — speculative work is never worth an error path
      }
    }
    if (queue.length > 0) cancelIdle = preloadWhenIdle([drain]);
  };

  const begin = () => {
    cancelIdle = preloadWhenIdle([drain]);
  };

  // `complete` already covers every client-side navigation after the
  // first — there the idle callback alone is the "screen settled" signal.
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });

  return () => {
    cancelled = true;
    window.removeEventListener('load', begin);
    cancelIdle?.();
  };
}
