#!/usr/bin/env bash
# Cross-machine e2e gate for the headless browser dashboard: ao headless in a
# server container (fake tailscale + nginx as the tailscale-serve stand-in),
# Playwright in a client container, three stages wired by docker exec:
#
#   stage 1 — unauth → login → project → session → SSE → mux → logout
#   (server: ao remote rotate)
#   stage 2 — old session dead, new password works
#   (server: docker restart — daemon reboot)
#   stage 3 — durable state recovered, re-login works
set -uo pipefail

NET="ao-webdash-e2e"
SERVER_IMG="ao-webdash-e2e-server"
CLIENT_IMG="ao-webdash-e2e-client"
SERVER="ao-webdash-server"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KEEP="${KEEP_CONTAINERS:-0}"
FAILURES=0

cleanup() {
	[ "$KEEP" = "1" ] && return 0
	docker rm -f "$SERVER" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

note() { echo; echo "== $* =="; }

password() { docker exec "$SERVER" ao remote credentials | awk '/^Password:/ {print $2}'; }

run_stage() {
	local stage="$1" pass="$2"
	mkdir -p "$REPO_ROOT/test/web-dashboard/test-results"
	docker run --rm --network "$NET" \
		-e E2E_STAGE="$stage" -e E2E_PASSWORD="$pass" \
		-e E2E_BASE_URL="https://$SERVER" \
		-v "$REPO_ROOT/test/web-dashboard/test-results:/e2e/test-results" \
		"$CLIENT_IMG" 2>&1 | grep -vE "^\s*$"
	# docker run exit code propagates through the pipe via PIPESTATUS
	return "${PIPESTATUS[0]}"
}

note "building images"
docker build -f "$REPO_ROOT/test/web-dashboard/Dockerfile.server" -t "$SERVER_IMG" "$REPO_ROOT" || exit 1
docker build -f "$REPO_ROOT/test/web-dashboard/Dockerfile.client" -t "$CLIENT_IMG" "$REPO_ROOT" || exit 1

note "starting server"
docker rm -f "$SERVER" >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null
docker run -d --name "$SERVER" --network "$NET" --network-alias "$SERVER" "$SERVER_IMG" >/dev/null
for i in $(seq 1 60); do
	if docker exec "$SERVER" curl -sf http://127.0.0.1:3011/auth/session >/dev/null 2>&1; then break; fi
	[ "$i" = 60 ] && { docker logs "$SERVER"; exit 1; }
	sleep 1
done

note "stage 1: core flow"
PASS1="$(password)"
run_stage 1 "$PASS1" || FAILURES=$((FAILURES + 1))

note "server: ao remote rotate"
docker exec "$SERVER" ao remote rotate >/dev/null || { echo "rotate failed"; exit 1; }

note "stage 2: rotated password"
PASS2="$(password)"
run_stage 2 "$PASS2" || FAILURES=$((FAILURES + 1))

note "server: docker restart (daemon reboot)"
docker restart "$SERVER" >/dev/null
for i in $(seq 1 60); do
	if docker exec "$SERVER" curl -sf http://127.0.0.1:3011/auth/session >/dev/null 2>&1; then break; fi
	[ "$i" = 60 ] && { docker logs "$SERVER"; exit 1; }
	sleep 1
done

note "stage 3: state survives restart"
run_stage 3 "$PASS2" || FAILURES=$((FAILURES + 1))

echo
if [ "$FAILURES" -eq 0 ]; then
	echo "WEB-DASHBOARD GATE: ALL STAGES PASSED"
else
	echo "WEB-DASHBOARD GATE: $FAILURES STAGE(S) FAILED"
	docker logs "$SERVER" 2>&1 | tail -20
	exit 1
fi
