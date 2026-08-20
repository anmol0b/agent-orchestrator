#!/usr/bin/env bash
# test/headless-link/run.sh — build/boot/tear down the real-tailnet harness.
#
#   ./test/headless-link/run.sh          build + boot the container
#   ./test/headless-link/run.sh --smoke  build + boot + in-container smoke
#   ./test/headless-link/run.sh --down   remove the container (ephemeral node
#                                        disappears from the tailnet)
#
# Auth key comes from $TS_AUTHKEY or the untracked, gitignored
# test/headless-link/.authkey file. It is never printed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${DIR}/../.." && pwd)"
IMAGE="ao-headless-link"
NAME="ao-link-test"

if [ "${1:-}" = "--down" ]; then
	docker rm -f "$NAME" 2>/dev/null && echo "removed $NAME" || echo "$NAME not running"
	exit 0
fi

KEY="${TS_AUTHKEY:-}"
if [ -z "$KEY" ] && [ -f "${DIR}/.authkey" ]; then
	KEY="$(tr -d '[:space:]' < "${DIR}/.authkey")"
fi
if [ -z "$KEY" ]; then
	echo "No auth key. Either:" >&2
	echo "  export TS_AUTHKEY=tskey-auth-..." >&2
	echo "  or put it in ${DIR}/.authkey (gitignored)" >&2
	echo "Create an EPHEMERAL key: Tailscale admin console -> Settings -> Keys." >&2
	exit 2
fi

echo "Building ${IMAGE}..."
docker build -q -f "${DIR}/Dockerfile" -t "$IMAGE" "$ROOT" >/dev/null

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e TS_AUTHKEY="$KEY" "$IMAGE" >/dev/null

echo "Waiting for ao headless to arm secure pairing..."
url=""
for _ in $(seq 1 90); do
	url="$(docker exec "$NAME" ao remote status --json 2>/dev/null \
		| python3 -c 'import json,sys; d=json.load(sys.stdin); sp=d["securePairing"]; print("https://"+sp["host"] if sp["active"] and sp["host"] else "")' 2>/dev/null || true)"
	[ -n "$url" ] && break
	if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
		echo "container exited; logs follow" >&2
		docker logs "$NAME" >&2
		exit 1
	fi
	sleep 1
done
if [ -z "$url" ]; then
	echo "secure pairing did not arm within 90s; logs follow" >&2
	docker logs --tail 40 "$NAME" >&2
	exit 1
fi

cat <<EOF

ao headless is live on your tailnet.

  Dashboard URL:  ${url}
  Password:       docker exec ${NAME} ao remote credentials
  Remote status:  docker exec ${NAME} ao remote status
  Logs:           docker logs -f ${NAME}

Open the URL in any browser on a tailnet device and sign in with the
password. To pair a phone: install Tailscale, join the same tailnet, then
use the same URL + password in the AO mobile app.

Tear down with: ${DIR}/run.sh --down
EOF

if [ "${1:-}" = "--smoke" ]; then
	echo
	echo "Running in-container smoke (no systemd mode)..."
	docker exec -e AO_SMOKE_NO_SYSTEMD=1 "$NAME" /usr/local/bin/smoke.sh
fi
