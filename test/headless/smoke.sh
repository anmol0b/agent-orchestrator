#!/usr/bin/env bash
# test/headless/smoke.sh — real-machine smoke verification for headless AO.
#
# Run ON the Raspberry Pi / VM after installing the headless archive and
# systemd unit per docs/remote-daemon.md §1–3, with Tailscale up and MagicDNS
# + HTTPS certificates enabled in the tailnet admin console.
#
#   ./test/headless/smoke.sh                # full local run (rotates the password once!)
#   ./test/headless/smoke.sh --post-reboot  # after a real reboot: service + remote + credentials
#
# WARNING: the full run ends by ROTATING the connection password (to verify
# rotation). Reconnect desktop/mobile/browser clients afterwards with the new
# password from `ao remote credentials`.
#
# What this script asserts (wire facts verified against the source):
#   - /healthz + /readyz carry numeric "apiVersion"     (backend/internal/httpd/router.go)
#   - ao remote status --json fields: enabled, port, securePairing.{active,...};
#     status blanks the password                        (backend/internal/cli/remote.go)
#   - LAN listener blocks /shutdown, /internal/, /api/v1/mobile, /api/v1/dev,
#     /api/v1/browser with a plain 404                  (backend/internal/httpd/lan_listener.go)
#   - /auth/session|login|logout exist only on the authenticated listener;
#     login issues an ao_web_session cookie (Secure, HttpOnly, SameSite=Strict,
#     24h); wrong password → 401 BAD_PASSWORD           (backend/internal/httpd/webdash.go,
#                                                        backend/internal/httpd/web_session.go)
#   - every other route on the remote listener requires bearer or cookie;
#     credential-free probes count toward the per-source lockout (5/min), so
#     this script never makes more than one negative probe before a successful
#     auth resets the counter                         (backend/internal/httpd/auth.go)
#
# This script asserts behavior, not timing. On a slow Pi, bump WAIT_TIMEOUT.
# The connection password is never printed; it is read from `ao remote
# credentials --json` into a chmod-600 temp file that is deleted on exit.

set -euo pipefail

SERVICE="${AO_SMOKE_SERVICE:-ao-headless}"
LOOPBACK="${AO_SMOKE_LOOPBACK:-http://127.0.0.1:3001}"
AO_BIN="${AO_SMOKE_AO:-ao}"
WAIT_TIMEOUT="${AO_SMOKE_WAIT:-60}"
POST_REBOOT=0
[ "${1:-}" = "--post-reboot" ] && POST_REBOOT=1

fails=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s: %s\n' "$1" "$2"; fails=$((fails + 1)); }
skip() { printf 'SKIP %s: %s\n' "$1" "$2"; }
info() { printf ' .. %s\n' "$1"; }

WORKDIR="$(mktemp -d)"
chmod 700 "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

for tool in curl python3 systemctl tailscale "$AO_BIN"; do
	command -v "$tool" >/dev/null 2>&1 || {
		echo "missing required tool: $tool" >&2
		exit 2
	}
done

# json_get <file> <python-expression-on-d> — evaluated, printed.
json_get() {
	python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"
}

http_code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# current_password <out-var>: read `ao remote credentials --json` into a
# 0600 temp file and export the password into the named variable.
current_password() {
	local cf="$WORKDIR/credentials.json"
	"$AO_BIN" remote credentials --json >"$cf"
	chmod 600 "$cf"
	local p
	p="$(json_get "$cf" 'd["password"]')"
	[ -n "$p" ] || return 1
	printf -v "$1" '%s' "$p"
}

wait_ready() {
	local i
	for ((i = 0; i < WAIT_TIMEOUT; i++)); do
		[ "$(http_code "$LOOPBACK/healthz")" = "200" ] && return 0
		sleep 1
	done
	return 1
}

# ---------------------------------------------------------------- prereqs
DNSNAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"])')"
DNSNAME="${DNSNAME%.}"
if [ -n "$DNSNAME" ]; then
	pass "tailscale: connected, MagicDNS name $DNSNAME"
else
	fail "tailscale" "Self.DNSName empty — is tailscale up and MagicDNS enabled?"
	echo "cannot continue without a tailnet hostname" >&2
	exit 1
fi
BASE="https://$DNSNAME"

# ---------------------------------------------------------------- service
[ "$(systemctl is-active "$SERVICE")" = "active" ] \
	&& pass "service: $SERVICE active" \
	|| fail "service" "$SERVICE not active (systemctl status $SERVICE)"
[ "$(systemctl is-enabled "$SERVICE")" = "enabled" ] \
	&& pass "service: $SERVICE enabled at boot" \
	|| fail "service" "$SERVICE not enabled (systemctl enable $SERVICE)"

# ------------------------------------------------------- loopback health
HZ="$WORKDIR/healthz.json"
[ "$(http_code "$LOOPBACK/healthz" -o "$HZ")" = "200" ] \
	&& pass "loopback: GET /healthz 200" \
	|| fail "loopback" "GET $LOOPBACK/healthz did not return 200"
if [ -s "$HZ" ]; then
	[ "$(json_get "$HZ" 'isinstance(d.get("apiVersion"), int)')" = "True" ] \
		&& pass "loopback: /healthz exposes numeric apiVersion" \
		|| fail "loopback" "/healthz missing numeric apiVersion field"
fi

# ------------------------------------------------------------ remote state
ST="$WORKDIR/remote-status.json"
if "$AO_BIN" remote status --json >"$ST" 2>/dev/null; then
	[ "$(json_get "$ST" 'd["enabled"]')" = "True" ] \
		&& pass "remote: listener enabled" \
		|| fail "remote" "listener not enabled (ao remote status)"
	[ "$(json_get "$ST" 'd["securePairing"]["active"]')" = "True" ] \
		&& pass "remote: secure pairing (Tailscale HTTPS) active" \
		|| fail "remote" "secure pairing not active — ao headless must fail closed"
	[ "$(json_get "$ST" 'd.get("password", "") == ""')" = "True" ] \
		&& pass "remote: password redacted from status output" \
		|| fail "remote" "password leaked in ao remote status --json"
else
	fail "remote" "ao remote status --json failed — is the daemon running?"
fi

# bearer for all remote calls below; never printed.
current_password PASS || {
	fail "credentials" "ao remote credentials --json returned no password"
	echo "cannot continue without credentials" >&2
	exit 1
}
AUTH="Authorization: Bearer $PASS"

# ------------------------------------------------- TLS + dashboard shell
if [ "$(http_code "$BASE/" -o "$WORKDIR/index.html")" = "200" ]; then
	pass "tls: GET $BASE/ 200 (Tailscale cert chain validated by curl)"
else
	fail "tls" "GET $BASE/ failed — check tailscale serve status on the Pi"
fi

DASH=0
case "$(http_code "$BASE/auth/session")" in
200) DASH=1 ;;
404) skip "dashboard" "/auth/session 404 — build without the web dashboard gateway" ;;
*) fail "dashboard" "/auth/session returned unexpected status (not 200/404)" ;;
esac

if [ "$DASH" = 1 ]; then
	grep -q '<div id="root">' "$WORKDIR/index.html" \
		&& pass "dashboard: / serves the web app shell" \
		|| fail "dashboard" "/ did not contain the app shell (<div id=\"root\">)"
	[ "$(http_code "$BASE/auth/session" -o "$WORKDIR/session.json")" = "200" ] \
		&& [ "$(json_get "$WORKDIR/session.json" 'd["authenticated"]')" = "False" ] \
		&& pass "dashboard: /auth/session reports unauthenticated before login" \
		|| fail "dashboard" "/auth/session did not report unauthenticated"
fi

if [ "$POST_REBOOT" = 1 ]; then
	# Post-reboot mode stops here: service + remote + a fresh bearer probe.
	[ "$(http_code -H "$AUTH" "$BASE/api/v1/sessions")" = "200" ] \
		&& pass "remote: persisted password still valid after reboot" \
		|| fail "remote" "bearer rejected after reboot — state did not persist"
	echo
	if [ "$fails" -eq 0 ]; then echo "POST-REBOOT SMOKE: ALL CHECKS PASSED"; else echo "POST-REBOOT SMOKE: $fails CHECK(S) FAILED"; exit 1; fi
	exit 0
fi

# -------------------------------------------------------- auth enforcement
# One credential-free probe (counts once toward the 5/min lockout), then an
# immediate successful bearer call that resets the counter.
[ "$(http_code "$BASE/api/v1/sessions")" = "401" ] \
	&& pass "auth: unauthenticated API call rejected (401)" \
	|| fail "auth" "unauthenticated GET /api/v1/sessions was not 401"
[ "$(http_code -H "$AUTH" "$BASE/api/v1/sessions")" = "200" ] \
	&& pass "auth: bearer password accepted (200)" \
	|| fail "auth" "valid bearer rejected on GET /api/v1/sessions"

# -------------------------------------------------------- browser login
JAR="$WORKDIR/cookies.txt"
if [ "$DASH" = 1 ]; then
	[ "$(http_code -X POST -H 'Content-Type: application/json' \
		-d '{"password":"definitely-wrong"}' "$BASE/auth/login")" = "401" ] \
		&& pass "login: wrong password rejected (401)" \
		|| fail "login" "wrong password was not 401"

	python3 -c 'import json,sys; print(json.dumps({"password": sys.argv[1]}))' "$PASS" >"$WORKDIR/login-body.json"
	chmod 600 "$WORKDIR/login-body.json"
	LOGIN_HEADERS="$WORKDIR/login-headers.txt"
	if [ "$(http_code -X POST -H 'Content-Type: application/json' \
		-d @"$WORKDIR/login-body.json" -c "$JAR" -D "$LOGIN_HEADERS" \
		"$BASE/auth/login" -o "$WORKDIR/login.json")" = "200" ]; then
		pass "login: correct password accepted (200)"
	else
		fail "login" "correct password rejected on /auth/login"
	fi
	if grep -qi '^Set-Cookie:.*ao_web_session=' "$LOGIN_HEADERS" \
		&& grep -qi '^Set-Cookie:.*Secure' "$LOGIN_HEADERS" \
		&& grep -qi '^Set-Cookie:.*HttpOnly' "$LOGIN_HEADERS" \
		&& grep -qi '^Set-Cookie:.*SameSite=Strict' "$LOGIN_HEADERS"; then
		pass "login: ao_web_session cookie is Secure + HttpOnly + SameSite=Strict"
	else
		fail "login" "session cookie missing or missing Secure/HttpOnly/SameSite=Strict flags"
	fi
	[ "$(http_code -b "$JAR" "$BASE/api/v1/sessions")" = "200" ] \
		&& pass "login: session cookie authorizes API calls" \
		|| fail "login" "cookie-authenticated GET /api/v1/sessions was not 200"
	[ "$(http_code -X POST -b "$JAR" -c "$JAR" "$BASE/auth/logout")" = "204" ] \
		&& pass "login: logout returns 204" \
		|| fail "login" "POST /auth/logout was not 204"
	# A stale cookie 401 does NOT count toward the lockout (auth.go), safe.
	[ "$(http_code -b "$JAR" "$BASE/api/v1/sessions")" = "401" ] \
		&& pass "login: revoked cookie rejected after logout" \
		|| fail "login" "logged-out cookie still authorized API calls"
fi

# ------------------------------------------------- control-plane isolation
# GET (not POST) on /shutdown: a broken block shows as 405 here instead of
# actually shutting the daemon down — the check fails loudly but safely.
[ "$(http_code -H "$AUTH" "$BASE/shutdown")" = "404" ] \
	&& pass "isolation: /shutdown blocked on remote listener (404 even with bearer)" \
	|| fail "isolation" "/shutdown not 404 via remote listener — lanControlBlock regression?"
[ "$(http_code -H "$AUTH" "$BASE/api/v1/mobile/status")" = "404" ] \
	&& pass "isolation: /api/v1/mobile/* blocked on remote listener" \
	|| fail "isolation" "/api/v1/mobile/status not 404 via remote listener"
[ "$(systemctl is-active "$SERVICE")" = "active" ] \
	&& pass "isolation: daemon still running after control-route probes" \
	|| fail "isolation" "daemon not active after control-route probes"

# ---------------------------------------------------------------- rotation
OLD_PASS="$PASS"
ROT="$WORKDIR/rotated.json"
if "$AO_BIN" remote rotate --json >"$ROT" 2>/dev/null \
	&& [ -n "$(json_get "$ROT" 'd.get("password", "")')" ]; then
	pass "rotate: ao remote rotate issued a new password"
	chmod 600 "$ROT"
else
	fail "rotate" "ao remote rotate --json returned no new password"
fi
PASS="$(json_get "$ROT" 'd["password"]')"
AUTH="Authorization: Bearer $PASS"
[ "$(http_code -H "Authorization: Bearer $OLD_PASS" "$BASE/api/v1/sessions")" = "401" ] \
	&& pass "rotate: old password rejected (401)" \
	|| fail "rotate" "old password still accepted after rotation"
[ "$(http_code -H "$AUTH" "$BASE/api/v1/sessions")" = "200" ] \
	&& pass "rotate: new password accepted (200)" \
	|| fail "rotate" "new password rejected after rotation"
if [ "$DASH" = 1 ]; then
	python3 -c 'import json,sys; print(json.dumps({"password": sys.argv[1]}))' "$PASS" >"$WORKDIR/login-body.json"
	[ "$(http_code -X POST -H 'Content-Type: application/json' \
		-d @"$WORKDIR/login-body.json" "$BASE/auth/login")" = "200" ] \
		&& pass "rotate: browser login works with new password" \
		|| fail "rotate" "browser login rejected the new password"
fi
unset OLD_PASS

# ------------------------------------------------------ restart persistence
info "restarting $SERVICE (sudo may prompt)..."
if sudo systemctl restart "$SERVICE" && wait_ready; then
	pass "restart: $SERVICE back to ready after systemctl restart"
else
	fail "restart" "$SERVICE did not become ready within ${WAIT_TIMEOUT}s"
fi
"$AO_BIN" remote status --json >"$ST" 2>/dev/null || true
[ "$(json_get "$ST" 'd["enabled"]' 2>/dev/null)" = "True" ] \
	&& [ "$(json_get "$ST" 'd["securePairing"]["active"]' 2>/dev/null)" = "True" ] \
	&& pass "restart: remote listener + secure pairing re-armed automatically" \
	|| fail "restart" "remote listener did not re-arm after restart"
[ "$(http_code -H "$AUTH" "$BASE/api/v1/sessions")" = "200" ] \
	&& pass "restart: same password still valid (no regeneration on restart)" \
	|| fail "restart" "password changed across restart — clients would be dropped"

# ----------------------------------------------------------- manual steps
cat <<EOF

------------------------------------------------------------------------
Automated checks done. Finish the release smoke MANUALLY from other devices:

  [ ] Browser on a second tailnet device: open $BASE,
      sign in with the password from \`ao remote credentials\`, then
      exercise sessions, Chat, a terminal, PR/review views, and sign out.
  [ ] Rotate again (\`ao remote rotate\`) while the dashboard is open:
      the open session must be rejected and demand the new password.
  [ ] From a machine OUTSIDE the tailnet: $BASE must be unreachable.
  [ ] Mac app: Settings → Daemon connection → Remote, enter $BASE
      + password → Test and connect; confirm the Pi's sessions appear.
  [ ] Quit the Mac app; \`systemctl status $SERVICE\` here must stay active.
  [ ] Mobile app on cellular: pair with $BASE + password, open a session.
  [ ] Start a session from one client; confirm it is visible/controllable
      from the other two (shared daemon state).
  [ ] Reboot this machine, then run: $0 --post-reboot

NOTE: this run ROTATED the connection password. Retrieve the current one
with \`ao remote credentials\` and reconnect any existing clients.
------------------------------------------------------------------------
EOF

echo
if [ "$fails" -eq 0 ]; then
	echo "SMOKE: ALL CHECKS PASSED"
else
	echo "SMOKE: $fails CHECK(S) FAILED"
	exit 1
fi
