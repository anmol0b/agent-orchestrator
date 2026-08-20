# 3. Remote daemon access over Tailscale HTTPS (headless mode)

Date: 2026-08-17
Status: Accepted

## Context

Users want AO running persistently on a headless host — a Raspberry Pi is the
reference case — with the Mac desktop app and the mobile app both attached to
that remote daemon. Before this change there was no remote story: the desktop
app only ever attached to or spawned a loopback daemon, and the only
network-facing surface was the Connect Mobile LAN listener from ADR 0001,
deliberately plaintext and home-network-only.

The hard rule from AGENTS.md stands: the primary daemon listener binds
`127.0.0.1`, unauthenticated, permanently. It has no TLS and no CORS
protection beyond loopback, so exposing it on any interface — even a tailnet
one — is a real security regression, not a configuration option.

Two further constraints shaped the design:

- **The renderer cannot authenticate cross-origin requests itself.** The
  desktop app's API, SSE, and terminal-mux transports use `fetch`,
  `EventSource`, and `WebSocket`; `EventSource` and the browser `WebSocket`
  API cannot set an `Authorization` header. Pointing the renderer straight at
  a remote HTTPS origin would force bearer tokens into URLs (logged, cached,
  leaked) and would require widening the renderer CSP to a remote origin.
- **Remote access must never fall back to plaintext.** ADR 0001 accepted
  plaintext strictly for home-LAN mobile use. A daemon whose whole purpose is
  to be reached remotely needs a stronger floor.

## Decision

**One authenticated remote surface, shared by desktop and mobile.** Remote
access rides the existing second listener from ADR 0001
(`backend/internal/mobilebridge`, `backend/internal/httpd/lan_listener.go`):
single rotating connection password stored only as a hash, per-source
lockout, app-API only (daemon-control routes stay loopback-gated). The desktop
app is simply a second client of that surface — no third listener, no new
auth model. The existing `/api/v1/mobile/*` routes and their persisted state
(`~/.ao/mobile/config.json`) are unchanged; the new `ao remote ...` CLI is a
thin client over them with generalized "remote access" terminology.

**`ao headless` is the supported entrypoint.** It starts the normal loopback
daemon, enables the authenticated listener (port 3011 by default,
`--remote-port` to override), and enables *and verifies* Tailscale Secure
Pairing (`tailscale serve --https=443`) before reporting readiness. It fails
closed — non-zero exit, specific error — when the Tailscale CLI, MagicDNS
certificates, or the serve configuration cannot establish HTTPS. Plaintext
remote access is never an officially supported mode. The password is reused
across restarts and is never printed to stdout or logs; operators retrieve it
with `ao remote credentials` on the host.

**Tailscale HTTPS is the only documented remote transport.** Tailscale
provides the network boundary (tailnet-only), the identity (MagicDNS
hostname), and the certificate (HTTPS Certificates feature). Tailscale Funnel
and public-internet exposure remain out of scope.

**The desktop app connects through a loopback forwarding proxy**
(`frontend/src/main/remote-proxy.ts`). In remote mode the Electron main
process starts a random-port `127.0.0.1` proxy that forwards HTTP bodies and
streaming responses (including SSE), bridges terminal WebSocket upgrades
bidirectionally, replaces any caller-supplied authorization with
`Authorization: Bearer <password>`, preserves the renderer's origin so the
daemon's existing CORS checks still apply, strips hop-by-hop headers, and
uses normal TLS validation with no insecure override. The renderer keeps
talking to loopback plaintext exactly as it does against a local daemon, so
the CSP is unchanged and no credential ever appears in a URL or reaches the
renderer. The password is persisted with Electron `safeStorage` under `~/.ao`;
when protected storage is unavailable it lives only for the current process.

**Remote mode owns nothing.** In remote mode the app does not inspect
`running.json`, spawn a local daemon, apply executable-identity checks, call
`/shutdown`, or link the remote daemon to the app lifecycle. Quitting the app
closes only its local proxy.

**Version drift is detected, not tolerated.** `/healthz` and `/readyz` expose
a numeric `apiVersion` (`backend/internal/daemonmeta`). The app checks it at
connect time and reports a clear upgrade mismatch instead of failing later on
individual routes.

**Distribution is release archives, not npm.** The npm channel is frozen, so
headless installs ship as `ao-headless-linux-{x64,arm64}.tar.gz` release
assets containing `bin/ao`, the packaged ACP runtime (discovered beside the
binary by `resolveRuntime`, no configuration needed), the license, and a
systemd unit template. The arm64 archive builds on an ARM runner because the
bundled Node runtime is architecture-specific.

## Consequences

- The authenticated listener's attack surface is now reachable by desktop
  clients too, but only over Tailscale HTTPS in the supported configuration —
  strictly stronger than ADR 0001's accepted plaintext, which stays scoped to
  home-LAN mobile use.
- One password guards both clients; rotating it (`ao remote rotate`) drops
  desktop and mobile together. This is deliberate (single-user trusted
  tailnet, V1), and per-client credentials would be an additive change.
- The loopback proxy means the daemon cannot distinguish the desktop app from
  a local process on the Mac beyond the bearer token — acceptable, since the
  Mac is the trusted client endpoint; the token is the authority.
- Features that assume a co-located filesystem or machine-local bridges
  (browser preview/control, file drag-and-drop, directory pickers, mobile
  administration from the desktop UI) are disabled or adapted in remote mode;
  full cross-machine parity is explicitly deferred.
- The primary loopback listener is byte-for-byte untouched, so local
  desktop/CLI behavior carries no regression risk, and the AGENTS.md hard
  rule needs no amendment.
- Release artifacts grow by two tarballs plus checksum sidecars, published by
  the same gated release flow as the desktop app (one publisher).
