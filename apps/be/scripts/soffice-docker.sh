#!/bin/sh
# `soffice` that runs in Docker instead of on the host — see
# docker/libreoffice.Dockerfile for why the version has to be pinned.
#
# Point SOFFICE_BIN at this script. The converter passes absolute paths in
# a temp directory; we bind-mount that directory so the container sees the
# same paths. NOTE: Docker Desktop on macOS does not share /private/tmp, so
# TMPDIR must be set to something under the user's home or the repo (see
# apps/be/.env) — otherwise the mount silently resolves to an empty dir.
set -e
IMAGE=${LO_IMAGE:-thinkcocoa/libreoffice:bookworm}

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "soffice-docker: building $IMAGE (first run, ~2 min)…" >&2
  docker build -q -t "$IMAGE" -f "$(dirname "$0")/../docker/libreoffice.Dockerfile" \
    "$(dirname "$0")/.." >&2
fi

# The working directory is whichever one the file arguments live in.
DIR=""
for arg in "$@"; do
  case "$arg" in
    /*) d=$(dirname "$arg"); [ -d "$d" ] && DIR="$d" ;;
  esac
done
[ -n "$DIR" ] || DIR=$(pwd)

exec docker run --rm -v "$DIR:$DIR" -w "$DIR" "$IMAGE" soffice "$@"
