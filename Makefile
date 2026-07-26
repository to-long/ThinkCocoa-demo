.PHONY: install up down infra migrate seed db-reset \
        dev dev-fe dev-be \
        test test-migrations preflight \
        lint format build clean gen-kobo sync-permissions start help \
        s3

# Default target: show help
.DEFAULT_GOAL := help

help:
	@echo "ThinkCocoa — available targets:"
	@echo ""
	@echo "  Setup"
	@echo "    make install      Install all workspace dependencies"
	@echo ""
	@echo "  Infra"
	@echo "    make up           Start PostgreSQL (docker compose up -d)"
	@echo "    make down         Stop PostgreSQL (docker compose down)"
	@echo ""
	@echo "  Database"
	@echo "    make migrate      Apply drizzle migrations + seed"
	@echo "    make db-reset     Wipe DB volume, recreate, re-migrate + seed"
	@echo ""
	@echo "  Dev"
	@echo "    make dev          Run FE + BE in parallel (assumes infra + migrate are done)"
	@echo "    make dev-fe       Frontend only"
	@echo "    make dev-be       Backend only"
	@echo ""
	@echo "  Build / QA"
	@echo "    make build            Build all apps"
	@echo "    make start            Run production (Bun)"
	@echo "    make lint             Biome lint"
	@echo "    make format           Biome format"
	@echo "    make test             Run BE e2e on an ephemeral test DB (port 5541)"
	@echo "    make test-migrations  Verify migrations apply cleanly + are idempotent"
	@echo "    make preflight        Pre-deploy gate: lint + typecheck + migrations + e2e (REQUIRED before tagging stage-v*/prod-v*)"
	@echo ""
	@echo "  Misc"
	@echo "    make gen-kobo          Regenerate Kobo SDK from OpenAPI schema"
	@echo "    make sync-permissions  Pull iam.permissions from DB → TS catalog"
	@echo "    make s3 <url>          Print a private DO Spaces object to stdout"
	@echo "    make clean             Remove node_modules + dist everywhere"
	@echo ""
	@echo "  Typical first-time setup:"
	@echo "    make install && make up && make migrate && make dev"

# ── Setup ──────────────────────────────────────────────────────
install:
	@echo "📦 Installing dependencies..."
	@bun install

# ── Infra (PostgreSQL via docker-compose) ──────────────────────
up:
	@echo "🐘 Starting PostgreSQL on localhost:5539..."
	@docker compose up -d
	@echo "✅ Infrastructure ready"

down:
	@echo "🛑 Stopping PostgreSQL..."
	@docker compose down
	@echo "✅ Infrastructure stopped"

# Legacy alias
infra: up

# ── Database migrations / seed ─────────────────────────────────
migrate:
	@echo "🔄 Running drizzle migrations + seed..."
	@cd apps/be && bun run db:migrate
	@echo "✅ Migrations applied"

db-reset:
	@echo "🗑️  Resetting database (volume wipe + re-migrate)..."
	@cd apps/be && bun run db:reset
	@echo "✨ Database reset complete"

# ── Dev (auto-migrates + seeds so new schema picks up on every restart) ──
dev: up migrate
	@echo "🚀 Starting FE and BE in parallel..."
	@$(MAKE) -j2 dev-fe dev-be

dev-fe:
	@echo "⚛️  Frontend → http://localhost:3130"
	@cd apps/fe && bun run dev

dev-be:
	@echo "🚀 Backend  → http://localhost:8100"
	@cd apps/be && bun run dev

# ── Build / QA ─────────────────────────────────────────────────
build:
	@echo "🏗️  Building all apps..."
	@cd apps/be && bun run build
	@cd apps/fe && bun run build

start:
	@echo "🚀 Running Backend (start)..."
	@cd apps/be && bun run start &
	@echo "⚛️  Running Frontend (preview)..."
	@cd apps/fe && bun run preview

# BE end-to-end suite. Spins up an ephemeral Postgres on port 5541,
# migrates + seeds it, runs `bun test`, and tears the container down
# (even on failure). Never touches the dev DB on 5539, so a crashed
# test run can't leave fixtures behind. See apps/be/scripts/run-tests.sh.
test:
	@echo "🧪 Running BE e2e against an ephemeral test DB on :5541..."
	@cd apps/be && bun run test

# Migration sanity check — applies every migration twice on a clean
# DB to verify cleanliness + idempotency. Runs on port 5540 so it
# can coexist with `make test`. See apps/be/scripts/test-migrations.sh.
test-migrations:
	@echo "🔬 Verifying migrations apply cleanly + are idempotent..."
	@cd apps/be && bun run db:test-migrations

# Pre-deploy gate — REQUIRED before tagging `stage-v*` or `prod-v*`.
# Runs the same checks CI does, in fast-fail order:
#   1. Biome (lint + format)            — cheapest, catches typos
#   2. TypeScript typecheck (BE)        — schema/type drift
#   3. Migrations (clean + idempotent)  — DDL bugs, missing IF NOT EXISTS
#   4. E2E suite                        — full HTTP + DB integration
# Steps 3 and 4 each spin their own ephemeral Postgres (ports 5540
# and 5541), so they don't touch the dev DB on 5539. Total wall time
# is ~40 s on a warm machine — cheap to run every time you push a tag.
preflight:
	@echo "✈️  Preflight: lint → typecheck → migrations → e2e"
	@echo ""
	@echo "─── 1/4: biome ───"
	@bun run lint
	@echo ""
	@echo "─── 2/4: typecheck ───"
	@cd apps/be && bun run typecheck
	@echo ""
	@echo "─── 3/4: migrations ───"
	@cd apps/be && bun run db:test-migrations
	@echo ""
	@echo "─── 4/4: e2e ───"
	@cd apps/be && bun run test
	@echo ""
	@echo "✅ Preflight green — safe to tag + deploy"

lint:
	@echo "🔍 Running Biome linter..."
	@bun run lint

format:
	@echo "✨ Formatting code..."
	@bun run format

# ── Misc ───────────────────────────────────────────────────────
gen-kobo:
	@echo "📥 Downloading KoboToolbox OpenAPI schema..."
	@cd packages/shared && bun run kobo:schema
	@echo "⚙️  Generating TypeScript types..."
	@cd packages/shared && bun run kobo:generate
	@echo "✅ Kobo types generated in packages/shared/src/openApi/generated/"

sync-permissions:
	@echo "🔁 Pulling iam.permissions → packages/shared/.../permissions.ts ..."
	@cd apps/be && bun run sync:permissions
	@echo "✅ Permissions catalog synced. Review & commit the diff."

# Print a private DO Spaces object by URL — authenticates with the
# BE's SPACES_KEY/SECRET. Both syntaxes accepted (positional preferred
# for ad-hoc debug, URL=… form for scripts):
#   make s3 https://think-cocoa.fra1.digitaloceanspaces.com/.../foo.json
#   make s3 URL=https://think-cocoa.fra1.cdn.digitaloceanspaces.com/...
# Pipe to jq for filtering:
#   make s3 https://... | jq '.["Member/PlotID"]'
#
# The positional form works via the `%:` catch-all rule below — Make
# treats the URL as a phony target, the catch-all does nothing, and
# `filter-out` pulls the URL string back into MAKECMDGOALS for us.
s3:
	@TARGET_URL="$(or $(URL),$(filter-out $@,$(MAKECMDGOALS)))"; \
	if [ -z "$$TARGET_URL" ]; then \
	  echo "Usage: make s3 <spaces-url>" >&2; \
	  echo "   or: make s3 URL=<spaces-url>" >&2; \
	  exit 2; \
	fi; \
	cd apps/be && bun scripts/preview-s3.ts "$$TARGET_URL"

# Catch-all so positional args (a URL) to `preview-s3` don't trip
# "No rule to make target". Trade-off: typo'd target names get
# silently swallowed too, e.g. `make tset` does nothing instead of
# erroring. Acceptable for this small Makefile — `make help` lists
# every real target.
%:
	@:

clean:
	@echo "🧹 Cleaning node_modules and dist..."
	@rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/dist
