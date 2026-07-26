# ThinkCocoa — Claude playbook

Repo-specific conventions Claude needs to remember across sessions.

## Database migrations — ALWAYS test before committing

Whenever a change touches **any of these**:

- `apps/be/db/drizzle/*.sql` (new or edited migration files)
- `apps/be/db/drizzle/meta/*.json` (drizzle journal / snapshot)
- `apps/be/src/db/schema/*.ts` (drizzle schema)
- `apps/be/db/seed/*.ts` (the seed orchestrator)

run the migration test BEFORE committing:

```bash
cd apps/be && bun run db:test-migrations
```

What it does (`apps/be/scripts/test-migrations.sh`):

1. Spins up a throwaway Postgres container (`thinkcocoa-demo-migration-test`) on **port 5540** so it can't disturb the dev DB on 5539.
2. Applies every migration from scratch on the empty DB. Catches:
   - drizzle-generated SQL that doesn't actually apply (typos, FK
     ordering, wrong dialect bits)
   - Manually-authored SQL files that reference missing tables
3. Re-applies the same migrations a second time to verify
   **idempotency** — must succeed without error. Catches:
   - Missing `IF NOT EXISTS` on `CREATE`
   - Seed inserts that don't have `ON CONFLICT DO NOTHING`
4. Cleans up the container on exit (success or failure).

Runtime ~15 seconds. The script `set -e`s aggressively so any failing
step halts loudly with the actual error.

If the test fails, read the output to determine whether to:

- Fix the migration SQL (DDL bug)
- Add an `ON CONFLICT` clause (seed not idempotent)
- Re-run drizzle-kit generate (drifted snapshot)

Never commit a migration without seeing `✅ migrations apply cleanly + are idempotent` from this script.

## E2E tests — ALWAYS run on the ephemeral test DB

**Default**: `make test` (or `cd apps/be && bun run test`).

What it does (`apps/be/scripts/run-tests.sh`):

1. Spins up a throwaway Postgres container (`thinkcocoa-demo-test-db`) on
   **port 5541** — separate from dev (5539) and migration-test (5540).
2. Migrates + seeds the test DB (default seeds + `system.admin@…`,
   skips farmers/audit-logs to keep startup fast).
3. Sets `DATABASE_URL` for the test container, then runs `bun test
   src/__tests__`.
4. Tears the container down on exit (pass OR fail) via `trap EXIT`.

Runtime ~15 seconds. **Never wipes dev data even if a test crashes
mid-run** — the whole DB is thrown away regardless.

The legacy "run against the dev DB" path is still available as
`bun run test:dev-db` but should NOT be used routinely — a crashed
test leaves stragglers in `iam.cooperatives`, `iam.users`,
`farmer.farmers` keyed by the `_${SUFFIX}` test pattern.

If you suspect dev DB has stragglers from before this script existed,
nuke them with the suffix patterns:

```sql
DELETE FROM farmer.farmers WHERE farmer_code LIKE 'E2E-%';
DELETE FROM iam.user_cooperative_assignments
  WHERE user_id IN (SELECT id FROM iam.users WHERE email LIKE 'user-%@e2e.test')
     OR cooperative_id IN (SELECT id FROM iam.cooperatives WHERE code LIKE 'TEST_COOP_%');
DELETE FROM iam.users WHERE email LIKE 'user-%@e2e.test';
DELETE FROM iam.cooperatives WHERE code LIKE 'TEST_COOP_%';
DELETE FROM iam.roles WHERE code LIKE 'test_role_%';
DELETE FROM iam.permissions WHERE code LIKE 'test_resource_%:%';
```

## Validators — single source of truth in `@thinkcocoa/shared`

**Hard rule**: every zod schema used by an FE form OR a BE route handler
MUST live in `packages/shared/src/validators/*`. No exceptions.

Concretely:

- ❌ Never write `z.object({...})` inline in an FE dialog or BE route.
- ❌ Never use `.extend({...})` on a shared schema to add fields locally.
  If a field is missing, add it to the shared schema first.
- ❌ Never use `.refine(...)` / `.superRefine(...)` on a shared schema in
  an FE/BE call site. Move the refinement into the shared schema.
- ❌ Never re-declare a field locally with relaxed rules
  (e.g. `z.string()` instead of the shared `uuidSchema`). UI sentinel
  values (`"__none__"`, `"__create__"`, etc.) must be mapped to the
  schema's expected shape (usually `null`) BEFORE the resolver sees them
  — not by loosening the schema.
- ✅ Always `import { createXxxSchema, updateXxxSchema } from
  '@thinkcocoa/shared'` and pass it directly to `zodResolver(...)` /
  `validationHook(...)`.

When you add a NEW UI-only field to a form (e.g. a permission picker
state), you have two choices:

1. If it needs validation → add to the shared schema.
2. If it's purely transient UI state (no server contract) → keep it
   OUT of the form/zod state entirely. Use `useState` instead.

**Don't write schema-parity tests.** A test that re-runs `safeParse`
against the shared schema is just retesting zod. What matters is:
(a) the API endpoint returns 422 with the expected `code` for invalid
input, and (b) the form component shows the error message to the user.
Test those two surfaces — see `apps/be/src/__tests__/system-e2e.test.ts`
and the user-dialog component test for examples.

## Pre-deploy gate — ALWAYS run `make preflight` before tagging

Before creating ANY `stage-v*` or `prod-v*` tag (or pushing one to
`origin`), run:

```bash
make preflight
```

It executes the same gates CI does, in fast-fail order:

1. Biome lint + format
2. TypeScript typecheck (BE)
3. `db:test-migrations` — clean apply + idempotency on an ephemeral
   Postgres (port 5540)
4. E2E suite on a separate ephemeral Postgres (port 5541)

Total wall time ~40 s on a warm machine. The whole point is to catch
the obvious failures locally instead of burning a CI run + a deploy
slot just to be told a migration is missing `IF NOT EXISTS` or a
schema field was renamed but the FE form wasn't updated.

If preflight fails, fix it FIRST, then re-run. Do not push the tag,
do not "let CI catch it", and do not skip steps because "I only
touched a comment".

## Other repo-wide conventions

- **Commit hygiene**: never push to `main` automatically; user
  triggers `make commit` or asks explicitly.
- **Dev DB password**: `postgres` / `postgres` on port 5539 (compose
  managed).
- **Test fixtures suffix**: e2e tests use `_${SUFFIX}` so they don't
  clash with seeded data. The afterAll cleanup runs even on test
  failure inside the suite, but only the ephemeral-DB workflow above
  guarantees a clean baseline if the suite ITSELF crashes.
