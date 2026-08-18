#!/usr/bin/env bash
#
# Restore `docs/demo-db-dump.sql.gz.enc` over the target database.
# Inverse of `scripts/dump-demo-db.sh`:
#
#     AES-256-CBC decrypt → gunzip → psql
#
# DESTRUCTIVE. The dump was taken with `--clean --if-exists`, so applying
# it DROPs and recreates every object it contains — including `iam`, i.e.
# users and sessions. Everyone gets logged out; accounts revert to
# whatever the snapshot held.
#
# Use this to bring a fresh box (or a badly-mangled demo) back to the
# snapshot. For the routine "put the demo back to baseline" case during a
# sales call, use Admin → Data Sync → Reset demo data instead: it keeps
# the login session and takes ~3s.
#
# Requires the passphrase in `DATABASE_ENCODE_PASSWORD` (apps/be/.env).
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
IN_FILE="../../docs/demo-db-dump.sql.gz.enc"
CONTAINER="${DEMO_DB_CONTAINER:-kuanadata-demo-postgres}"

read_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

DATABASE_URL="${DATABASE_URL:-$(read_env DATABASE_URL)}"
DATABASE_ENCODE_PASSWORD="${DATABASE_ENCODE_PASSWORD:-$(read_env DATABASE_ENCODE_PASSWORD)}"

if [[ ! -f "$IN_FILE" ]]; then
  echo "❌ $IN_FILE not found — run 'bun run db:dump' first" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL}" ]]; then
  echo "❌ DATABASE_URL not set (env or apps/be/.env)" >&2
  exit 1
fi
if [[ -z "${DATABASE_ENCODE_PASSWORD}" ]]; then
  echo "❌ DATABASE_ENCODE_PASSWORD not set (env or apps/be/.env)" >&2
  exit 1
fi
export DATABASE_ENCODE_PASSWORD

DB_USER="$(sed -E 's|^[a-z]+://([^:/@]+).*|\1|' <<<"$DATABASE_URL")"
DB_NAME="$(sed -E 's|.*/([^/?]+)(\?.*)?$|\1|' <<<"$DATABASE_URL")"
DB_PORT="$(sed -E 's|^[a-z]+://[^@]*@[^:/]+:([0-9]+)/.*|\1|' <<<"$DATABASE_URL")"

# A container name says nothing about which DB the URL points at — and
# this script DROPs everything it restores over. Require the container to
# publish the URL's port before writing to it.
container_matches_url() {
  local published
  published="$(docker port "$CONTAINER" 5432/tcp 2>/dev/null || true)"
  [[ -n "$published" && "$DB_PORT" =~ ^[0-9]+$ ]] && grep -q ":${DB_PORT}\$" <<<"$published"
}

# Skip the prompt in CI / scripted use: RESTORE_YES=1 bun run db:restore
if [[ "${RESTORE_YES:-}" != "1" ]]; then
  echo "⚠️  About to REPLACE database '$DB_NAME' (including users + sessions) from $IN_FILE"
  read -r -p "   Type the database name to confirm: " CONFIRM
  [[ "$CONFIRM" == "$DB_NAME" ]] || {
    echo "aborted."
    exit 1
  }
fi

decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -pass env:DATABASE_ENCODE_PASSWORD -in "$IN_FILE" | gunzip
}

# `ON_ERROR_STOP=1` so a failed statement aborts instead of leaving the
# DB half-restored. Drop noise from the `DROP … IF EXISTS` preamble is
# expected on a fresh DB, so stderr stays visible but non-fatal lines are
# just notices.
if command -v psql >/dev/null 2>&1; then
  echo "🐘 psql (host client) → $DB_NAME"
  decrypt | psql -v ON_ERROR_STOP=1 --quiet "$DATABASE_URL"
elif docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if ! container_matches_url; then
    echo "❌ Container '$CONTAINER' does not publish port $DB_PORT from DATABASE_URL." >&2
    echo "   Set DEMO_DB_CONTAINER to the right container, or install a psql client." >&2
    exit 1
  fi
  echo "🐳 psql (docker exec $CONTAINER) → $DB_NAME"
  decrypt | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 --quiet -U "$DB_USER" -d "$DB_NAME"
else
  echo "❌ No psql on PATH and container '$CONTAINER' is not running" >&2
  exit 1
fi

echo "✅ restored $DB_NAME from $(basename "$IN_FILE")"
