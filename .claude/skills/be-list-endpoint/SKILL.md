---
name: be-list-endpoint
description: ImpactCocoa BE convention for any list/index API endpoint. Use when adding a new feature router, refactoring an existing one, or reviewing a list endpoint. Codifies the four mandatory pillars — stats, pagination, sort, filter — and the 4-file feature structure (routes/service/projection/schemas).
---

# BE list endpoint — the four pillars

Every list endpoint in this repo must ship **all four** of: stats, pagination, sort, filter. No exceptions, no "we'll add it later" — it's cheaper to add now than to retrofit when the FE depends on the wrong shape.

## File structure (mandatory)

A feature folder under `apps/be/src/features/<feature>/` always has:

```
index.ts        # re-export the OpenAPIHono router (one line)
routes.ts       # HTTP wiring ONLY — parse req → call service → c.json
service.ts      # async DB functions, no Hono imports, take typed inputs
projection.ts   # SELECT_FIELDS, Row type, toRowResponse, JSONB helpers
schemas.ts      # Zod request/response/error contracts + openapi() registrations
```

Audit feature is the gold standard reference: `apps/be/src/features/audit/{routes,service,projection,schemas}.ts`. Mirror it.

## Pillar 1 — List with pagination

```
GET /api/<resource>?page=1&pageSize=20&q=...&<filter>=...&sort=...
```

Response shape (immutable contract):

```json
{ "data": [...], "total": 123, "page": 1, "pageSize": 20 }
```

- Default `pageSize` is 20, max clamp 100. **Cooperatives and farmers have learned this lesson — don't repeat the "no pagination" mistake.**
- `page` is 1-based.
- The route handler does the clamping (`Math.max(1, …)` / `Math.min(100, …)`) before calling service. Service trusts inputs.

## Pillar 2 — Stats endpoint

```
GET /api/<resource>/stats?days=30
```

Returns a slim stats row: total + grouped counts. Powers the cards above the FE list.

```ts
{ total, windowDays, byStatus: { ... }, byScope: [...] }
```

- `?days=` clamped [1, 365]; default 30.
- Cache with `lru-cache` (60s TTL, max 4 entries) keyed on the filter set. Set `X-Cache: HIT|MISS` so the FE can dim during refetches.
- Mutations (create / update / soft-delete / restore) call `invalidate<Feature>StatsCache()`. **Cache invalidation is the caller's responsibility, not the cache's.**

## Pillar 3 — Sort (JSON:API spec)

```
?sort=-createdAt,name
```

- Comma-separated fields, `-` prefix for desc.
- Multi-field: first field is primary, second is tiebreaker, etc.
- Unknown columns silently dropped (do NOT 400 — the FE may have stale state from a deploy).
- Drizzle: use `dsql.raw('asc'|'desc')` for direction (NOT template interpolation — drizzle binds template vars as parameters).
- Per-feature whitelist of sortable fields lives in service.ts.

```ts
let orderExprs = [desc(table.createdAt)];  // default
if (filters.sort) {
  orderExprs = filters.sort.split(',').map(parseOne).filter(Boolean);
  if (orderExprs.length === 0) orderExprs = [desc(table.createdAt)];
}
```

## Pillar 4 — Filters

- Multi-select filters arrive as comma-separated strings: `?status=active,inactive`. Parse via `.split(',').map(s => s.trim()).filter(Boolean)`.
- Boolean flags: use `parseBoolFlag()` from `apps/be/src/lib/query-flags.ts` (accepts `true|TRUE|1|yes|on`, NOT strict `'true'`).
- Date windows: prefer `?days=N` (server computes `from = now - N*86400000`) over ISO timestamps. Clamp [1, 365].
- Search: `?q=...` always ILIKE on a curated set of columns (name, code, email — never JSONB blobs unless explicitly allowed).

## Service layer rules

- **No Hono imports.** Functions take typed inputs (`AuditListFilters`, `CreateUserInput`) plus an `actor: { id, ip, userAgent, sessionId }` for audit writes.
- Discriminated union returns for mutations: `{ kind: 'ok', row } | { kind: 'not-found' } | { kind: 'conflict' }`. Routes branch on `.kind` and map to HTTP codes — NEVER `throw` for known-domain errors.
- Audit writes happen inside service, right after the DB write. Pass `actor` through to `writeAudit` via the optional `actor:` param (added in commit `e6c55a8`).

## HTTP status codes (corrections from the audit feature refactor)

- Hard delete → audit `action: 'delete'` (NOT `'soft-delete'` — only soft-deletes write `'soft-delete'`).
- Empty PATCH body → **400** (not 404). Discriminator `'no-fields'` distinct from `'not-found'`.
- 409 only for true uniqueness conflicts (duplicate `code`, duplicate email).

## Verification before committing

```bash
make test              # ephemeral DB on :5541, full e2e suite
make test-migrations   # migrations apply cleanly + are idempotent
cd apps/be && bun run build   # tsc clean
```

If you touched `apps/be/db/drizzle/*` or `apps/be/src/db/schema/*`, `make test-migrations` is mandatory before committing — see CLAUDE.md.

## Reference files (read before writing new endpoints)

- Pattern: `apps/be/src/features/audit/`
- Multi-field sort: `apps/be/src/features/farmers/service.ts` (search for `parseOne`)
- Stats with LRU cache: `apps/be/src/features/farmers/service.ts` + `users/service.ts`
- Bool flag parser: `apps/be/src/lib/query-flags.ts`
- Audit write helper: `apps/be/src/lib/audit.ts`
