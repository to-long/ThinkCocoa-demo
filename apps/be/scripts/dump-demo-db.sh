#!/usr/bin/env bash
#
# Snapshot the demo database into ONE encrypted, compressed file that is
# committed to `docs/`:
#
#     docs/demo-db-dump.sql.gz.enc
#
# Why keep a dump when `Reset demo data` (Admin → Data Sync) already
# rebuilds everything from the seed:
#   - The seed rebuilds OPERATIONAL data only. Users, roles, permission
#     grants, cooperatives and their chairs come from the seed too, but a
#     dump also carries anything hand-tuned in the live demo — a curated
#     narrative, extra accounts, edited copy.
#   - It makes a fresh box demo-ready without running migrations + seed:
#     `bun run db:restore` and the environment is byte-identical.
#
# Pipeline: pg_dump → gzip -9 → AES-256-CBC (PBKDF2, 100k iterations).
# The passphrase comes from `DATABASE_ENCODE_PASSWORD` in `apps/be/.env`
# — this is a sales-demo dataset (synthetic farmers, no real PII), so the
# bar is "not plaintext in git", not "withstands a determined attacker".
#
# pg_dump source, in order of preference:
#   1. `pg_dump` on PATH, run against DATABASE_URL (prod / CI).
#   2. `docker exec` into the compose Postgres container (local dev,
#      where the host usually has no Postgres client installed).
#
# Restore with `scripts/restore-demo-db.sh` (`bun run db:restore`).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
OUT_FILE="../../docs/demo-db-dump.sql.gz.enc"
CONTAINER="${DEMO_DB_CONTAINER:-thinkcocoa-demo-postgres}"

# Read ONE key out of .env. Deliberately not `source .env` — values like
# `EMAIL_FROM=ThinkData <no-reply@…>` are unquoted and would be parsed as
# a shell redirect.
read_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

DATABASE_URL="${DATABASE_URL:-$(read_env DATABASE_URL)}"
DATABASE_ENCODE_PASSWORD="${DATABASE_ENCODE_PASSWORD:-$(read_env DATABASE_ENCODE_PASSWORD)}"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "❌ DATABASE_URL not set (env or apps/be/.env)" >&2
  exit 1
fi
if [[ -z "${DATABASE_ENCODE_PASSWORD}" ]]; then
  echo "❌ DATABASE_ENCODE_PASSWORD not set (env or apps/be/.env) — refusing to write an unencrypted dump" >&2
  exit 1
fi
export DATABASE_ENCODE_PASSWORD

# postgresql://user:pass@host:port/dbname?params
DB_USER="$(sed -E 's|^[a-z]+://([^:/@]+).*|\1|' <<<"$DATABASE_URL")"
DB_NAME="$(sed -E 's|.*/([^/?]+)(\?.*)?$|\1|' <<<"$DATABASE_URL")"
DB_PORT="$(sed -E 's|^[a-z]+://[^@]*@[^:/]+:([0-9]+)/.*|\1|' <<<"$DATABASE_URL")"

# The docker path talks to a container by NAME, which says nothing about
# which database the URL actually points at. Verify the container
# publishes the URL's port before touching it, so pointing DATABASE_URL
# at another instance can never silently hit the dev container instead.
container_matches_url() {
  local published
  published="$(docker port "$CONTAINER" 5432/tcp 2>/dev/null || true)"
  [[ -n "$published" && "$DB_PORT" =~ ^[0-9]+$ ]] && grep -q ":${DB_PORT}\$" <<<"$published"
}

# `--clean --if-exists` so a restore over a populated DB replaces it
# instead of colliding; `--no-owner --no-privileges` so the dump restores
# under whatever role the target box uses.
PG_DUMP_ARGS=(--clean --if-exists --no-owner --no-privileges)

dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    echo "🐘 pg_dump (host client) → $DB_NAME" >&2
    pg_dump "${PG_DUMP_ARGS[@]}" "$DATABASE_URL"
  elif docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    if ! container_matches_url; then
      echo "❌ Container '$CONTAINER' does not publish port $DB_PORT from DATABASE_URL." >&2
      echo "   Set DEMO_DB_CONTAINER to the right container, or install a pg_dump client." >&2
      exit 1
    fi
    echo "🐳 pg_dump (docker exec $CONTAINER) → $DB_NAME" >&2
    docker exec "$CONTAINER" pg_dump "${PG_DUMP_ARGS[@]}" -U "$DB_USER" -d "$DB_NAME"
  else
    echo "❌ No pg_dump on PATH and container '$CONTAINER' is not running" >&2
    exit 1
  fi
}

mkdir -p "$(dirname "$OUT_FILE")"
dump | gzip -9 |
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
    -pass env:DATABASE_ENCODE_PASSWORD -out "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1 | tr -d ' ')"
echo "✅ wrote $(cd ../.. && pwd)/docs/$(basename "$OUT_FILE") ($SIZE, AES-256-CBC)"
