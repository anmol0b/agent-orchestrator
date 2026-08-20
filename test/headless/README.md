# Headless AO real-machine smoke test

`smoke.sh` verifies a headless AO install (Raspberry Pi or Linux VM) end to
end from the machine itself: Tailscale prerequisites, the systemd service,
loopback health + `apiVersion`, remote-listener state, TLS, dashboard auth,
control-route isolation, password rotation, and restart persistence.

## Prerequisites

- The headless archive installed and running under systemd per
  `docs/remote-daemon.md` §1–3 (`ao-headless` service active).
- `tailscale up` done; **MagicDNS** and **HTTPS Certificates** enabled in the
  tailnet admin console.
- `curl` and `python3` on the machine (both ship with Raspberry Pi OS).

## Run

```bash
./test/headless/smoke.sh
```

The full run **rotates the connection password once** (that is one of the
things it verifies). Reconnect desktop/mobile/browser clients afterwards with
the new password from `ao remote credentials`.

After rebooting the machine, verify boot persistence with:

```bash
./test/headless/smoke.sh --post-reboot
```

Useful overrides (environment variables): `AO_SMOKE_SERVICE` (systemd unit
name), `AO_SMOKE_LOOPBACK` (loopback base URL), `AO_SMOKE_AO` (path to the
`ao` binary), `AO_SMOKE_WAIT` (readiness wait seconds after restart).

## What it does not cover

Checks that require a *second* device are printed as a manual checklist at
the end of a run: browser login from another tailnet device, the Mac desktop
Remote connection flow, mobile pairing on cellular, out-of-tailnet
unreachability, and cross-client session visibility. These mirror the
"Verification checklist" in `docs/remote-daemon.md`.

## Reporting failures

The script never prints the connection password. If a check fails, include
the redacted script output, `journalctl -u ao-headless -n 200`, and
`ao remote status --json` (password is redacted there too) in an upstream
issue.
