import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Generates the ThinkCocoa BE API client.
 *
 * Input: `src/openApi/think-cocoa-client/schema.json` (refreshed via
 * `bun run think-cocoa-client:snapshot` — requires BE running on :8000).
 * Output: `src/openApi/think-cocoa-client/generated/` — do not hand-edit.
 *
 * Consumers import from `@thinkcocoa/shared/think-cocoa-client`.
 */
export default defineConfig({
  input: './src/openApi/think-cocoa-client/schema.json',
  output: './src/openApi/think-cocoa-client/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
