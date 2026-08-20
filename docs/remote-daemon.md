# Remote daemon: headless AO on a Raspberry Pi over Tailscale

Run the AO daemon persistently on a headless Linux host (a Raspberry Pi is the
reference target), connect the Mac desktop app to it over Tailscale HTTPS, and
pair the mobile app with the same daemon. This is a supported deployment mode:
the Pi runs `ao headless`, the desktop app uses its built-in **Remote** daemon
connection, and both clients share one daemon.

The design decisions behind this mode are recorded in
`docs/adr/0003-remote-daemon-via-tailscale-https.md`.

## Architecture and security model

The daemon serves two listeners:

1. The loopback API (port 3001) — unauthenticated, bound to `127.0.0.1`
   permanently, by design (`backend/internal/config/config.go`). The local CLI
   talks to this. **It is never exposed on any network interface.**
2. The authenticated remote listener (port 3011 by default) — the same bridge
   the Connect Mobile feature uses (`backend/internal/mobilebridge`,
   `backend/internal/httpd/lan_listener.go`, ADR 0001). It binds only while
   enabled, requires a bearer password (stored hashed, per-source lockout),
   and blocks daemon-control routes. The desktop app and the mobile app both
   talk to this listener.

Remote access is supported **over Tailscale HTTPS only**. `ao headless` enables
Secure Pairing (`tailscale serve`) and verifies it before reporting readiness;
it exits non-zero rather than serving plaintext remote traffic. Tailscale
Funnel and general public-internet exposure are out of scope.

## 1. Install on the Pi

Target: 64-bit Raspberry Pi OS (arm64), Pi 4/5 with 4GB+ RAM recommended — AO
spawns real coding-agent CLI processes per worker.

Download the headless archive from GitHub Releases and verify it:

```bash
curl -LO https://github.com/Untrivial-ai/agent-orchestrator/releases/latest/download/ao-headless-linux-arm64.tar.gz
curl -LO https://github.com/Untrivial-ai/agent-orchestrator/releases/latest/download/ao-headless-linux-arm64.tar.gz.sha256
sha256sum -c ao-headless-linux-arm64.tar.gz.sha256
sudo mkdir -p /opt/ao
sudo tar -xzf ao-headless-linux-arm64.tar.gz -C /opt/ao --strip-components=1
```

The archive contains `bin/ao`, the packaged ACP runtime that Chat providers
need (`acp-runtime/`, discovered automatically beside the binary), the license,
and a systemd unit template. (A `linux-x64` archive is published too, for
non-Pi servers.) The archive is the only supported headless install channel —
the npm packages are frozen and do not carry ARM64 builds.

Also install whatever coding-agent CLIs you plan to run as AO workers (Claude
Code, etc.), same as any AO host.

## 2. Tailscale prerequisites

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

In the Tailscale admin console, enable **MagicDNS** and **HTTPS Certificates**
for the tailnet — Secure Pairing needs cert issuance. `ao headless` checks all
of this at startup and fails closed with a specific error if any piece is
missing.

## 3. Run under systemd

```bash
sudo cp /opt/ao/ao-headless.service /etc/systemd/system/ao-headless.service
# edit User= (and any Environment= credentials) to match your install
sudo systemctl daemon-reload
sudo systemctl enable --now ao-headless
journalctl -u ao-headless -f
```

On success the startup log prints the pairing URL and where to get the
password — never the password itself:

```
Remote access ready.
  Pairing URL: https://raspberrypi.your-tailnet.ts.net
  Retrieve the connection password with: ao remote credentials
```

The connection password and listener state persist under `~/.ao` and are
reused across restarts and reboots — restarting the service does not rotate
credentials or drop paired clients.

## 4. Operate remote access from the Pi

All administration happens on the Pi itself (the remote control routes are
loopback-only by design — the remote listener blocks them from being reached
through itself). Use the CLI, not curl:

```bash
ao remote status         # listener state, port, Tailscale diagnostics (password redacted)
ao remote credentials    # print the pairing URL and connection password
ao remote rotate         # rotate the password; prints the new credentials once
ao remote disable        # stop the remote listener
ao remote enable         # start it again
```

Every subcommand accepts `--json` for scripting.

## 5. Connect the Mac desktop app

1. In AO on the Mac: **Settings → Daemon connection**.
2. Set **Daemon location** to **Remote (Tailscale HTTPS)**.
3. Enter the pairing URL (e.g. `https://raspberrypi.your-tailnet.ts.net`) and
   the password from `ao remote credentials`.
4. Click **Test and connect**.

The password is stored in the macOS Keychain via Electron `safeStorage`. On
machines where protected storage is unavailable, the app keeps it only for the
current process and asks again on next launch.

Connection failures are reported with specific causes:

- **rejected the password** — check `ao remote credentials` on the Pi.
- **could not be reached** — Pi offline, or Tailscale disconnected on either
  side.
- **certificate could not be verified** — check `tailscale serve status` on
  the Pi.
- **API version is not supported** — upgrade the daemon on the Pi (§8) or the
  app. Version drift is detected at connect time, not per-route later.

**Disconnect** switches the app back to its local daemon but keeps the saved
credentials; **Forget remote** removes them. Quitting the Mac app never stops
the Pi's daemon — in remote mode the app does not spawn, own, or link any
daemon process.

## 6. Pair the mobile app

The mobile app talks to the same authenticated listener directly — no desktop
involved:

1. AO mobile app → **Connect** → manual connect.
2. Enter the Pi's pairing URL and the same password.
3. Verify by opening a session from the phone while off home Wi-Fi (cellular).

A worker started from the Mac app is visible and controllable from the phone,
and vice versa — both clients share the Pi's daemon state.

## 7. Open the browser dashboard

The same URL the Mac and mobile apps use is also a full web dashboard — the
daemon serves the production AO UI from its authenticated listener:

1. `ao headless` prints `Dashboard URL: https://<host>.<tailnet>.ts.net`.
2. Open that URL in any browser on any device joined to the same tailnet.
3. Enter the connection password (from `ao remote credentials` on the Pi).

The password is exchanged once for a signed 24-hour session cookie
(`ao_web_session`: `Secure`, `HttpOnly`, `SameSite=Strict`). From there the
browser manages projects, sessions, Chat, terminals, PRs, and reviews — no
desktop app required. Hash-based routing means deep links and refreshes work
without any server-side fallback.

Session behavior:

- **Rotation** invalidates every browser session the instant `ao remote
  rotate` runs — the cookie carries the password hash it was issued against.
- **Daemon restarts** keep sessions valid (the signing key lives under
  `~/.ao/mobile/`, mode 0600).
- **Sign out** from Settings → Daemon connection in the dashboard, or let the
  cookie expire after 24 hours.

The dashboard runs with a strict same-origin CSP and never contacts telemetry
endpoints. The URL stays private to the tailnet — Tailscale Funnel and
public-internet exposure remain unsupported.

## 8. Upgrades and password rotation

Upgrade the Pi:

```bash
curl -LO https://github.com/Untrivial-ai/agent-orchestrator/releases/latest/download/ao-headless-linux-arm64.tar.gz
curl -LO https://github.com/Untrivial-ai/agent-orchestrator/releases/latest/download/ao-headless-linux-arm64.tar.gz.sha256
sha256sum -c ao-headless-linux-arm64.tar.gz.sha256
sudo systemctl stop ao-headless
sudo tar -xzf ao-headless-linux-arm64.tar.gz -C /opt/ao --strip-components=1
sudo systemctl start ao-headless
```

State (including the password) survives upgrades. If the Mac app reports an
API-version error after an upgrade, it means app and daemon crossed a
compatibility boundary — bring both to current releases.

Rotate the password with `ao remote rotate` on the Pi. Rotation takes effect
immediately: every connected client (desktop and mobile) is rejected until
reconnected with the new credentials.

## 9. Not available in remote mode

Features that assume the daemon shares the Mac's filesystem or devices are
disabled with an in-app explanation while connected remotely:

- **Browser preview/control and preview-server actions** — the browser-runtime
  bridge is machine-local.
- **File drag-and-drop into terminals** — a dropped path would be a Mac-local
  path that doesn't exist on the Pi.
- **Directory pickers** — project creation asks for an absolute path on the
  remote host instead.
- **Connect Mobile administration from the desktop UI** — those routes are
  loopback-only by design; use `ao remote ...` on the Pi.

## Verification checklist

`test/headless/smoke.sh` automates every item that can be checked on the Pi
itself (service, health, remote state, TLS, dashboard auth, rotation,
restart persistence); run it first, then complete the device-spanning items
below by hand.

- [ ] `systemctl status ao-headless` on the Pi shows `active (running)` after
      a fresh reboot.
- [ ] `ao remote status` on the Pi shows the listener enabled and secure
      pairing active.
- [ ] Mac app connects via Settings → Daemon connection → Remote and shows
      the Pi's sessions.
- [ ] Browser dashboard: opening the printed Dashboard URL from a second
      tailnet device shows the login page; the password signs in; sessions,
      Chat, and terminals work; signing out returns to the login page.
- [ ] Browser dashboard: after `ao remote rotate`, an open dashboard session
      is rejected and must sign in with the new password.
- [ ] The Dashboard URL is unreachable from a machine outside the tailnet.
- [ ] Mobile app can open a worker session while off the home network
      (cellular test).
- [ ] Quitting AO on the Mac does **not** stop `ao-headless` on the Pi.
- [ ] `ao remote rotate` rejects both clients until they reconnect with the
      new password.
- [ ] A worker started from the Mac app is visible/controllable from the
      mobile app and vice versa.
