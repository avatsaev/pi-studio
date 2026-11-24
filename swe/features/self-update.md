# Feature — Daemon self-update

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Status: **built and verified on Linux 2026-11-24** (sprints 135–138) from the grill
> [../grills/daemon-self-update.md](../grills/daemon-self-update.md)
> (D1–D16 owner, P1–P15 agent). Roadmap step 5b. Replaces the text of 2026-08-26, which was never built.
> **Amended 2026-11-24 for milestone 6, built and verified on Linux (sprint 142):** the `binary` install kind, the skipped version
> after a rollback, and the desktop's Update (now the pinned binary), from the grill
> [../grills/single-binary-daemon.md](../grills/single-binary-daemon.md) (D7, D13, D14, P15). The
> amended parts are marked "(milestone 6)".
> Dependencies: [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md) (start, PID
> lock, shutdown), [cli.md](cli.md) (`update`, `daemon stop|restart`),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md) (RPC families, feature
> flags), [preinstalled-extensions.md](preinstalled-extensions.md) (the bundled `pi` spawn seam),
> [desktop-self-update.md](desktop-self-update.md) (the app's own update: the pill this one sits beside),
> [desktop-daemon-registry.md](desktop-daemon-registry.md) and [desktop-relay-ssh.md](desktop-relay-ssh.md)
> (the app's local and SSH daemon supervisors).

## Purpose

A daemon installed with `npm i -g @av-pi-studio/cli` updates itself when a connected client asks: it
checks npm, tells every client that a newer version exists, and after one confirmed click installs it,
updates the Pi extensions, restarts on the same address, and reports the outcome. A user of a remote
daemon (relay, SSH) no longer needs a shell on the host. The desktop app can also update a local or
SSH daemon that is stopped or too old to have this feature, by running the CLI on the host.

Two shutdown defects are fixed with it, because a self-restart makes them routine (D5): agent
processes are not stopped when the daemon closes, and `pi-studio.pid` is never removed. The CLI's
restart race is fixed too (D15).

## Ground truth (checked 2026-11-23)

- `SERVER_VERSION` (`packages/server/src/version.ts`) is the real version on every handshake path and
  in `daemon_status`. All eight packages share one version; `@av-pi-studio/cli` is published last, so
  its newest version means the whole set is on npm. A new version appears on every merge to `main`
  that is not desktop-only.
- `packages/cli/src/update-control.ts` holds the tested engine: `npm view` (15 s, every failure →
  null), `npm install -g` (120 s, npm's ENOTEMPTY staging case retried three times), numeric `x.y.z`
  comparison. `pi-studio update` installs, runs `pi update --extensions`, and never restarts a daemon.
- `startDaemon().close()` (`daemon/bootstrap.ts`) kills terminals and closes the sockets; it does not
  close agent sessions and does not remove `pi-studio.pid`. The Pi adapter's `AgentSession.close()`
  tree-kills its child.
- `pi-studio daemon restart` sends SIGTERM and at once probes health: an old daemon that still
  answers makes it report "already running" and start nothing. Nothing in the repo waits for a
  process to exit.
- The daemon binds `PI_STUDIO_LISTEN` → `config.daemon.listen` → `127.0.0.1:6767`. The CLI starts it
  detached with `node --input-type=module -e` and an absolute module URL.
- `/api/health` answers `{"status":"ok"}`, without authentication.
- The Docker image is a repository build without the CLI package. Nothing in the code knows how the
  daemon was installed. Neither the CLI nor the server has any Windows-specific code.
- Workbench: the settings gear is always shown; categories are `providers`, `skills`, `viewers`
  (`features/settings/settings-categories.ts`); `openSettings()` takes no category. The app's update
  pill (`AppUpdateIndicator`) sits at the far right of the connection bar, on the desktop only.
- Desktop: the local supervisor runs the installed CLI (`--version`, `--json daemon
  status|start|restart|stop`); below `0.0.127` the state is `cli_outdated` and the Daemons screen shows
  the npm command. The SSH supervisor runs `pi-studio --version` and `daemon start` on the host.

## Non-goals

- Docker and a repository checkout updating themselves (D2). They report why not and show the
  command. The single binary updates itself since milestone 6 (install kind `binary`).
- Choosing a version, downgrading by hand, release channels.
- A "Restart daemon" button of its own.
- Updating the web client's files where they are hosted elsewhere, or the desktop app.
- A signature of our own on the package: trust is npm's (P10).
- Windows hosts: `cannot_update(unsupported_platform)`.

## Public contract

### Install kind (P3)

Found once at start. `PI_STUDIO_INSTALL_KIND` (one of the four values) wins; `docker/daemon.Dockerfile`
sets it to `docker`.

| Kind | How it is found | Can update |
|---|---|---|
| `npm-global` | the server package's directory is inside `npm root -g` | yes |
| `docker` | the environment variable | no |
| `source` | the server package is `<root>/packages/server` and `<root>/package.json` has `workspaces` | no |
| `unknown` | anything else (a project-local install, `npx`, `npm` not found) | no |
| `binary` (milestone 6) | a build-time constant of the single binary | yes, when the executable is `$PI_STUDIO_HOME/bin/versions/<version>/pi-studio` and `bin` is writable; otherwise `cannot_update(unmanaged_binary)` |

### Feature flag

`server_info.features.daemonUpdate`: this daemon speaks the family below. It says nothing about
whether this install can update; the state does.

### RPCs and the broadcast (P1)

Flat snake_case, real schemas in `packages/protocol/src/messages.ts`, members of the session message
union. Authenticated sessions only, no role (D13).

| Message | Direction | Payload | Notes |
|---|---|---|---|
| `daemon_update_status_request` | client → daemon | none | answers `daemon_update_status_response { status }` |
| `daemon_update_check_request` | client → daemon | none | asks npm now; answers `daemon_update_check_response { status }` when the check ended; a failed check is in `status.checkError`, never `rpc_error` |
| `daemon_update_apply_request` | client → daemon | none | answers at once: `daemon_update_apply_response { ok: true }` or `{ ok: false, error }`; the work is reported by the broadcast |
| `daemon_update_set_auto_check_request` | client → daemon | `{ enabled: boolean }` | writes `daemon.update.autoCheck`, starts or stops the timer, answers `{ status }` |
| `daemon_update_status` | daemon → every session | `{ status }` | on every change, and to each session right after `server_info` |

`error` of a refused apply: `not_available` (nothing newer known), `cannot_update`, `in_progress`.
A client cannot name a package or a version (P10).

```
DaemonUpdateStatus {
  currentVersion: string
  installKind: "npm-global" | "docker" | "source" | "unknown" | "binary"
  autoCheck: boolean
  checkedAt?: number            // epoch ms of the last finished check
  checkError?: string           // "offline" | "bad_answer"; set by the last check only
  state:
    | { kind: "idle" }                              // nothing newer known
    | { kind: "checking" }
    | { kind: "available", version }
    | { kind: "installing", version }
    | { kind: "updating_extensions", version }
    | { kind: "restarting", version }
    | { kind: "failed", version, code, message? }   // code: "install" | "timeout" | "permission" | "network"
    | { kind: "cannot_update", reason, version?, command }
  lastResult?: { from, to, outcome: "updated" | "rolled_back" | "failed", at, message? }
  skippedVersion?: string       // milestone 6: a version that was rolled back (D14)
}
```

`cannot_update.reason`: `docker`, `source`, `unknown_install`, `npm_missing`, `not_writable`,
`unsupported_platform`, and since milestone 6 `unmanaged_binary` (a binary outside
`$PI_STUDIO_HOME/bin/versions/`). `command` is the line to run by hand for that reason (`npm i -g
@av-pi-studio/cli@latest` then `pi-studio daemon restart`; `docker compose pull && docker compose up
-d`; `git pull && npm run build`; for a binary, the address of the release page). `version` is
present when a newer one is known. `message` is the last 2048 characters of the failed command's
output, with credentials in URLs removed (`redactSource`).

`skippedVersion` (milestone 6, D14): written when the daemon reads an `update-result.json` whose
outcome is `rolled_back` or `failed`; kept in `$PI_STUDIO_HOME/update-skip.json`. An automatic check
that finds exactly that version leaves the state `idle`; a manual check ("Check now") offers it; a
newer version clears it. Applies to every install kind.

### Other surfaces

| Surface | Change |
|---|---|
| `GET /api/health` | `{ "status": "ok", "version": SERVER_VERSION }` |
| `config.json` `daemon.update.autoCheck` / env `PI_STUDIO_UPDATE_AUTOCHECK` (wins) | default `true`; `false`: no check at start, no timer (D16) |
| `PI_STUDIO_INSTALL_KIND` | see Install kind |
| `$PI_STUDIO_HOME/update-result.json` | written by the helper, read once and removed at the next start (P8) |
| `$PI_STUDIO_HOME/update-skip.json` (milestone 6) | `{ version }`, the skipped version (D14) |
| `https://github.com/avatsaev/pi-studio/releases/download/daemon-updates/latest.json` (milestone 6) | what a `binary` daemon checks ([single-binary-daemon.md](single-binary-daemon.md) § Release files) |
| `$PI_STUDIO_HOME/logs/update-restart.log` | the helper's own log |
| `$PI_STUDIO_HOME/pi-studio.pid` | removed on a clean shutdown |
| Client SDK (`PiStudioClient`) | `getDaemonUpdateStatus()`, `checkDaemonUpdate()`, `applyDaemonUpdate()`, `setDaemonUpdateAutoCheck(enabled)`, `onDaemonUpdateStatus(cb)`, `hasDaemonUpdateCapability()` |
| CLI | `pi-studio update` restarts a running local daemon after the install; `daemon stop` and `daemon restart` wait for the old process to exit (P13) |
| Desktop commands | `daemon.local.update`, `daemon.remote.update` (P12) |

## Behavior & algorithms

### Where the code lives (P6)

The engine moves to `packages/server/src/update/`; `packages/cli` imports it (a third narrow
exception in `packages/cli/AGENTS.md`: pure and process-control modules, never the daemon's
lifecycle).

```
packages/server/src/update/
  install-kind.ts    install kind, npm's global folder (cached), the writability probe
  npm.ts             latest version, version comparison, the global install with its retry
  process-wait.ts    waitForProcessExit(pid, {timeoutMs, pollMs})
  helper.ts          the helper's script text and its spawn
  update-service.ts  state, the timer, single flight, the apply pipeline, the result file
  update-rpc.ts      the handlers
```

### Check (D3, P4, P5)

```
at start, after the daemon listens (never delays the start):
    kind = installKind()
    result = readAndRemove(update-result.json)          # → status.lastResult
    if autoCheck: check(automatic); every 6 h: check(automatic)   # timer unref'd, cleared in close()

check(by):
    if an update is running: return
    latest = kind is binary ? GET daemon-updates/latest.json (15 s; never the GitHub API, P15)
                            : `npm view @av-pi-studio/cli version` (15 s; honours the host's .npmrc)
    checkedAt = now
    if latest is not x.y.z:  checkError = offline | bad_answer; state = what it was before
    else:
        checkError = none
        if skippedVersion and latest > skippedVersion: clear skippedVersion        # milestone 6
        if latest <= currentVersion:            state = idle
        else if by is automatic and latest == skippedVersion: state = idle       # milestone 6, D14
        else if kind is binary:
            if outside bin/versions or bin not writable: state = cannot_update(unmanaged_binary | not_writable, latest)
            else if no asset for this system:       state = cannot_update(unsupported_platform, latest)
            else:                                   state = available(latest)
        else if kind != npm-global:             state = cannot_update(kind's reason, latest)
        else if npm not found:                  state = cannot_update(npm_missing, latest)
        else if global folder not writable:     state = cannot_update(not_writable, latest)
        else if platform is Windows:            state = cannot_update(unsupported_platform, latest)
        else:                                   state = available(latest)
    broadcast when the status changed
```

A failed automatic check changes nothing a user sees. A manual check answers with `checkError`.
With no newer version, a daemon that cannot update stays `idle`: the reason is shown only when there
is something to install (Settings shows the install kind at all times).

### Apply (D4, D8, D11, D14)

```
apply():
    if state is installing | updating_extensions | restarting:  refuse in_progress
    if state is cannot_update:                                  refuse cannot_update
    if state is not available:                                  refuse not_available
    target = state.version; previous = currentVersion
    state = installing(target); broadcast; answer ok
    run in the background:
        npm install -g @av-pi-studio/cli@target        # 120 s, ENOTEMPTY retry ×3
        on failure: state = failed(code, message); broadcast; STOP     # no restart (D11)
        state = updating_extensions; broadcast
        run the bundled pi `update --extensions` (180 s)                # failure: logged, goes on (D8)
        state = restarting; broadcast
        spawn the helper(oldPid, target, previous, env, effective listen, home)
        wait 300 ms (the last broadcast reaches the sockets)
        close()                                         # the same shutdown every path uses
        exit 0
```

The request answers before the work: the work takes minutes and ends by closing the socket. Nothing
runs between the install and the restart but the extensions step, a child process: the running
daemon's files were replaced, and code it has not loaded yet would come from the new version.

A `failed` state is replaced by the next check (`available` again, so the pill offers a retry).

**Binary (milestone 6, D7, D13).** The same states, with the install step replaced:

```
    installing(target):
        GET the asset of this system from latest.json into $PI_STUDIO_HOME/bin/tmp/ (60 s stall limit)
        SHA-256 must equal latest.json's; unpack into bin/tmp/<random>/ (no entry outside it)
        the unpacked pi-studio --version must equal target
        move it to bin/versions/<target>/          # failure at any step: failed(install|network, message); no restart
    updating_extensions: run the NEW binary's `__pi update --extensions` (180 s)
    restarting: spawn the helper from the NEW binary (`__update-helper`), then close() and exit
```

`current` is not switched before the restart: the helper does it after the old daemon exited, so a
failed install never touches the running version.

### The helper (P7, P8, D12)

A detached process started before the shutdown. Its script is one self-contained text passed with
`node -e`: it imports nothing from the package, because the package is replaced under it.

```
helper(oldPid, target, previous, env, listen, home):
    log to home/logs/update-restart.log
    wait for oldPid to exit (30 s; then go on)
    for try in 1..3:
        start the daemon (entry found again under npm's global folder, same env, PI_STUDIO_LISTEN=listen)
        if /api/health answers with version == target within 6 s:
            write update-result.json {from: previous, to: target, outcome: updated}; exit
        stop what was started
    npm install -g @av-pi-studio/cli@previous            # 120 s
    start the daemon; wait for health with version == previous (6 s, 3 tries)
    write update-result.json {from: previous, to: target,
                              outcome: rolled_back when it answers, else failed, message}
```

The environment is carried, not derived again, with `PI_STUDIO_LISTEN` set to the address the old
daemon was bound to, so the new one binds the same. The daemon's entry is found again after the
install (`<npm root -g>/@av-pi-studio/server/dist/daemon/main.js`, then the path nested under the CLI
package), because the layout may differ between versions. When even the previous version does not
start, the daemon stays down and the log's last line says to run `pi-studio daemon start`.

The started daemon reads `update-result.json` once, removes it, and carries it as `lastResult` until
the next update. Clients show it once per result (the workbench remembers the `at` it has shown).

**Binary helper (milestone 6).** The same steps with links instead of npm:

```
binary helper(oldPid, target, previous, env, listen, home):
    wait for oldPid to exit (30 s)
    switch bin/current → versions/<target>
    for try in 1..3: start current/pi-studio's daemon; health with version == target within 6 s → updated; exit
    switch bin/current → versions/<previous>; start it; health with version == previous
    write update-result.json {outcome: rolled_back when it answers, else failed}
    after `updated`: remove version folders other than target and previous
```

### Shutdown (D5, P9)

```
close():
    clear the check timer
    for each agent with a live session, at once: session.close()   # 5 s each, then kill the process tree
    terminals: killAll()
    file watchers, status and log services, relay, sockets, http server   # as today
    remove pi-studio.pid when it still names this process
```

Agent records stay on disk; an agent resumes its Pi session at the next prompt, as after any
restart. One provider that hangs cannot stop the shutdown.

### CLI (D15, P13)

- `daemon stop`: SIGTERM, then wait up to 10 s for the process to exit (`waitForProcessExit`);
  reports `stopped: false` with a reason when it does not. A PID file naming a process that is not a
  daemon (health does not answer and the process is not `node`) is removed and reported as not
  running.
- `daemon restart`: stop as above, then start. It never reports "already running" for the process it
  just stopped.
- `update`: as today, then, when a local daemon is running, restarts it and reports the version that
  answers. `update --check` is unchanged.
- Milestone 6, a binary: `update` installs the newest version of `daemon-updates/latest.json` into
  `bin/versions/`, switches `current`, and restarts a running daemon as above; `update --check` reads
  the same file. A process counts as a daemon when it is `node` or `pi-studio`.

### Workbench (D6, D7, D10, P11)

- **Pill.** A second pill of the app pill's styles, left of the app's own, drawn when the daemon has
  the flag: `available` → "Daemon 0.0.130" (orange); `installing`, `updating_extensions`,
  `restarting` → "Daemon updating" (grey, spinner); `failed` → "Daemon update failed" (red);
  `cannot_update` with a version → "Daemon 0.0.130 available" (grey). Nothing for `idle`, `checking`
  and `cannot_update` without a version. Every pill opens the dialog. The pill's component is the
  app pill's, given a view; the two presentations stay separate modules.
- **Dialog.** Current and new version; the counts "N agents running, M terminals open will stop"
  (agents from the session store, terminals from the daemon's list, so another client's terminals
  count); "Update and restart" and Cancel. Then the three stages in the same dialog, then
  "Restarting", then the result after the reconnect: "Updated to X", or "The update failed; the
  daemon is back on Y", with the message. For `cannot_update`: the reason in words and the command
  with a copy button. For `failed`: the message, the command, and Retry.
- **Reload note.** In a browser, when the page's own version differs from the daemon's after an
  update, the result shows a Reload button and one line saying the page is older. No automatic
  reload. The desktop app shows neither.
- **Settings → Daemon.** A new category, present when the daemon has the flag: version, install
  kind, last check, "Check now", the automatic-check switch, and the same Update action. Since
  milestone 6 it also shows a `skippedVersion`: "X was rolled back and is not offered; Check now to
  try it again".
- **Other clients.** Every client shows the same pill states from the broadcast; when the socket
  drops during `restarting` the usual reconnecting state shows; after the reconnect each client asks
  for the status and shows `lastResult` once.
- The desktop's "outdated daemon" toast keeps its text but its action opens the Daemons screen
  (where Update is).

### Desktop (D9, P12)

**Changed in milestone 6.** The local entry and an SSH entry no longer run an installed CLI: Update on
the Daemons screen installs the binary pinned in the app and restarts the daemon on it, for a daemon
that is `outdated` (older than `minDaemonVersion`) or stopped with a binary older than the pin
([single-binary-daemon.md](single-binary-daemon.md), [desktop-ssh-daemon-install.md](desktop-ssh-daemon-install.md)).
A running daemon at or above the minimum is updated through the workbench's pill. The `pi-studio
update` path of milestone 5b, its `update_failed` state and the npm instructions are removed.

## Data & persistence touchpoints

Nothing is migrated. The update state is memory only. New files: `update-result.json` (short-lived),
`logs/update-restart.log`, and since milestone 6 `update-skip.json` and the `bin/` folder of a binary
install. `config.json` gains `daemon.update.autoCheck`, written by a targeted read-merge-write like
the other config writers. The workbench keeps the last shown result's `at` per daemon in its stored
state.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| npm unreachable, slow, or answers something else | automatic check: nothing changes; manual: `checkError` shown; 15 s limit |
| Already newest | `idle`; apply refused `not_available` |
| Docker, checkout, unknown install, npm missing, folder not writable, Windows | `cannot_update` with the command once a newer version is known; apply refused on the daemon |
| Two clients click | the first wins; the second gets `in_progress`; both see the same states |
| A client connects during an update | receives the status after `server_info` |
| The install fails | `failed` with the reason and message; the old daemon keeps running; no restart |
| The extensions step fails or `pi` is not found | logged; the update goes on |
| The old daemon does not exit within 30 s | the helper goes on; a start that fails counts as a try |
| The new daemon does not answer with the new version in three tries | the previous version is installed and started; `lastResult.outcome = rolled_back` |
| The rollback fails too | the daemon stays down; the helper's log says how to start it; `outcome = failed` is read at the next start |
| A newer version is published during an update | found by the next check |
| Automatic check off | no check at start, no timer; "Check now" works |
| Agents running at the restart | closed; they resume at the next prompt; the dialog said how many |
| A provider hangs in `close()` | 5 s, then its process tree is killed |
| `update-result.json` unreadable | removed, logged, no `lastResult` |
| A daemon without the flag | no pill, no category; the desktop's Update covers local and SSH entries (P15) |
| The web page is older than the daemon | the Reload note (browser only) |
| Relay and SSH clients | the daemon registers at the relay with the same key; pairing links and SSH tunnels keep working; clients reconnect by themselves |
| A version was rolled back (milestone 6) | not offered by an automatic check until a newer one exists; "Check now" offers it (D14) |
| GitHub unreachable or `latest.json` malformed, binary (milestone 6) | as npm unreachable: `checkError` on a manual check only |
| The asset's checksum differs, binary (milestone 6) | `failed(install)`; the file is deleted; the running daemon is untouched |
| A binary run from outside `bin/versions` (milestone 6) | `cannot_update(unmanaged_binary)` with the release page |

## Dependencies on other specs

- `architecture/daemon-bootstrap.md`: the shutdown order and the PID file.
- `features/cli.md`: `update`, `daemon stop`, `daemon restart`.
- `architecture/websocket-protocol.md`: the new family and flag.
- `features/preinstalled-extensions.md`: the bundled `pi` spawn.
- `features/desktop-daemon-registry.md`, `features/desktop-relay-ssh.md`: the two supervisors gain Update.
- `features/desktop-self-update.md`: the pill component both updates share.
- `architecture/single-binary-daemon.md`, `features/single-binary-daemon.md`: the `binary` install
  kind, its release files and its layout (milestone 6).

## Acceptance criteria

Evidence: `packages/server/docs/daemon-update-live-results.md` (real `npm i -g` in containers, local
registry), `desktop/docs/platform-checks.md` (daemon rows D-U1…, real webview), the browser check of
sprint 137/t004 (headless Chromium, dark and light, two clients), and the unit tests.

- [x] A global npm install reports `npm-global`; with a newer version on npm every connected client
      shows "Daemon X" without a reload. Docker and a checkout report `cannot_update` with their
      command, and a forged apply against them is refused. *(Live: npm-global, offer to three clients,
      a forged apply against a read-only folder refused. Docker and checkout: unit tests and the dev
      daemon's `source` kind; not run inside a Docker image.)*
- [x] The dialog's counts include a terminal opened by another client. *(Browser check; agents are
      counted from `list_agents_request`, a defect found there.)*
- [x] Update on an npm install: the version is installed, extensions updated, the daemon restarts on
      the same address (a daemon bound to `0.0.0.0:6767` stays there), a direct and a relay client
      reconnect by themselves and show "Updated to X". *(Live: three clients, one through the relay.)*
- [x] After that restart no `pi --mode rpc` process of the old daemon is left, and `pi-studio.pid`
      names the new daemon. After `pi-studio daemon stop` the file is gone.
- [x] A failed install (a folder made read-only after the check) leaves the old daemon running, with
      the message shown and no restart.
- [x] A new version that does not start is rolled back: the old version answers again and clients
      show "failed, back on Y".
- [x] A second apply during an update is refused with `in_progress`.
- [x] `PI_STUDIO_UPDATE_AUTOCHECK=false`: no check at start, no timer; "Check now" works; the switch
      in Settings writes `config.json`. *(The 6 h timer itself: fake-timer tests only.)*
- [x] `pi-studio daemon restart` ends with a new process every time (run 20 times in a loop);
      `pi-studio update` restarts a running daemon.
- [x] `/api/health` carries the version; the Docker health check still passes. *(The health body is
      tested and the check reads only `status`; the Docker image's check was not run.)*
- [x] Desktop: a local daemon below the minimum, and a stopped SSH one, is updated and started by
      Update; a failure shows the output's last lines. *(Linux, real webview. The "outdated" CLI was
      this repository's build relabelled below the minimum.)*
- [x] The browser client without the flag (an older daemon) shows no pill and no Daemon category.
      *(A scratch script stripped the flag; not a build of an older commit.)*

Milestone 6 (built; proof on Linux live in a Node-less container, D16: `packages/server/docs/daemon-update-live-results.md`, `scripts/binary-update-check/`):

- [x] A binary daemon in the layout reports `binary`; with a newer `daemon-updates/latest.json` every
      client shows the pill; Update downloads, checks, restarts on the new version on the same
      address, and clients reconnect.
- [x] A new binary that does not start is rolled back to the previous folder; clients show "failed,
      back on Y"; the next automatic check does not offer it, "Check now" does, and a newer release
      is offered again (npm daemons too).
- [x] A binary outside `bin/versions` reports `cannot_update(unmanaged_binary)` when a newer version
      exists.
- [x] A corrupted asset ends in `failed` and the running daemon keeps running.

## Resolved by the build (2026-11-23/24, sprints 135–138)

- `pi --mode rpc` exits by itself within 1 s when the daemon is killed with SIGKILL (idle or stuck
  turn; grandchildren of a long tool call not tested). The shutdown closes sessions regardless.
- `npm install -g <previous>` with the registry unreachable stalls to its limit; with
  `--prefer-offline` it installs from npm's cache in about 2 s and fails only when the cache was
  cleaned. The helper uses `--prefer-offline` for the rollback.
- In an npm global install the server is nested at
  `<root>/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js`; the helper tries
  the hoisted path and the nested one and takes the one whose `package.json` version matches.
- A daemon started by the CLI has to boot through `runDaemon` (signal handlers and the restart hook),
  not `startDaemon`; the CLI's starter does since sprint 136/t004.
- The helper writes `update-result.json` after the new daemon answers health, so the daemon polls the
  file for 30 s after start; reading it once at start missed it.
- Found in the desktop run: the SSH update must pass `-H 127.0.0.1:<port>`; a manual disconnect must
  end `idle`; a restart longer than the probe must not mark the local daemon `stopped`; Update must be
  allowed after a failed update.

## TODO(verify)

- Is `npm` on the PATH of a daemon started by the desktop app on macOS (GUI apps get a short PATH;
  the app finds the CLI through the login shell's environment)? — a Mac is not available:
  [INFERENCE] until seen.
- Resolved by the grill of 2026-11-24 (D14): a version that was rolled back is skipped by automatic
  checks until a newer one appears (milestone 6, built and seen live).
- macOS and Windows: no live run (owner's decision); Windows hosts report
  `cannot_update(unsupported_platform)`.
- Not seen live: a hoisted npm layout; the 6 h timer; dialog counts with agents running in the real
  app; a truly old CLI's update output; a rollback seen from the desktop app.
