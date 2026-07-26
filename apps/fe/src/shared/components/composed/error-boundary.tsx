import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/shared/lib/error-reporting';
import { isChunkLoadError, reloadOnceForChunkError } from '@/shared/lib/lazy-with-retry';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Replaces `Sentry.ErrorBoundary` so the Sentry
 * SDK can be lazy-loaded off the critical path — this catches synchronously
 * and forwards to `reportError`, which is a no-op until Sentry has loaded
 * (prod only). Fallback UI matches the previous inline version.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // A missing route chunk is a build-artefact mismatch (dev rebuild /
    // prod redeploy), not an app crash: reload instead of reporting it.
    // Returns false once the reload has already been tried, and we fall
    // through to the normal report + fallback UI.
    if (reloadOnceForChunkError(error)) return;
    reportError(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // `React.lazy` caches a rejected payload forever, so "Retry" can't
    // recover a failed chunk — re-rendering hits the same rejection. Send
    // the user to a reload instead, and say why.
    const chunkError = isChunkLoadError(error);
    return (
      <div
        style={{
          padding: 24,
          maxWidth: 480,
          margin: '64px auto',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ color: '#b04040' }}>
          {chunkError ? 'This page failed to load' : 'Something went wrong'}
        </h1>
        <p>
          {chunkError
            ? 'Part of the app could not be downloaded — usually because a new version was deployed while this tab was open. Reloading picks up the new build.'
            : 'The error has been reported. Try refreshing the page, or click below to retry.'}
        </p>
        <pre
          style={{
            background: '#f3f3f3',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            overflow: 'auto',
          }}
        >
          {error.message ?? String(error)}
        </pre>
        <button type="button" onClick={chunkError ? () => window.location.reload() : this.reset}>
          {chunkError ? 'Reload' : 'Retry'}
        </button>
      </div>
    );
  }
}
