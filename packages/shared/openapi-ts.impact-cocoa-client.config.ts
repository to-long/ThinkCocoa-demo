import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Generates the ImpactCocoa BE API client.
 *
 * Input: `src/openApi/impact-cocoa-client/schema.json` (refreshed via
 * `bun run impact-cocoa-client:snapshot` — requires BE running on :8000).
 * Output: `src/openApi/impact-cocoa-client/generated/` — do not hand-edit.
 *
 * Consumers import from `@cocoaimpact/shared/impact-cocoa-client`.
 */
export default defineConfig({
  input: './src/openApi/impact-cocoa-client/schema.json',
  output: './src/openApi/impact-cocoa-client/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
