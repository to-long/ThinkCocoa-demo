# ThinkCocoa — ThinkCocoa Data Management Platform

Full-stack cocoa supply-chain management platform: **React + Hono + PostgreSQL (PostGIS) + better-auth**, ingesting field data from **Kobo Toolbox** and covering the chain from farmer registration through inspections, purchases and evacuation to EUDR due-diligence.

**Multi-tenant by design** — every business endpoint scopes data to the user's currently-active cooperative via a signed cookie set by the header switcher. Admins with the `is_all_cooperative` flag see every coop in the org.

---

## Quick start

```bash
# Prerequisites: bun (package manager + workspaces + runtime/tests), Docker (Postgres)
curl -fsSL https://bun.sh/install | bash
# + Docker Desktop — https://www.docker.com/products/docker-desktop

# 1. Install workspace deps
make install

# 2. Env files from templates
cp apps/be/.env.example apps/be/.env
cp apps/fe/.env.example apps/fe/.env

# 3. Boot Postgres, migrate + seed, run FE + BE
make up && make migrate && make dev
```

FE → http://localhost:3130 · BE → http://localhost:8100 · API docs (Scalar) → http://localhost:8100/doc

Dev seed creates a system admin — see `apps/be/db/seed/` for the credentials/roster.

---

## Tech stack

| Layer | Tech | Notes |
|-------|------|-------|
| **Monorepo** | bun workspaces | `apps/be`, `apps/fe`, `packages/shared` |
| **Backend** | [Hono](https://hono.dev) + `@hono/zod-openapi` | HTTP + request/response validation + OpenAPI spec |
| **Auth** | [better-auth](https://better-auth.com) | Email/password, magic link, cookie sessions |
| **Database** | PostgreSQL 17 + [PostGIS](https://postgis.net) | Auth, business data, parcel geometry |
| **ORM** | [drizzle-orm](https://orm.drizzle.team) + drizzle-kit | Hand-written idempotent SQL migrations |
| **Frontend** | [React 19](https://react.dev) + [Rsbuild](https://rsbuild.dev) | Rspack bundler |
| **UI** | [Tailwind v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) (Radix) | + [Lucide](https://lucide.dev) icons, [Sonner](https://sonner.emilkowal.ski) toasts |
| **Data/state** | [SWR](https://swr.vercel.app) + [Zustand](https://zustand-demo.pmnd.rs) | Fetch/cache + global (user, active coop) |
| **Forms** | [react-hook-form](https://react-hook-form.com) + [Zod](https://zod.dev) | Schemas shared FE⇄BE via `@thinkcocoa/shared` |
| **Charts** | [Chart.js](https://www.chartjs.org) | Dashboard donuts / bars / trend lines |
| **i18n** | [react-intl](https://formatjs.github.io/docs/react-intl) | EN / FR / VI |
| **Typed SDK** | [`@hey-api/openapi-ts`](https://heyapi.dev) | FE client auto-generated from the live OpenAPI spec |
| **Integrations** | Kobo Toolbox, DigitalOcean Spaces (S3), [Resend](https://resend.com) | Field-form sync, submission snapshots/backups, transactional email |
| **Tooling** | [Biome](https://biomejs.dev), Docker | Lint/format; Postgres containers (dev `5539`, migration-test `5540`, e2e `5541`) |
| **Deploy** | GitHub Actions → droplet (PM2 + bun) | Tag-triggered: `stage-v*` → staging, `prod-v*` → production |

---

## Commands

Run `make help` for the full list. Most-used:

| Command | Description |
|---------|-------------|
| `make install` | Install all workspace deps (`bun install`) |
| `make up` / `make down` | Start / stop the Postgres container |
| `make migrate` | Apply drizzle migrations + idempotent seed |
| `make db-reset` | Wipe DB volume, recreate, re-migrate + seed |
| `make dev` | Postgres + FE + BE in parallel |
| `make dev-fe` / `make dev-be` | Frontend / backend only |
| `make build` / `make start` | Build all apps / run production (bun) |
| `make test` | BE e2e on a throwaway Postgres (port 5541) |
| `make test-migrations` | Clean-apply + idempotency check on a throwaway Postgres (5540) |
| `make preflight` | **Pre-deploy gate** — lint + BE typecheck + migrations + e2e (required before tagging) |
| `make lint` / `make format` | Biome lint / format |
| `make gen-kobo` | Regenerate the Kobo SDK from its OpenAPI schema |
| `make sync-permissions` | Pull `iam.permissions` from the DB → TS catalog |
| `make s3 <url>` | Print a private DO Spaces object to stdout |

Deploy is tag-based (no `make deploy`): after `make preflight` is green, push a `stage-v*` tag for staging or a `prod-v*` tag for production — the GitHub Actions workflow runs migrations + seed on the droplet and restarts PM2.

---

## Project structure

```
apps/
  be/                                   # Backend (Hono + PostgreSQL)
    src/
      main.ts                           # Server entrypoint
      auth.ts                           # better-auth config
      middleware/                       # require-auth · require-permission · active-coop
      features/                         # one module per domain, each = routes/service/projection/schemas
        farmers · parcels · inspections · training · coaching · vsla
        purchases · primary-evacuation · secondary-evacuation · shade-trees
        cooperatives · users · roles · permissions · audit · notifications
        integrations                    # Kobo sync engine + Spaces snapshots
        reports                         # XLSX report generators
      db/                               # drizzle client + schemas
      lib/                              # audit, order-by, spaces, ...
    db/
      drizzle/                          # idempotent SQL migrations + journal
      seed/                             # cleanup → cooperatives → iam → reference → ...
      migrate.ts                        # migrate + seed runner (also runs on deploy)
    scripts/                            # test-migrations.sh · run-tests.sh · backfill-*.ts

  fe/                                   # Frontend (React + shadcn/ui)
    src/
      index.tsx                         # App entrypoint + routing + intl
      components/ui/                    # shadcn/ui primitives (StatusTag, PermissionList, ...)
      features/
        auth · profile · dashboard
        farmers · farms · farm-map      # registry + parcels (GIS)
        inspections                     # + editable corrective-action tracking
        training · coaching · vsla · clmrs
        purchases · primary-evac · traceability   # supply-chain / secondary-evac + DDS
        reports
        admin/components/               # users · roles · permissions · cooperatives · audit-logs · sync-settings
      shared/
        api/                            # SWR hooks + apiFetch + shared list sorter/reset
        store/                          # useGlobalState (user + permissions) · useActiveCoop
        components/composed/            # coop-switcher · app-sidebar (permission-filtered) · notification-menu · ...

packages/
  shared/                               # @thinkcocoa/shared
    src/validators/                     # Zod schemas reused on FE + BE
    src/constants/permissions.ts        # PERMISSION_CATALOG → PermissionCode union
    src/openApi/think-cocoa-client/    # auto-generated typed SDK

docker-compose.yml · ecosystem.config.cjs (PM2) · Makefile · biome.json · CLAUDE.md (repo playbook)
```

---

## Architecture

### Multi-tenant model

Every non-`/admin` API filters by the user's currently-active cooperative.

- **Source of truth**: `iam.user_cooperative_assignments` rows + the `users.is_all_cooperative` flag (org-wide override) — independent fields.
- **FE**: the header `CoopSwitcher` writes the chosen coop to the `active-coop-id` cookie + a Zustand store; switching wipes the SWR cache (except the coop catalog) so lists/detail/stats refetch under the new scope.
- **BE**: `requireActiveCoop` reads the cookie, intersects it with the user's allowed set, exposes `c.get('activeCoopId')`. Cross-tenant lookups return `404` (not `403`) so IDs in other tenants don't leak.

### RBAC

- Permission codes live in `packages/shared/src/constants/permissions.ts` (`PERMISSION_CATALOG`), format `resource:action` (e.g. `farmer:create`). The catalog derives the `PermissionCode` union, so typos are compile-time errors.
- **BE**: per-route `requirePermission('…')` middleware.
- **FE**: the `<PermissionGate codes={[…]}>` HOC + `usePermission` hook hide actions the user can't perform; `<RequirePermission>` route guards render a 403 page. The permission editor groups actions per resource, mirrors the sidebar order/icons, and lists actions in CRUD order.
- Org-wide roles (`system_admin`, `project_leader`, …) auto-set `is_all_cooperative` and are inferred by `isOrgWideRole()` in shared.

### Kobo data pipeline

Field forms are collected in Kobo Toolbox and pulled by the `integrations` sync engine (`sync:run` / `sync:run_all`, schedulable via `sync:config`). Each run fetches submissions, snapshots the raw payload to DigitalOcean Spaces, and dispatches to per-domain parsers that upsert into typed tables. Re-syncs are idempotent and preserve user-owned state (e.g. corrective-action status).

---

## Features

**Access & administration** — Users (multi-coop scope + inference), Roles (drawer editor, permission picker), Permissions catalog, Cooperatives (users-with-access), Audit logs, and a Data-Sync admin (grouped Kobo jobs with run / run-all / config).

**Farmers & farms** — Farmer registry + detail (soft-delete/restore, consent, RA certification, shade-survival %); Parcels with PostGIS geometry and a farm map; bulk CSV import of farmers + parcels.

**Field operations** — Internal Inspections (certificate filter, headline stats, **editable corrective-action tracking**: Open → Processing → Done with overdue flags + outstanding counts); Training; Coaching; VSLA savings groups (12-month trend charts); CLMRS child-labour monitoring & remediation (unified flags → cases with auto-minted codes).

**Traceability & compliance** — Society Purchases → Primary Evacuation → Secondary Evacuation lot chain; EUDR / DDS status on export lots; XLSX report generators.

**Dashboard** — headline cards plus breakdown donuts and trend lines across the Farmer, Traceability, Purchases and evacuation tabs.

**Platform** — email/password + magic-link auth with password reset (Resend) and env-driven session timeout; EN/FR/VI i18n (validator error codes translate automatically); dark/light theme; unified `StatusTag`, search and stat-card components; sortable, uniform data tables with cross-reference links and one-click reset.

### Engineering controls

- **Migration test** (`make test-migrations`) — clean apply + idempotency on a throwaway Postgres, required on every schema/seed change (see `CLAUDE.md`).
- **E2E harness** (`make test`) — throwaway Postgres, never touches dev data even on crash.
- **Preflight gate** (`make preflight`) — the same checks CI runs, required before tagging a deploy.
- **Audit log** on every administrative + business mutation (actor, entity, action, coop scope).
- Drizzle migrations are the only source of truth for schema; the FE SDK is generated from the live OpenAPI spec.

---

## Auth endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/sign-in/email` | Login with email/password |
| POST | `/api/auth/sign-in/magic-link` | Send magic link (existing users only) |
| GET | `/api/auth/get-session` | Current session |
| POST | `/api/auth/sign-out` | Logout |
| POST | `/api/auth/forget-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with emailed token |
| POST | `/api/auth/change-password` | Change password (authenticated) |

Business endpoints (farmers, parcels, inspections, training, coaching, vsla, purchases, evacuation, cooperatives, users, roles, permissions, integrations, audit logs) are documented at http://localhost:8100/doc.
