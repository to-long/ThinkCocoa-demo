import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Generates the KoboToolbox API client.
 *
 * Input: `src/openApi/kobo-client/schema.yaml` (refreshed via
 * `bun run kobo-client:snapshot`).
 * Output: `src/openApi/kobo-client/generated/` — do not hand-edit.
 *
 * Consumers import from `@kuanadata/shared/kobo-client`.
 */
export default defineConfig({
  input: './src/openApi/kobo-client/schema.yaml',
  output: './src/openApi/kobo-client/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
