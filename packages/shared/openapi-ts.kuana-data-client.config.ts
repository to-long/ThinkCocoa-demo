import { defineConfig } from '@hey-api/openapi-ts';

/**
 * Generates the KuanaData BE API client.
 *
 * Input: `src/openApi/kuana-data-client/schema.json` (refreshed via
 * `bun run kuana-data-client:snapshot` — requires BE running on :8000).
 * Output: `src/openApi/kuana-data-client/generated/` — do not hand-edit.
 *
 * Consumers import from `@kuanadata/shared/kuana-data-client`.
 */
export default defineConfig({
  input: './src/openApi/kuana-data-client/schema.json',
  output: './src/openApi/kuana-data-client/generated',
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
