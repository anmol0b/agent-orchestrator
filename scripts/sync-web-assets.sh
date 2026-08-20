#!/usr/bin/env bash
# Sync the production web build into the Go-embedded asset tree.
#
#   frontend/  npm run build:web  →  frontend/dist-web/
#     → backend/internal/httpd/webassets/dist/   (embedded via //go:embed)
#
# The synced tree is a committed generated artifact (same convention as
# apispec/openapi.yaml): CI runs this script and fails on `git diff`, so the
# embedded dashboard can never drift from the renderer source.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/frontend/dist-web"
DST="${REPO_ROOT}/backend/internal/httpd/webassets/dist"

if [ "${1:-}" != "--no-build" ]; then
	(cd "${REPO_ROOT}/frontend" && npm run build:web)
fi

[ -f "${SRC}/index.html" ] || { echo "no web build at ${SRC} — run npm run build:web in frontend/ first" >&2; exit 1; }

rm -rf "$DST"
mkdir -p "$DST"
cp -R "${SRC}/." "$DST"
# go:embed ignores files/dirs starting with . or _ by default; keep the tree clean.
find "$DST" -name ".DS_Store" -delete

echo "synced ${SRC} -> ${DST} ($(find "$DST" -type f | wc -l | tr -d ' ') files)"
