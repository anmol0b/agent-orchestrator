# Real-link test: ao headless on your actual tailnet (Docker)

This harness runs `ao headless` inside a Docker container that joins **your
real Tailscale tailnet** — real `tailscaled`, real `tailscale serve`, real
MagicDNS HTTPS certificate. It is the closest thing to the Raspberry Pi
deployment without a Pi: the only way to reach the daemon is over the
tailnet, exactly like production.

## Prerequisites

- Docker running on your machine, which is itself on the tailnet.
- Tailscale admin console: **MagicDNS** and **HTTPS Certificates** enabled.
- An **ephemeral** auth key: admin console → Settings → Keys → Generate auth
  key → check *Ephemeral*. Ephemeral means the `ao-link-test` node is
  removed from the tailnet automatically when the container stops.

Provide the key in either way (it is never printed or committed — the
`.authkey` file is gitignored):

```bash
export TS_AUTHKEY=tskey-auth-...
# or
echo 'tskey-auth-...' > test/headless-link/.authkey
```

## Run

```bash
./test/headless-link/run.sh          # build + boot, prints the dashboard URL
./test/headless-link/run.sh --smoke  # also runs smoke.sh inside the container
./test/headless-link/run.sh --down   # tear down (node leaves the tailnet)
```

When it boots you get:

```
  Dashboard URL:  https://ao-link-test.<your-tailnet>.ts.net
  Password:       docker exec ao-link-test ao remote credentials
```

## What to verify by hand

- Open the Dashboard URL in a browser on any tailnet device → login gate →
  sign in with the password → sessions, terminals, PR views work → sign out.
- **Phone**: install Tailscale, join the same tailnet, then pair the AO
  mobile app with the same URL + password (first real mobile-vs-headless
  pairing test).
- From a machine **outside** the tailnet, the URL must be unreachable.
- The in-container smoke (`--smoke`) runs with `AO_SMOKE_NO_SYSTEMD=1` and
  rotates the password once — re-fetch it afterwards with
  `docker exec ao-link-test ao remote credentials`.

## Notes

- tailscaled runs with `--tun=userspace-networking` — no special Docker
  privileges needed; `tailscale serve` and cert issuance work in this mode.
- No ports are published to the host. If you can reach the dashboard from
  the Mac at all, it came over the tailnet.
- A stub `claude` binary backs terminal/session spawn; real LLM Chat needs
  provider credentials injected into the container (out of scope here).
