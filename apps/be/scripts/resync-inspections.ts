/**
 * One-shot helper: trigger an inspection sync from the CLI.
 *
 * Useful after a destructive migration that truncates the inspection
 * table — instead of asking the user to click the Sync button in the
 * UI, run:
 *
 *   bun run scripts/resync-inspections.ts
 *
 * Calls the same `runSync('internal_inspection')` the route handler
 * uses, so behaviour matches exactly.
 */

import { runSync } from '../src/features/integrations/service';

const r = await runSync('internal_inspection');
console.log(JSON.stringify(r, null, 2));
process.exit(0);
