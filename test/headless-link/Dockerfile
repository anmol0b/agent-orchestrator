# Real-link harness: ao headless against the user's actual tailnet.
#
# Same build pattern as test/web-dashboard/Dockerfile.server, but the fake
# tailscale CLI and nginx stand-in are replaced by a REAL tailscaled
# (userspace networking — no /dev/net/tun or NET_ADMIN needed on Docker
# Desktop). `ao headless` arms Tailscale Secure Pairing itself; that arming
# is the thing under test, so nothing here pre-runs `tailscale serve`.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./backend/
RUN cd backend && go mod download
COPY backend ./backend
# The web bundle is embedded at compile time from the committed tree
# (backend/internal/httpd/webassets/dist, synced by scripts/sync-web-assets.sh).
RUN cd backend && CGO_ENABLED=0 go build -o /out/ao ./cmd/ao

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git tmux procps python3 gnupg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
        -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
        -o /etc/apt/sources.list.d/tailscale.list \
    && apt-get update && apt-get install -y --no-install-recommends tailscale \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/ao /usr/local/bin/ao
COPY test/headless-link/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY test/headless/smoke.sh /usr/local/bin/smoke.sh
# Deterministic stand-in for the agent CLI: spawn's binary check is a hard
# gate, and a real agent would drag in onboarding/auth non-determinism. The
# stub just has to exist, launch, and stay alive inside tmux.
RUN printf '#!/bin/sh\nprintf "FAKE-AGENT-READY\\n"\nexec sleep infinity\n' > /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude /usr/local/bin/entrypoint.sh /usr/local/bin/smoke.sh \
    && mkdir -p /data/ao /data/tailscale /tmp/e2eproj

ENV AO_DATA_DIR=/data/ao \
    AO_RUN_FILE=/data/ao/running.json \
    AO_FAKE_HARNESS=1 \
    AO_FAKE_SPEEDUP=20

# No EXPOSE/published ports on purpose: the only way in is over the tailnet.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
