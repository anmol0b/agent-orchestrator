#!/bin/sh
# Boots the real-link harness: real tailscaled (userspace networking), joins
# the tailnet with an ephemeral auth key, then runs `ao headless` in the
# foreground. `ao headless` arms + verifies Tailscale Secure Pairing itself —
# that is the behavior under test, so this script deliberately does NOT run
# `tailscale serve` or `tailscale cert`.
set -e

if [ -z "${TS_AUTHKEY:-}" ]; then
	echo "TS_AUTHKEY is not set — create an ephemeral auth key in the" >&2
	echo "Tailscale admin console (Settings -> Keys) and pass it via run.sh." >&2
	exit 2
fi

mkdir -p /data/ao /data/tailscale /tmp/e2eproj /var/run/tailscale
if [ ! -d /tmp/e2eproj/.git ]; then
	git -C /tmp/e2eproj init -q
	git -C /tmp/e2eproj -c user.email=e2e@test -c user.name=e2e commit -q --allow-empty -m init
fi

tailscaled --tun=userspace-networking \
	--state=/data/tailscale/tailscaled.state \
	--socket=/var/run/tailscale/tailscaled.sock &
echo "$!" > /var/run/tailscale/tailscaled.pid

# tailscaled needs a moment before the CLI socket answers.
i=0
until tailscale --socket=/var/run/tailscale/tailscaled.sock version >/dev/null 2>&1; do
	i=$((i + 1))
	[ "$i" -gt 60 ] && { echo "tailscaled did not come up" >&2; exit 1; }
	sleep 0.5
done

tailscale --socket=/var/run/tailscale/tailscaled.sock up \
	--authkey="$TS_AUTHKEY" --hostname=ao-link-test

# Wait for a MagicDNS name; HTTPS certs are exercised by ao headless itself.
i=0
until [ -n "$(tailscale --socket=/var/run/tailscale/tailscaled.sock status --json \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])' 2>/dev/null)" ]; do
	i=$((i + 1))
	[ "$i" -gt 60 ] && { echo "no MagicDNS name after 30s — is MagicDNS enabled?" >&2; exit 1; }
	sleep 0.5
done

echo "tailnet node up: $(tailscale --socket=/var/run/tailscale/tailscaled.sock status --json \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])')"

exec /usr/local/bin/ao headless
