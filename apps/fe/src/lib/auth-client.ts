import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Dev: hit the FE origin so the rsbuild proxy forwards `/api/auth/*`
// to the BE — keeps cookies same-origin. Build-time env still wins
// in any other environment so prod / staging point at their own
// API host. `window` guard keeps SSR-safe.
const isDev = import.meta.env.MODE === 'development';

// PUBLIC_API_URL must be set at build time via apps/fe/.env (or the
// shell env passed to `bun run build`). No code-level fallback —
// a misconfigured build should fail fast, not silently target
// localhost in production.
const publicApiUrl = import.meta.env.PUBLIC_API_URL as string | undefined;
const baseURL = isDev
  ? typeof window !== 'undefined'
    ? window.location.origin
    : ''
  : (publicApiUrl ??
    (() => {
      throw new Error('PUBLIC_API_URL is required in apps/fe/.env for production builds.');
    })());

export const authClient = createAuthClient({
  baseURL,
  // `credentials: 'include'` is mandatory: better-auth issues a
  // `__Secure-thinkcocoa.session_token` cookie on the BE origin
  // and every subsequent request (get-session, sign-out, every
  // /api/* call gated by `requireAuth`) needs the browser to send
  // it back. Without this, fetch defaults to `same-origin` in dev
  // (works) but resolves to `omit` for `createAuthClient`'s own
  // requests in production builds because the SDK's `fetch`
  // wrapper doesn't infer credentials from the baseURL — hence the
  // 401 cascade after a successful sign-in.
  fetchOptions: { credentials: 'include' },
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
