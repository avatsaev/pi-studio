#!/usr/bin/env bash
# Minimal acceptance check of an unpacked linux binary folder in a bare container (no Node, no npm):
# --version, daemon start/status/stop, __pi, __skills, relay start/stop; then
# the folder is moved and --version and a daemon start run again. The release smoke test is a
# separate, larger script (sprint-140/task-003).
#
#   scripts/binary-container-check.sh [dist-binary/pi-studio-<version>-linux-x64]
#
# Needs docker; copies the folder into a scratch directory, so the original is not touched.
set -euo pipefail

if [ "${1:-}" != "--inside" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  SRC="${1:-$(ls -d "$ROOT"/dist-binary/pi-studio-*-linux-x64 | tail -1)}"
  SCRATCH="$(mktemp -d /tmp/pi-binary-check.XXXXXX)"
  cp -r "$SRC" "$SCRATCH/one"
  cp "$0" "$SCRATCH/check.sh"
  docker run --rm -v "$SCRATCH:/check" debian:bookworm-slim bash /check/check.sh --inside
  rm -rf "$SCRATCH"
  exit 0
fi

# ── inside the container ────────────────────────────────────────────────────────────────────────
export HOME=/tmp/home PI_STUDIO_HOME=/tmp/psh PI_CODING_AGENT_DIR=/tmp/home/.pi/agent
export PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
mkdir -p "$HOME" "$PI_STUDIO_HOME"
DAEMON=127.0.0.1:16767 RELAY=127.0.0.1:17000
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok:   $*"; }
get() ( # get <port> <path> → the HTTP status line, through bash's /dev/tcp (no curl in the image)
  exec 3<>"/dev/tcp/127.0.0.1/$1"
  printf 'GET %s HTTP/1.0\r\nHost: x\r\n\r\n' "$2" >&3
  head -1 <&3
)

command -v node >/dev/null && fail "node is on PATH"
command -v npm >/dev/null && fail "npm is on PATH"
ok "no node, no npm on PATH"

BIN=/check/one/pi-studio
VERSION="$("$BIN" --version)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "--version printed: $VERSION"
ok "--version: $VERSION"

daemon_cycle() { # daemon_cycle <binary>: start, health, status, stop
  "$1" --json -H "$DAEMON" daemon start >/tmp/start.json || { cat /tmp/start.json; fail "daemon start"; }
  [[ "$(get 16767 /api/health)" == *" 200 "* ]] || fail "/api/health is not 200"
  "$1" --json -H "$DAEMON" daemon status | grep -q '"up":true' || fail "daemon status is not up"
  "$1" --json daemon stop >/tmp/stop.json || { cat /tmp/stop.json; fail "daemon stop"; }
  [[ "$("$1" --json -H "$DAEMON" daemon status || true)" == *'"up":false'* ]] || fail "daemon is still up after stop"
}

daemon_cycle "$BIN"
ok "--json daemon start / status / stop"

[[ "$("$BIN" __pi --version)" =~ ^[0-9] ]] || fail "__pi --version"
ok "__pi --version"
[[ "$("$BIN" __skills --help)" == *"Manage Skills"* ]] || fail "__skills --help"
ok "__skills --help"

"$BIN" relay start --listen "$RELAY" >/dev/null
for _ in $(seq 40); do get 17000 /health >/dev/null 2>&1 && break; sleep 0.25; done
[[ "$(get 17000 /health)" == *" 200 "* ]] || fail "relay /health is not 200"
"$BIN" relay stop >/dev/null
ok "relay start / stop"

mv /check/one /check/moved
BIN=/check/moved/pi-studio
[ "$("$BIN" --version)" = "$VERSION" ] || fail "--version after moving the folder"
daemon_cycle "$BIN"
[[ "$("$BIN" __pi --version)" =~ ^[0-9] ]] || fail "__pi --version after moving the folder"
ok "moved folder: --version, daemon cycle and __pi still work"
echo "ALL CHECKS PASSED"
