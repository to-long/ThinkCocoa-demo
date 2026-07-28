/**
 * Route-level code splitting helper.
 *
 * `lazyRoute(factory, name)` wraps a named page export in `React.lazy`
 * so each route ships as its own chunk (heavy deps like leaflet /
 * chart.js ride along in the chunk of the page that uses them instead
 * of the initial bundle).
 *
 * The returned component also carries a `.preload()` method + registers
 * itself in `routePreloaders` keyed by path, so a chunk can be warmed
 * ahead of navigation. The consumer is `route-warmup`, which drains the
 * whole registry on idle once the current screen has loaded — the
 * Next.js `<Link prefetch>` feel without a router framework, and without
 * hanging speculative work off pointer events.
 *
 * Every lazy component in the app is created here (33 route pages +
 * the dashboard tabs), so this is also the single place that needs
 * stale-chunk recovery — hence `lazyWithRetry` instead of bare `lazy`.
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import { lazyWithRetry } from './lazy-with-retry';

// biome-ignore lint/suspicious/noExplicitAny: registry holds heterogeneous page components
type AnyComp = ComponentType<any>;

export interface PreloadableComponent<T extends AnyComp> extends LazyExoticComponent<T> {
  preload: () => Promise<unknown>;
}

/** path → chunk preloader, populated as routes are declared. */
export const routePreloaders = new Map<string, () => Promise<unknown>>();

export function lazyRoute<M, K extends keyof M>(
  factory: () => Promise<M>,
  name: K,
  path?: string,
): PreloadableComponent<M[K] extends AnyComp ? M[K] : AnyComp> {
  // Cache the in-flight import so preload + first render share one promise.
  let promise: Promise<M> | null = null;
  const load = () => {
    promise ??= factory().catch((err) => {
      // A FAILED import must not stay cached. Chunk requests do fail in
      // normal operation — a dev rebuild invalidates rspack's
      // lazy-compilation chunks, and a production redeploy renames the
      // content-hashed files out from under an already-open tab. Keeping
      // the rejected promise meant every later attempt replayed the same
      // failure, so a route stayed broken for the rest of the session.
      promise = null;
      throw err;
    });
    return promise;
  };
  // Page modules may also export non-component members (types are erased,
  // but consts/hooks aren't) — select the named export and treat it as the
  // route component.
  const Comp = lazyWithRetry(() =>
    load().then((m) => ({ default: m[name] as AnyComp })),
  ) as PreloadableComponent<M[K] extends AnyComp ? M[K] : AnyComp>;
  Comp.preload = load;
  if (path) routePreloaders.set(path, load);
  return Comp;
}

/** Warm a set of chunks / caches when the browser is idle (falls back to
 *  a short timeout where `requestIdleCallback` is unavailable, e.g.
 *  Safari). Loaders may return a promise or nothing. */
export function preloadWhenIdle(loaders: Array<() => unknown>): () => void {
  const run = () => {
    for (const load of loaders) void load();
  };
  const ric = (
    globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;
  if (ric) {
    const id = ric(run, { timeout: 2000 });
    return () =>
      (globalThis as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(
        id,
      );
  }
  const t = setTimeout(run, 1200);
  return () => clearTimeout(t);
}
