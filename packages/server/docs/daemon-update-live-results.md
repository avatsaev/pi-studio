# Daemon self-update — live results

What the live checks proved: `scripts/daemon-update-check/` (a real global npm install, recipe and flags
in its README) and `scripts/binary-update-check/` (the single binary in a Node-less container, README
there). Spec: `swe/features/self-update.md` § Acceptance criteria and § TODO(verify).
Each run is dated; the newest is first.

## 2026-11-25 — ordered, bounded shutdown under load; both recipes re-run

Sprint 153 task 006. Built `dist` of the working tree at `c6f04ddb` (daemon, CLI), throwaway
`PI_STUDIO_HOME` / `PI_STUDIO_PI_HOME` in `/tmp`, port 47401, only the `litellm` API key copied, a real
Pi turn on `pi/global.anthropic.claude-sonnet-5-5`. The recipes ran from a clean worktree of `HEAD`
(`npm ci && npm run build`), which was removed afterwards with every container, network, image and
scratch folder they made.

### Shutdown (`pi-studio daemon stop`, SIGTERM)

Load for every row: a Pi turn running a 600 s `bash` tool call, a terminal running `sleep 300`, a second
terminal running `yes` whose client had stopped reading (3.7–4.1 MB in the daemon's socket send queue),
and — where noted — an install in flight (`extensions sync` → `pi` → `npm install`, plus a preview
`git clone`).

| # | Check | Seen |
|---|---|---|
| 1 | Stop under load | `daemon stop` exit 0, `daemon stopped`, **1.5 s** wall (1.8 s on the first run; CLI start-up included). Log: agents closed at +20 ms, terminals at +40 ms, the in-flight install request failed with `the daemon is shutting down` at +60 ms, the stalled client dropped (1006) at +1.06 s, the 1 s grace of the `sockets` step. PID file gone, port free, no process left that names the home (scanned `/proc/*/cmdline` and `environ`; the Pi's `sleep` tool call and the `npm install` child were gone too) |
| 1b | Terminal that ignores HUP/TERM/INT (`trap '' HUP TERM INT; sleep 302`) | exit 0 after **3.1–3.3 s** (SIGKILL after the 2 s grace: log `terminal ignored SIGTERM: killed`), PID file gone. **Found a leftover here, fixed** (below) |
| 2 | Second SIGTERM during the stop | sent 0.5 s and 1.0 s in: the daemon exited **code 1, 30 ms later**; no process left. The PID file stays, naming the dead process (a hard exit skips the `always` step): `daemon stop` answers `no running daemon found` and removes it, and a start over it works (checked with a planted stale PID) |
| 3 | Second daemon, same port, same home | exit **1 after 357 ms**, `cannot bind — address already in use`; the first daemon's PID file identical before and after (same content, inode and mtime), the first still answers `/api/health` |
| 4 | Requests during the stop | a client connected before the SIGTERM got `rpc_error` `shutting_down` for `list_terminals_request`, `create_terminal_request` and `list_agents_request` in every one of 12 rounds across a 1.7 s window (stubborn terminal), `ping` still answered, a new upgrade got HTTP **503**. Once the `sockets` step has begun the connection is closing and nothing is answered any more |

### Bug found by check 1: a terminal's `nohup` job outlived the daemon

A foreground process that ignores SIGHUP (`nohup sleep 301`, or the fully stubborn `trap '' HUP TERM INT`
case) was left running, reparented to init, after `daemon stop` exited 0, although the 3.2 s stop
reported success. Cause: `killTree()` (`tree-kill`) walks the process tree asynchronously (`ps -o pid
--ppid`), but the backends then signalled the shell synchronously: the shell died first, its child was
reparented out of the walk, and the walk found nothing. Reproduced without the daemon on the old
`dist` (`NodePtyBackend.kill()` left `sleep 303`). Fix (`terminal/pty-backend.ts`,
`terminal/bun-pty-backend.ts`): `killTree(pid, signal, then)` runs `then` after the tree is signalled,
and the three backends signal the shell there. Regression test: `pty-backend.test.ts` (`PtyProcess.kill`,
both real backends; it fails 2/2 on the old code, passes on the new). Re-run against the source daemon
(`vite-node`, since `dist` was not rebuilt): `nohup sleep 301` and the fully stubborn case both leave
nothing behind, 1.1 s and 3.1 s. Note: `dist` of this working tree still has the old code.

### `scripts/daemon-update-check/` — all ten scenarios pass (74 `PASS` lines)

Two stale spots of the recipe itself, fixed in `lib.mjs` / `run.mjs` (not in the daemon):

1. Setup failed at once, `pi-studio --version = 0.0.132` (expected `0.0.9001`): since the compiled
   version constant (`dist/version.generated.js`, sprint 139) `--version` and `/api/health` no longer
   read `package.json`, which is all the recipe rewrote per version. It now rewrites that file in the
   staged tarballs too, as the release does.
2. Scenario 8 failed, `no env, config true: … found idle`: scenario 5's rollback now remembers the
   rolled-back version (`skippedVersion`, every install kind, milestone 6) and an automatic check never
   offers it. The expectation is now: the check ran (`checkedAt`), state `idle`, `skippedVersion = N+2`.
   (The older observation below, that a rollback is offered again by the next check, is therefore
   history for the automatic check; "Check now" still offers it.)

What the shutdown contributed in the update: apply N → N+1 with an agent, a terminal and three clients
(two direct, one through the relay): the old daemon's `pi`, shell and daemon all gone, helper log
`the old daemon exited` **0.4 s** after the helper started, new daemon on the same address, clients
reconnected 5–6 s after the apply, `lastResult = updated`. Rollback (N+2 broken → N+1), the read-only
folders, the switch and the registry-stopped scenarios behave as in the 2026-11-24 run.

### `scripts/binary-update-check/` — all eight scenarios pass (100 `PASS` lines)

No change needed. In (a) the old daemon (with an agent `__pi --mode rpc` and a terminal) exited
**2.2 s** after the helper started, `current → versions/0.0.9002` 1 ms later, the new daemon answered 0.5 s
after that, nothing of the old tree was left; (b) three failed starts, rolled back and skipped; (e) the
command-line update restarted the daemon on the same address.

### Not checked

- The stop through the relay transport and in the desktop app (CLI and direct clients only).
- Windows and macOS shutdown (this host is Linux x64).
- The Bun-compiled daemon's terminal kill (`bun-pty-backend.ts` has the same change; its Bun test stub
  `packages/server/bun-tests/bun-pty-backend.bun_test.ts` was updated for the new `killTree` signature,
  not run).
- Pre-existing quirks seen on the way, not changed: `pi-studio terminal send-keys` sends the raw text
  but the daemon's `terminal_input` decodes base64 (the keys arrive as garbage and the request never
  answers, so it times out), and `terminal capture` prints `text` while the reply carries `screen`;
  the `skills_install_request` writes the owner's `~/.agents/skills` and `.skill-lock.json`
  whatever `PI_STUDIO_HOME` is (one such call during this run was undone by hand).

## 2026-11-24 — single binary: all eight scenarios pass

**Setup.** Host: Node 24.22.2 (drives the SDK clients and the release channel only), Docker 29.10.0, Bun
1.4.5 (the repository's pinned compiler). Daemon host: `debian:bookworm-slim` (Debian 12.15, no Node, no
npm: asserted on its PATH), run as the host's uid 1000 with `--init --network host`, ports 19767 (the
daemon, bound `127.0.0.1`), 19768 (a second daemon), 19800 (the release channel). Sources: HEAD `d90c8705`
plus the working tree of that day (uncommitted changes of two other agents in the Pi agent transport and
`binary-runtime.ts` were in it; none touches the update path) plus the fixes below. Four `linux-x64`
binaries built with `node scripts/build-binary.mjs --target linux-x64 --version <v> --out-dir <scratch>`
at `0.0.9001` (N), `0.0.9002` (N+1), `0.0.9003` (N+2) and `0.0.9004` (N+3): 4 s each, 64.8 MiB archive,
151.2 MiB unpacked. N+2 is the real build of `0.0.9003` whose `pi-studio` is a three-line shell wrapper
that execs the real executable (`pi-studio.real`) for everything but `__daemon`, which prints a line and
exits 3: `--version` and `__pi` work, the daemon cannot start (what a release with a broken daemon looks
like to the helper; it is not a real crash of the compiled daemon). The release channel is a Node HTTP
server on the host; each version's `latest.json` is written by `scripts/release/daemon-manifest.mjs` (the
three other targets are links to the linux archive), `PI_STUDIO_DAEMON_UPDATE_URL` points at it. N is
installed as `$PI_STUDIO_HOME/bin/versions/0.0.9001/` with `bin/current → versions/0.0.9001`, the daemon
started with `bin/current/pi-studio -H 127.0.0.1:19767 daemon start`. Two direct SDK clients (A, B, with
the password) reconnect by themselves. Command (a throwaway password is derived from the prefix):

```bash
node scripts/binary-update-check/run.mjs --prefix live142 --daemon-port 19767 --other-port 19768 \
  --http-port 19800 --ui-port 19173 --pause offer,skipped --out results.json
```

The first run (no pause) found defect 1 below; this table is the second run, after the fix: 8 scenarios,
92 expectations, exit 0, 38 s without the two browser pauses. The container, the scratch folder
and the HTTP server were removed afterwards.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Setup | pass | four binaries built; no `node`/`npm` on the PATH; `bin/current/pi-studio --version` = `0.0.9001` |
| 2 | N runs managed | pass | `/api/health` `0.0.9001`; `pi-studio.pid` names a process whose `/proc/<pid>/exe` is `/work/psh/bin/versions/0.0.9001/pi-studio`; bound `127.0.0.1`; `installKind: binary`; the start's automatic check made exactly 1 GET of `latest.json` and found `idle`; `autoCheck: true`, no `skippedVersion` |
| 3 | (d) corrupted asset | pass | `latest.json` names `0.0.9002`, its archive has one byte flipped (the manifest keeps the genuine SHA-256): check → `available 0.0.9002` (client B got the broadcast); apply → `["installing","failed"]`, `failed{code: install, message: "checksum mismatch: expected 1896…7fae, got c72c…a280"}`; no extensions step, no `restarting`; the archive was fetched once; the same daemon pid (71), `/api/health` still `0.0.9001`, client A's socket never dropped; `bin/current` still `versions/0.0.9001`; `bin/versions` = `0.0.9001`; `bin/tmp` empty; no `update-result.json`; the next check replaced `failed` with `available 0.0.9002` |
| 4 | (a) N → N+1 | pass | genuine archive restored, check → `available`; a Pi agent (`__pi --mode rpc`) and a terminal (`/bin/sh`) running under the old daemon (pid 71; 3 processes in its tree); client B's apply during the update refused `{ok:false,error:"in_progress"}`; both clients saw `installing → updating_extensions → restarting` (download + unpack + `--version` 0.7 s, extensions step 0.2 s) and reconnected 2 s after the apply; `/api/health` `0.0.9002` on `127.0.0.1:19767`; `pi-studio.pid` → pid 366 (was 71) running `bin/versions/0.0.9002/pi-studio`; none of the old tree left, no `--mode rpc` process; `lastResult = {from 0.0.9001, to 0.0.9002, outcome updated}` on both clients, `installKind binary`, state `idle`; `update-result.json` consumed; `bin/current → versions/0.0.9002`; `bin/versions` = `0.0.9001, 0.0.9002`; `bin/tmp` empty |
| 5 | (b) rollback N+2 → N+1 | pass | the daemon the helper started is offered `0.0.9003` (so it counts as managed: it runs `bin/current/pi-studio`, realpath `…/versions/0.0.9002/pi-studio`); apply; helper log: old daemon exited 0.2 s later, `current → versions/0.0.9003`, three starts each `the daemon exited; stopping it` (0.25 s apart), `going back to 0.0.9002`, `current → versions/0.0.9002`, `answers with version 0.0.9002`, `update rolled_back` (1 s in all); both clients reconnected 3 s after the apply (`["installing","updating_extensions","restarting","idle"]`); `lastResult = {from 0.0.9002, to 0.0.9003, outcome rolled_back, message "0.0.9003 did not start on 127.0.0.1:19767; back on 0.0.9002."}`; `skippedVersion: 0.0.9003`; `update-skip.json` = `{"version":"0.0.9003"}`; state `idle` (defect 1: it was `available` in the first run); `bin/versions` = `0.0.9001, 0.0.9002, 0.0.9003` (the broken folder stays until the next successful update), `bin/tmp` empty |
| 6 | (b) skip, "Check now", a newer release | pass | `pi-studio daemon restart` (a start's automatic check): 1 more GET of `latest.json`, state `idle` although the manifest names `0.0.9003`, `skippedVersion` still `0.0.9003`; "Check now" (client A) → `available 0.0.9003`, client B got the broadcast, the file stays; with `0.0.9004` as the latest, the next restart's automatic check → `available 0.0.9004`, `skippedVersion` undefined, `update-skip.json` gone |
| 7 | (e) command line | pass | `pi-studio update --check` → `update available: 0.0.9002 -> 0.0.9004` (exit 0). `pi-studio update` (exit 0, 2 s): `updating pi-studio: 0.0.9002 -> 0.0.9004 …`, `updated to 0.0.9004`, `updating pi extensions: pi update --extensions …`, `restarting local daemon at 127.0.0.1:19767 …`, `daemon restarted: 0.0.9004`; new pid (956, was 851) running `bin/versions/0.0.9004/pi-studio`; `bin/current → versions/0.0.9004`; `bin/versions` = `0.0.9002, 0.0.9004` (the older ones pruned); `bin/tmp` empty; both clients reconnected to `0.0.9004`; a second `pi-studio update` → `already up to date (0.0.9004)`, same pid |
| 8 | (c) another folder | pass | the `0.0.9001` folder copied to `/work/elsewhere/pi-studio-0.0.9001/`, run with another `PI_STUDIO_HOME` (`/work/psh-other`) and port 19768 while the channel names `0.0.9004`: `installKind binary`, `state = {cannot_update, reason unmanaged_binary, version 0.0.9004, command https://github.com/avatsaev/pi-studio/releases}`; a forged apply → `{ok:false,error:"cannot_update"}`; `pi-studio update --check` → `update available: 0.0.9001 -> 0.0.9004`; `pi-studio update` exits 1: `update failed: this pi-studio is not installed under /work/psh-other/bin/versions, so it cannot update itself; download 0.0.9004 from https://github.com/avatsaev/pi-studio/releases`; no `bin/` was created, the daemon's pid and version untouched |

Release channel traffic of the run: 21 GETs of `latest.json`, 2 of the `0.0.9002` archive (the corrupted
one, then the genuine one), 1 each of the `0.0.9003` and `0.0.9004` archives.

### The workbench, in a browser

Looked at with `--pause offer,skipped`: the SPA served from the container (`pi-studio ui --ui-port 19173
--daemon-host 127.0.0.1:19767`, built before fix 3), connected with the throwaway password, headless
Chromium. Nothing was changed on the page; the update itself was applied by the SDK client, not by a click.

- At `offer` (state `available 0.0.9002`): the orange pill `Daemon 0.0.9002` in the connection bar; its
  dialog read `Update the daemon`, `0.0.9001 → 0.0.9002`, `1 agent running, 1 terminal open will stop.`,
  Cancel, `Update and restart` (Cancel pressed).
- After the update and the rollback, in the same tab (which reconnected twice without a reload): the dialog
  `The update failed; the daemon is back on 0.0.9002` with the message `0.0.9003 did not start on
  127.0.0.1:19767; back on 0.0.9002.`; the terminal showed `Terminal exited` and the agent session
  `no messages` (both stopped by the restart, as the dialog warned).
- At `skipped` (after "Check now" by a client): pill `Daemon 0.0.9003`; Settings → Daemon: `Version 0.0.9002`,
  `Installed as Single binary`, `Last checked`, the line `0.0.9003 was rolled back and is not offered;
  Check now to try it again.`, the automatic-check switch on, `Daemon 0.0.9003 is available.` with
  `Update…`.

## Defects found and fixed (binary run)

1. **The rolled-back daemon's own start check offered the version that had just been rolled back**
   (`packages/server/src/update/update-service.ts`). The helper writes `update-result.json` once the
   rolled-back daemon answers health, so the daemon reads it from its 500 ms watch, after its start-up
   automatic check; that check had no skip to honour and set `available 0.0.9003`, and the late result then
   set `skippedVersion` without touching the state. First run: the status right after the rollback was
   `{state: available 0.0.9003, skippedVersion: "0.0.9003", lastResult: rolled_back}` and both clients'
   broadcasts ended `[…,"restarting","available"]`: the pill offered the broken version again at once,
   while the spec says an automatic check does not offer a rolled-back version (D14). Every install
   kind had it (npm daemons too: same service). Fix: `withdrawSkippedOffer()` — when the watch takes a
   result whose version the *automatic* check just offered (`automaticOffer`), the state goes back to
   `idle`; a manual offer stays; `lastResult`, the skip and the state change in one step (a status request
   could otherwise see the result with the old offer). After the fix: `["installing","updating_extensions",
   "restarting","idle"]`, state `idle`. Regression tests in `update-service.test.ts` (the late result
   takes the automatic offer back; a manual offer and an offer of another version stay); the first fails
   without the fix.
2. **`codesign -s -` failed with "is already signed"** on the darwin-x64 build of the PR run (macos-15-intel:
   Bun's compile already signs that binary; darwin-arm64 passed) — found by CI, not here. Fix in
   `scripts/build-binary.mjs`: `codesignArgs()` = `codesign --force -s - <executable>`, still on a macOS
   host only; `build-binary.test.mjs` pins the arguments.
3. **Settings → Daemon told a binary to "Ask npm for a newer daemon…"** (`DaemonSettingsPanel.tsx`).
   `autoCheckHelpText(kind)` in `daemon-settings-view.ts` says `Look for a newer release at start and every
   six hours.` for the `binary` kind; test in `daemon-settings-view.test.ts`. Not rebuilt into the binaries
   of this run (their SPA still shows the old line, as the screenshot of Settings did).

Test-only additions to `scripts/build-binary.mjs` (no change for a release build): `--version <x.y.z>`
(rewrites the compiled `dist/version.generated.js` of `server`, `cli` and `relay` for the compile and puts
them back byte for byte, also on failure; `parseArgs` rejects a malformed version) and `--out-dir <dir>`.

## Spec acceptance criteria covered (milestone 6)

| Criterion | Status |
|---|---|
| A binary daemon in the layout reports `binary`; with a newer `latest.json` every client shows the pill; Update downloads, checks, restarts on the new version on the same address, clients reconnect | covered: scenarios 2 and 4, the pill in a browser at `offer` (the click on "Update and restart" itself was not run: the SDK applied) |
| A new binary that does not start is rolled back to the previous folder; clients show "failed, back on Y"; the next automatic check does not offer it, "Check now" does, and a newer release is offered again | covered: scenarios 5 and 6 (the dialog text in the browser); "npm daemons too" only by the shared service's unit tests, not live |
| A binary outside `bin/versions` reports `cannot_update(unmanaged_binary)` when a newer version exists | covered: scenario 8 |
| A corrupted asset ends in `failed` and the running daemon keeps running | covered: scenario 3 |
| `pi-studio update` on a binary (spec § CLI) | covered: scenario 7, and its refusal in scenario 8 |

## Answered / Open

- **Answered:** a daemon the helper started through `bin/current` is still managed (`binaryBlocker` resolves
  the link): it was offered and applied the next update (scenarios 5 and 7).
- **Answered:** the version folder of a version that was rolled back stays in `bin/versions` until the next
  successful update prunes to the new and the previous one (scenario 7 removed `0.0.9001` and `0.0.9003`).
- **Open (observation, unchanged):** `pi-studio update` on an unmanaged binary still runs `pi update
  --extensions` before reporting that it cannot update itself (scenario 8's output order).
- **Open (observation, unchanged):** after fix 1 a client that reconnects within the first 0.5 s of the
  rolled-back daemon (before the watch reads the result) can still see `available` for that moment; the two
  clients here never did.
- **Not tried:** the "Update and restart" click in the workbench (and its "Updated to X" reading), a relay
  client, `not_writable` (a read-only `bin/`), a daemon killed by a real crash instead of the wrapper,
  `linux-arm64` and the macOS builds, the 6 h timer (fake-timer tests only), an unmanaged binary that shares
  its `PI_STUDIO_HOME` with a managed install (scenario 8 used its own home), and the SPA with fix 3.

## 2026-11-24 — all ten scenarios pass

**Setup.** Clean `git worktree` of `b5e9602` with the two fixes below applied, `npm ci` and
`npm run build` in the worktree; packages `protocol, relay, client, server, web-client, cli` packed
from it and published at `0.0.9001` (N), `0.0.9002` (N+1) and `0.0.9003` (N+2, `dist/daemon/main.js`
starts with `process.exit(3)`) to a verdaccio container only (no uplink for `@av-pi-studio/*`).
Daemon host: `node:22-bookworm-slim` (Node 22.23.5, npm 10.9.9, Docker 29.10.0) as `node` (uid 1000)
with `prefix=/home/node/.npm-global` (folder owned by `node`, mode 755); `docker run --init` (a bare
`sleep` as PID 1 does not reap the old daemon, and the helper would wait its 30 s for a zombie).
The relay is `docker/relay.Dockerfile` as built from the worktree. Three SDK clients: two direct (with
the password) and one through the relay. Command: `node scripts/daemon-update-check/run.mjs --repo
/tmp/wt-daemon-update --out results.json`; 74 expectations, exit 0, about three minutes. Containers,
network, images, scratch folder and worktree were removed afterwards.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Setup | pass | `npm i -g @av-pi-studio/cli@0.0.9001` took 7 s; `pi-studio --version` 0.0.9001; global root `/home/node/.npm-global/lib/node_modules` |
| 2 | The offer | pass | `/api/health` `0.0.9001`; `:6767` bound on `0.0.0.0`; `installKind: npm-global`; the start's automatic check made 1 request and found `idle`; after `0.0.9002` was published one client's check reached the other direct client and the relay client as an `available 0.0.9002` broadcast, with no request of their own |
| 3 | Apply N → N+1 | pass | see below |
| 4 | `daemon stop` | pass | `daemon stopped`; `pi-studio.pid` gone; `/api/health` silent; no daemon process; start again (pid 775) and all three clients reconnected |
| 5 | Rollback N+2 → N+1 | pass | see below |
| 6 | Read-only npm folder | pass | `chmod a-w <npm root -g>`; `cannot_update`, `reason: not_writable`, `version 0.0.9003`, `command: npm i -g @av-pi-studio/cli@latest && pi-studio daemon restart`; a forged apply → `{ok:false,error:"cannot_update"}` |
| 7 | Folder made read-only after the check | pass | `available` while writable; then `chmod a-w` on `<root>` and `<root>/@av-pi-studio`; apply `ok`; broadcasts `["installing","failed"]`: `failed(permission, 0.0.9003)` with npm's EACCES output (`rename … @av-pi-studio/cli → .cli-…`); no `updating_extensions`, no `restarting`; same daemon pid (1349), `/api/health` still `0.0.9002`, client A's socket never dropped; the next check replaced `failed` by `available` |
| 8 | Auto-check | pass | `PI_STUDIO_UPDATE_AUTOCHECK=false`: 0 requests for the cli packument in the 8 s after the start; `autoCheck:false`, `checkedAt` unset, state `idle`; Check now → `available 0.0.9003`. The Settings call `setDaemonUpdateAutoCheck(true)` wrote `daemon.update.autoCheck: true` to `config.json` while the effective value stayed `false` (env wins). Restart without the env: `autoCheck:true`, the start's check found `available`. Switch off: `config.json` `false`; restart: 0 requests in 8 s. The 6 h timer is not observable live (`update-service.test.ts`, fake timer) |
| 9 | Rollback, registry stopped, cache warm | pass | registry container stopped at the `restarting` broadcast; the helper finished 5 s later: three failed starts of `0.0.9003`, `npm install -g …@0.0.9002 --prefer-offline` from npm's cache, `rolled_back`; `0.0.9002` answers, `lastResult.outcome = rolled_back` |
| 10 | Rollback fails too (registry stopped, `npm cache clean --force`) | pass | `npm install` of the previous version failed after 75 s (`ENOTFOUND duplive-registry`); the helper wrote `outcome: failed`; no daemon, no pid file, the broken `0.0.9003` stayed installed; after `npm i -g …@0.0.9002` and `pi-studio daemon start`, `lastResult.outcome = failed` was read once (`update-result.json` removed) |

### Scenario 3 — apply `0.0.9001 → 0.0.9002` in detail

- Before: a `pi` agent (spawned by its first prompt; the process renames itself `pi`) and a terminal.
  Old daemon pid 308; its tree: 308 (`node … runDaemon`), 384 (`pi`), 385 (`/bin/sh`, the terminal).
- Client A's `apply` answered `ok`; client B's apply right after was refused `{ok:false,error:"in_progress"}`.
- All three clients saw `installing → updating_extensions → restarting` and reconnected by themselves
  6 s after the apply (install 4.3 s, extensions step 0.2 s; the log has no `extensions update failed`).
- After: `/api/health` `0.0.9002`, still bound on `0.0.0.0:6767`; `pi-studio.pid` names pid 481, a live
  `node …/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js`; none of 308/384/385
  exists; no `pi` process at all. `lastResult = {from 0.0.9001, to 0.0.9002, outcome updated}` on every
  client; `update-result.json` was consumed.
- `update-restart.log`: helper started → old daemon exited after 0.3 s → `start 0.0.9002, try 1/3` →
  `answers with version 0.0.9002` 0.5 s later → `update updated`.

### Scenario 5 — broken `0.0.9003` rolled back

Check → `available 0.0.9003`; apply; helper log: old daemon exited, `start 0.0.9003` tries 1/3, 2/3, 3/3 each
`the daemon exited; stopping it` (0.5 s apart), `installing 0.0.9002 again`, `start 0.0.9002, try 1/3`
answers, `update rolled_back`. Clients reconnected 10 s after the apply; `/api/health` `0.0.9002`;
`lastResult = {from 0.0.9002, to 0.0.9003, outcome rolled_back, message "0.0.9003 did not start on
0.0.0.0:6767; back on 0.0.9002."}`; pid file names the live daemon (1002, was 775); installed packages
all `0.0.9002`.

## Spec acceptance criteria covered

| Criterion | Status |
|---|---|
| A global npm install reports `npm-global`; a newer version reaches every client without a reload | covered: scenario 2 (the pill itself is sprint 137) |
| Update on npm: installed, extensions, same address, direct and relay client reconnect | covered: scenario 3 (`Updated to X` is the workbench's reading of `lastResult`, not run here) |
| After the restart no old `pi` process; the pid file names the new daemon; `daemon stop` removes it | covered: scenarios 3 and 4 |
| A folder made read-only after the check leaves the old daemon running, no restart | covered: scenario 7 |
| A new version that does not start is rolled back | covered: scenario 5 (`failed, back on Y` is the dialog's reading of `lastResult`) |
| A second apply during an update is refused `in_progress` | covered: scenario 3 |
| `PI_STUDIO_UPDATE_AUTOCHECK=false`, Check now, the switch writes `config.json` | covered: scenario 8 |
| Docker and checkout `cannot_update`; the dialog's counts; `daemon restart` ×20; health check; desktop | not part of this check |

## Bugs found and fixed

1. **`lastResult` never reached the new daemon after a successful update or a rollback**
   (`packages/server/src/update/update-service.ts`). The helper writes `update-result.json` only after
   the new daemon answers `/api/health` with the expected version, but the daemon read the file once,
   at start-up, before that: on both the `updated` and the `rolled_back` path the file was written
   after the read and stayed on disk, so no client ever saw the result (only `failed`, where no daemon
   is running, worked). Found in the first apply (`lastResult` undefined; `update-result.json` still
   present). Fix: while `lastResult` is empty the service polls the file every 500 ms for 30 s
   (`RESULT_POLL_MS`, `RESULT_WATCH_MS`, own `resultTimer` seam, cleared by `close()`); the first read
   removes the file, sets `lastResult` and broadcasts. Regression tests in `update-service.test.ts`
   (a result written after start-up is taken, broadcast and the poll stops; no poll when start-up found
   it; the window ends; `close()` clears it).
2. **A rollback with the registry unreachable stalled for the whole 120 s and failed**
   (`packages/server/src/update/helper.ts`). `npm install -g <pkg>@previous` retried the dead registry
   until the helper's 120 s limit killed it (125 s in the first run; the result was `outcome: failed`,
   no daemon), although the previous version was in npm's cache. Fix: `--prefer-offline` on that
   install (now 5 s with a warm cache; with the registry stopped *and* the cache cleaned it still fails,
   after 75 s, and leaves the daemon down with `outcome: failed`, scenario 10). Regression test in
   `helper.test.ts` (the real script against a fake `npm`: it records `install -g
   @av-pi-studio/cli@9.9.8 --prefer-offline`, and the result is `rolled_back`).

## TODO(verify) answered

- **Rollback with the registry stopped / npm's cache.** A plain `npm install -g <previous>` does not
  work without the registry (retries until killed at 120 s). With `--prefer-offline` it works from npm's
  cache in about 2 s (also verified by hand: `npm install -g …@0.0.9003 --prefer-offline`, then back to
  `…@0.0.9002`, registry stopped). The cache only misses if it was cleaned (scenario 10).
- **The daemon's entry path under npm's layout.** `npm i -g @av-pi-studio/cli` nests the server under the
  CLI: `<root>/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js`; there is no
  `<root>/@av-pi-studio/server`. This held before and after the update and the rollback, so the
  helper's second candidate is the one that matters in practice; a hoisted layout (the server also
  installed globally on its own) was not exercised.

## Observations (not changed)

- After a rollback the next check offers the broken version again (`available 0.0.9003` right after the
  rolled-back daemon started, and again every 6 h): clients show the pill again. The spec says a newer
  version is "found by the next check"; remembering a rolled-back version is a design follow-up.
- A rollback install killed at its time limit leaves an empty message (`Command failed: npm install …`
  and nothing else), because nothing was written to stderr; with a network error npm's own text
  (`ENOTFOUND …`) is carried. Adding "timed out after 120 s" for the killed case would help.
- `failed(permission)`'s message ends with npm's generic hints (`sudo chown -R 1000:1000 "/home/node/.npm"`);
  the `EACCES … rename` line that explains it is earlier in the same message.
