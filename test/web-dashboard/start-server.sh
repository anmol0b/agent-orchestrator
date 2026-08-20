#!/bin/sh
# Boots the e2e server: headless AO (fake tailscale arms secure pairing) plus
# nginx as the tailscale-serve stand-in. Idempotent across `docker restart`
# (the rotation/restart stage of the gate relies on that).
set -e

mkdir -p /data/ao /tmp/e2eproj
if [ ! -d /tmp/e2eproj/.git ]; then
	git -C /tmp/e2eproj init -q
	git -C /tmp/e2eproj -c user.email=e2e@test -c user.name=e2e commit -q --allow-empty -m init
fi

/usr/local/bin/ao headless >/data/ao/headless.log 2>&1 &
echo "$!" > /data/ao/headless.pid

# Wait for the authenticated listener (the public session probe answers
# without credentials; /healthz requires them on the LAN listener).
ready=""
for _ in $(seq 1 60); do
	if curl -sf http://127.0.0.1:3011/auth/session >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 0.5
done
if [ -z "$ready" ]; then
	echo "ao headless did not come up; log follows" >&2
	cat /data/ao/headless.log >&2
	exit 1
fi
echo "ao headless is up:"; cat /data/ao/headless.log | tail -3

exec nginx -g 'daemon off;'
