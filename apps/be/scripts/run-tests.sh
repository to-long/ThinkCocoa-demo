#!/usr/bin/env bash
#
# Spin up an ephemeral Postgres on port 5541, migrate + seed it, run
# `bun test src/__tests__` against it, then tear the container down.
#
# Why a dedicated container instead of the dev DB on 5539:
#   - Tests can't pollute dev data — every run starts from a clean
#     baseline (matching CI behaviour and avoiding the "stragglers
#     from a crashed run" problem)
#   - We can DELETE/INSERT freely without worrying about mutating
#     fixtures the developer is using in the UI
#   - Running multiple test sessions side-by-side stays safe (each
#     could pick a different port, though we don't do that today)
#
# Why port 5541 (not 5540):
#   - 5539 is the dev DB (docker-compose)
#   - 5540 is the migration-test container (`db:test-migrations`)
#   - 5541 keeps the test runner separate so `db:test-migrations`
#     and `bun test` could in principle run concurrently
#
# Failure paths: any non-zero exit halts immediately (`set -e`); we
# trap EXIT to clean up the container even when the migrate step or
# the test run fails.
set -euo pipefail

CONTAINER="impactcocoa-demo-test-db"
PORT="5541"
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
  -e POSTGRES_DB=thinkcocoa \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null

echo "⏳ waiting for Postgres to accept connections on host port $PORT…"
# CRITICAL: must poll from the host, not via `docker exec`. The
# postgis image runs init in two phases (Unix-socket-only postmaster
# while loading PostGIS, then a restart with IPv4 listener), so
# `docker exec pg_isready` succeeds before the host port is bound.
for _ in $(seq 1 90); do
  if PGPASSWORD=postgres psql -h localhost -p "$PORT" -U postgres -d thinkcocoa -c 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Resolve the BE feature dir as the working dir so the migrator's
# relative `../src/db/client` import resolves correctly.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Override the dev-pointed `DATABASE_URL` from `.env` for the migrate
# + test passes. `migrate.ts` and the test suite both read
# `dotenv/config` first, so we override at the shell level.
export DATABASE_URL="postgresql://postgres:postgres@localhost:${PORT}/thinkcocoa"
# TieredStorage hot tier — use a tmp dir so audit-diff offload during
# tests doesn't try to write under /var/lib (prod default).
export STORAGE_ROOT="${STORAGE_ROOT:-/tmp/impact-cocoa-storage-test}"

echo "▶️  migrating + seeding test DB…"
# SEED_TEST_USERS=true (default) creates the `system.admin@…` account
# the suite signs in as. We explicitly skip the heavy CSV farmer +
# audit-log seeds — tests don't need them and they'd add ~10s.
SEED_FARMERS_FROM_CSV=false SEED_AUDIT_LOGS=false bun db/migrate.ts

echo "▶️  running test suite…"
# Forward any extra args the user passed (e.g. specific test files).
bun test src/__tests__ "$@"

echo ""
echo "✅ tests passed against ephemeral DB"
