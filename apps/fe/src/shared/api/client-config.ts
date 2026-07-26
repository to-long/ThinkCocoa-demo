/**
 * One-shot configuration for the generated `impact-cocoa-client` SDK.
 *
 * Imported for side effect from `src/index.tsx` BEFORE any component is
 * rendered, so every SDK call goes out with the right `baseUrl` and
 * `credentials: 'include'` (better-auth cookie session).
 *
 * Resolution rules:
 *   - Dev (`MODE === 'development'`): empty `baseUrl` → SDK issues
 *     same-origin requests like `GET /api/users`, which the rsbuild
 *     dev server proxies to the BE. Avoids CORS entirely and keeps
 *     better-auth session cookies on the FE origin.
 *   - Anything else: `PUBLIC_API_URL` from the build env is REQUIRED.
 *     No code-level fallback — a missing var should fail the build
 *     loudly rather than silently target localhost in production.
 */

import { client } from '@cocoaimpact/shared/impact-cocoa-client';

const isDev = import.meta.env.MODE === 'development';
const publicApiUrl = import.meta.env.PUBLIC_API_URL as string | undefined;

const baseUrl = isDev
  ? ''
  : (publicApiUrl ??
    (() => {
      throw new Error('PUBLIC_API_URL is required in apps/fe/.env for production builds.');
    })());

client.setConfig({ baseUrl, credentials: 'include' });

export { client };
