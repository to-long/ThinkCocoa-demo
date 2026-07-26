/**
 * Public facade for the KoboToolbox API client.
 *
 * Usage:
 *   import { client, <sdkFn> } from '@cocoaimpact/shared/kobo-client';
 *   import type { ... } from '@cocoaimpact/shared/kobo-client';
 *
 * The default `client` from the generated code carries Kobo's base URL
 * (https://kf.kobotoolbox.org). Callers who need a different deployment can
 * call `client.setConfig({ baseUrl, headers })` at startup.
 *
 * Regenerate:
 *   bun run kobo-client:refresh    # download + format + regenerate
 * Do not hand-edit anything in `./generated/`.
 */

export { client } from './generated/client.gen';
export * from './generated/sdk.gen';
export type * from './generated/types.gen';
