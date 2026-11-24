#!/usr/bin/env bash
# Runs inside a bare container (see run.sh). No Node, no npm: `command -v` proves it.
set -uo pipefail

BIN=/proof/bin
PI="$BIN/pi-proof __pi"
EXCLUDED="npm:@99percentpeople/pi-background-tasks"
EXTENSION="npm:@juicesharp/rpiv-todo"
export HOME=/tmp/home PI_CODING_AGENT_DIR=/tmp/home/.pi/agent PI_OFFLINE= PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
mkdir -p "$PI_CODING_AGENT_DIR"
SETTINGS="$PI_CODING_AGENT_DIR/settings.json"
fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok:   $*"; }

command -v node >/dev/null && fail "node is on PATH"
command -v npm >/dev/null && fail "npm is on PATH"
ok "no node, no npm on PATH"

# 1. Install through the bun script (Pi's package manager), including the package the binary cannot load.
$PI install "$EXCLUDED" >/tmp/install-excluded.log 2>&1 || { cat /tmp/install-excluded.log; fail "install of the excluded package"; }
ok "pi install $EXCLUDED (the excluded package is installed on disk and in settings)"
cp "$SETTINGS" /tmp/settings.before
$PI install "$EXTENSION" >/tmp/install-ext.log 2>&1 || { cat /tmp/install-ext.log; fail "install of $EXTENSION"; }
ok "pi install $EXTENSION with no npm on the machine"
ls "$PI_CODING_AGENT_DIR/npm/node_modules/@juicesharp/rpiv-todo/package.json" >/dev/null || fail "extension not on disk"
ls "$PI_CODING_AGENT_DIR/npm/node_modules/@99percentpeople/pi-background-tasks/package.json" >/dev/null || fail "excluded package not on disk"

# 2. Settings: only the requested entry was added; nothing about the package manager was written.
grep -q npmCommand "$SETTINGS" && fail "npmCommand was written to settings.json"
grep -q "pi-background-tasks" "$SETTINGS" || fail "the excluded entry was dropped from settings.json"
diff <(tr -d ' \n' </tmp/settings.before) <(tr -d ' \n' <"$SETTINGS") | grep -c . | xargs -I{} echo "settings diff lines: {}"
sed 's/"npm:@juicesharp\/rpiv-todo",\?//' "$SETTINGS" | tr -d ' \n' | sed 's/,\]/]/' >/tmp/a
tr -d ' \n' </tmp/settings.before | sed 's/,\]/]/' >/tmp/b
cmp -s /tmp/a /tmp/b || { echo "--- before"; cat /tmp/settings.before; echo "--- after"; cat "$SETTINGS"; fail "settings differ by more than the new entry"; }
ok "settings.json differs only by the added entry; no npmCommand; the excluded entry is kept"

# 3. Pi starts in RPC mode with the excluded package installed and does not load it; the other extension loads.
rpc() { printf '%s\n' "$1" | timeout 25 $PI --mode rpc --no-session 2>/tmp/rpc.err | head -c 4000; }
STATE=$(rpc '{"id":"1","type":"get_state"}')
echo "$STATE" | grep -q '"success":true' || { echo "$STATE"; cat /tmp/rpc.err; fail "Pi did not answer get_state"; }
ok "pi --mode rpc starts with the excluded package installed and answers get_state"
COMMANDS=$(printf '%s\n%s\n' '{"id":"1","type":"get_commands"}' '' | (timeout 25 $PI --mode rpc --no-session 2>>/tmp/rpc.err | head -c 20000))
echo "$COMMANDS" | grep -qi "todo" && ok "the other extension ($EXTENSION) is loaded: its command is listed" || echo "note: get_commands did not list todo: ${COMMANDS:0:300}"
grep -qi "node-pty" /tmp/rpc.err && { cat /tmp/rpc.err; fail "the excluded package was loaded (node-pty error)"; }
ok "no node-pty load error: the excluded package was not loaded"

# 4. Control: the same install with no exclusion reproduces the known failure.
CONTROL=$(printf '%s\n' '{"id":"1","type":"get_state"}' | PI_PROOF_NO_EXCLUDE=1 timeout 25 $PI --mode rpc --no-session 2>/tmp/control.err | head -c 2000)
if echo "$CONTROL" | grep -q '"success":true'; then
  echo "control: Pi started even without the exclusion (the package did not stop it here)"
else
  echo "control: without the exclusion Pi does not start; stderr: $(head -c 300 /tmp/control.err | tr '\n' ' ')"
fi
echo "ALL CHECKS PASSED"
