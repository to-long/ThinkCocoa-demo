/**
 * Lazy Sentry loader.
 *
 * `@sentry/react` (with browser-tracing + replay) is ~500 kB — putting
 * it on the initial critical path just to have it *available* is wasteful,
 * especially since it only activates in production builds with a DSN set.
 * So we dynamically import it after first paint (prod + DSN only). Dev and
 * DSN-less builds never download the Sentry chunk at all.
 *
 * `reportError` is a no-op until (and unless) the SDK has loaded, so the
 * custom `ErrorBoundary` can call it unconditionally.
 */

type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;

export async function initErrorReporting(): Promise<void> {
  const dsn = import.meta.env.PUBLIC_SENTRY_DSN as string | undefined;
  // Same guard the eager init used — silent in dev / DSN-less builds.
  if (!dsn || import.meta.env.MODE !== 'production') return;
  const S = await import('@sentry/react');
  S.init({
    dsn,
    environment: import.meta.env.PUBLIC_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.PUBLIC_SENTRY_RELEASE,
    integrations: [
      S.browserTracingIntegration(),
      S.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.05,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  sentry = S;
}

/** Report a caught error to Sentry when it has loaded; no-op otherwise. */
export function reportError(error: unknown): void {
  sentry?.captureException(error);
}
