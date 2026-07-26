/**
 * Public facade for the ImpactCocoa BE API client.
 *
 * Usage:
 *   import { client, listUsers, createUser } from '@thinkcocoa/shared/impact-cocoa-client';
 *   import type { User, UserDetail } from '@thinkcocoa/shared/impact-cocoa-client';
 *
 * IMPORTANT: The generated client bakes in `baseUrl: http://localhost:8000`.
 * Apps consuming this should override at startup:
 *
 *   import { client } from '@thinkcocoa/shared/impact-cocoa-client';
 *   client.setConfig({
 *     baseUrl: import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8000',
 *     credentials: 'include',   // better-auth cookie session
 *   });
 *
 * Regenerate:
 *   bun run impact-cocoa-client:refresh   # requires BE running on :8000
 * Do not hand-edit anything in `./generated/`.
 */

export { client } from './generated/client.gen';
export * from './generated/sdk.gen';
export type * from './generated/types.gen';
