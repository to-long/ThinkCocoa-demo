/**
 * Regenerates `packages/shared/src/constants/permissions.ts` from the
 * current state of the `iam.permissions` table.
 *
 * Why this exists:
 *   Admins can add new permissions at runtime via `POST /api/permissions`
 *   (and the batch `/groups` variant). Those inserts live only in the DB
 *   until someone syncs them back into the TypeScript catalog — otherwise
 *   `requirePermission('new:code')` wouldn't type-check.
 *
 *   This script reads the DB → emits a fresh TS file. Commit the diff.
 *
 * Pattern precedent in this repo:
 *   - `packages/shared/openapi-ts.think-cocoa-client.config.ts` → codegens
 *     TS from the BE's live OpenAPI spec. Same idea: runtime source → TS.
 *   - Drizzle-kit `pull` / `introspect` is the same pattern for DB schemas.
 *
 * Run:
 *   bun run sync:permissions        (from apps/be)
 *   make sync-permissions           (from repo root)
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/client';
import { permissions } from '../src/db/schema/iam';

const OUTPUT_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/shared/src/constants/permissions.ts',
);

async function main() {
  const rows = await db
    .select({
      code: permissions.code,
      name: permissions.name,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(permissions.code);

  if (rows.length === 0) {
    console.error(
      'refusing to write: iam.permissions is empty. Run `bun run db:seed` first to bootstrap the catalog.',
    );
    process.exit(1);
  }

  // Group by resource (leading `resource:action` prefix) so the emitted
  // file reads the same way the admin picker renders — makes diff reviews
  // easier to skim.
  const byResource = new Map<string, typeof rows>();
  for (const row of rows) {
    const resource = row.code.split(':')[0] ?? 'misc';
    (byResource.get(resource) ?? byResource.set(resource, []).get(resource)!).push(row);
  }
  // Preserve a stable alphabetical resource order (matches DB ORDER BY code).
  const resources = [...byResource.keys()].sort();

  const emitRow = (r: (typeof rows)[number]) =>
    `  { code: ${JSON.stringify(r.code)}, name: ${JSON.stringify(r.name)}, description: ${JSON.stringify(r.description)} },`;

  const body = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Source of truth: \`iam.permissions\` table in the connected database.
 * Regenerate via \`bun run sync:permissions\` (in apps/be) or
 * \`make sync-permissions\` (repo root).
 *
 * The BE seed (\`apps/be/db/seed/iam.ts\`) reads this file to populate the
 * DB on fresh environments. Admins can then add new permissions via the
 * admin UI — re-running the sync script captures those additions back
 * into this file so the \`PermissionCode\` union stays compile-accurate.
 */

export interface PermissionDefinition {
  code: string;
  name: string;
  description: string | null;
}

// The tuple must stay \`as const\` so TypeScript infers literal types for
// every \`code\`, from which we derive the \`PermissionCode\` union below.
export const PERMISSION_CATALOG = [
${resources
  .map((resource) => {
    const header = `  // ── ${resource} ──`;
    return [header, ...byResource.get(resource)!.map(emitRow)].join('\n');
  })
  .join('\n')}
] as const satisfies readonly PermissionDefinition[];

/**
 * Union of every permission code in the catalog. Use this as the argument
 * type for \`requirePermission()\` on the BE and \`hasPermission()\` on the
 * FE so typos become compile-time errors.
 */
export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];

/** Flat readonly tuple of permission codes (handy for \`inArray\` etc). */
export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CATALOG.map(
  (p) => p.code,
);

/** Resource prefix → ordered list of codes. Used by the admin picker. */
export function permissionsByResource(): Record<string, readonly PermissionCode[]> {
  const out: Record<string, PermissionCode[]> = {};
  for (const p of PERMISSION_CATALOG) {
    const [resource] = p.code.split(':');
    if (!resource) continue;
    (out[resource] ??= []).push(p.code);
  }
  return out;
}
`;

  await writeFile(OUTPUT_PATH, body, 'utf8');
  console.log(
    `wrote ${rows.length} permissions across ${resources.length} resources → ${OUTPUT_PATH}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('sync-permissions failed:', err);
  process.exit(1);
});
