#!/usr/bin/env bash
#
# Spin up a throwaway Postgres on port 5540 and run every migration
# against it from scratch. Catches:
#   - Drizzle-generated SQL that doesn't actually apply on an empty DB
#   - FK orderings that work on dev (because the table already
#     existed) but break on a fresh provision
#   - Seeds that aren't idempotent (we run migrate.ts twice — the
#     second call must succeed without diff)
#
# Why a separate container instead of the dev one (port 5539):
#   - We can wipe + recreate freely without losing dev data
#   - Tests run against a known-empty baseline every time
#
# Failure paths: any non-zero exit halts immediately (`set -e`); we
# trap EXIT to clean up the container even when the migrate step
# fails, so re-runs don't pile up containers.
set -euo pipefail

CONTAINER="kuanadata-demo-migration-test"
PORT="5540"
IMAGE="imresamu/postgis:17-3.5"

cleanup() {
  echo "🧹 cleaning up container '$CONTAINER'…"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Always start from a clean slate — if a previous run left junk
# around, blow it away before continuing.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "🐘 starting throwaway Postgres on port $PORT…"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=kuanadata \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null

echo "⏳ waiting for Postgres to accept connections on host port $PORT…"
# CRITICAL: must poll from the host, not via `docker exec`. The postgis
# image runs init in two phases:
#   1. Postmaster on Unix socket only (loads PostGIS extensions)
#   2. Shutdown, then restart with IPv4 listener on 5432
# `docker exec pg_isready` succeeds during phase 1 — but the host port
# isn't bound yet, and the migrator's connection gets killed when the
# postmaster bounces. Polling host:port waits for phase 2 specifically.
for _ in $(seq 1 90); do
  if PGPASSWORD=postgres psql -h localhost -p "$PORT" -U postgres -d kuanadata -c 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Resolve the BE feature dir as the working dir so the migrator's
# relative `../src/db/client` import resolves correctly.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Override the dev-pointed `DATABASE_URL` from `.env` for both runs.
# `migrate.ts` reads `dotenv/config` first, so we need to override at
# the shell level too — env vars on the bun command line take
# precedence over `.env` values.
export DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/kuanadata"

echo "▶️  pass 1/2: migrate + seed against empty DB"
SEED_TEST_USERS=false bun db/migrate.ts

echo "▶️  pass 2/2: re-run to verify idempotency"
SEED_TEST_USERS=false bun db/migrate.ts

echo ""
echo "✅ migrations apply cleanly + are idempotent"
