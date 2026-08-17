#!/usr/bin/env bash
# Assemble the standalone headless AO archive for the host platform/arch:
#
#   ao-headless-<platform>-<arch>/
#     bin/ao                 CGO-free daemon/CLI binary (backend/cmd/ao)
#     acp-runtime/           packaged Node + claude-agent-acp (Chat providers)
#     LICENSE
#     ao-headless.service    systemd unit template
#
# plus a sha256sum-compatible .sha256 sidecar.
#
# The layout is load-bearing: resolveRuntime
# (backend/internal/adapters/chatdriver/claudeacp/driver.go) discovers
# <root>/acp-runtime beside <root>/bin/ao with no configuration.
#
# Host-native by design — CI builds linux/arm64 on an ARM runner so the bundled
# Node runtime matches the target architecture (build-acp-runtime.mjs keys the
# Node download off process.platform/process.arch). Running this on macOS
# produces a darwin tarball that is useful only for smoke-testing the assembly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

platform="$(uname -s | tr '[:upper:]' '[:lower:]')"   # linux | darwin
arch="$(uname -m)"                                     # x86_64 | arm64
[ "$arch" = "x86_64" ] && arch="x64"

name="ao-headless-${platform}-${arch}"
out_dir="${REPO_ROOT}/dist/headless"
staging="${out_dir}/${name}"

rm -rf "$staging"
mkdir -p "$staging/bin"

echo "Building ao (${platform}/${arch})"
(cd "${REPO_ROOT}/backend" && CGO_ENABLED=0 go build -o "${staging}/bin/ao" ./cmd/ao)
chmod 0755 "${staging}/bin/ao"

echo "Building packaged ACP runtime"
node "${REPO_ROOT}/frontend/scripts/build-acp-runtime.mjs"
cp -R "${REPO_ROOT}/frontend/resources/acp-runtime" "${staging}/acp-runtime"

cp "${REPO_ROOT}/LICENSE" "${staging}/LICENSE"
cp "${REPO_ROOT}/packaging/headless/ao-headless.service" "${staging}/ao-headless.service"

# Sanity gate: mirror resolveRuntime's requireFile checks so a broken archive
# fails here instead of on the user's machine.
node_bin="${staging}/acp-runtime/node/bin/node"
acp_entry="${staging}/acp-runtime/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"
[ -f "$node_bin" ] || { echo "missing packaged Node runtime: $node_bin" >&2; exit 1; }
[ -f "$acp_entry" ] || { echo "missing claude-agent-acp entrypoint: $acp_entry" >&2; exit 1; }
"${staging}/bin/ao" --help >/dev/null

tarball="${out_dir}/${name}.tar.gz"
rm -f "$tarball" "$tarball.sha256"
tar -czf "$tarball" -C "$out_dir" "$name"
rm -rf "$staging"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$out_dir" && sha256sum "${name}.tar.gz" > "${name}.tar.gz.sha256")
else
  # macOS has no sha256sum; shasum -a 256 emits the same `<hash>  <file>` format.
  (cd "$out_dir" && shasum -a 256 "${name}.tar.gz" > "${name}.tar.gz.sha256")
fi

echo "Built ${tarball}"
cat "$tarball.sha256"
