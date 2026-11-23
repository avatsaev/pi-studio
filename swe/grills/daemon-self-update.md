# Grill — Daemon self-update (roadmap 5b)

> Status: grilling
> Started: 2026-11-23   Last updated: 2026-11-23   Rounds: 3 (themes 4–8 as agent proposals)
> Engineer: avatsaev (owner)   Agent: Claude

## Raw idea

"5b daemon self-update (npm first)": after the desktop app updates itself (milestone 5), the daemon
updates itself too, starting with daemons installed through npm. Refresh `swe/features/self-update.md`
(written 2026-08-26, never built) against today's code.

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Version | `packages/server/src/version.ts` | `SERVER_VERSION` is real on every handshake path (old defect D1 fixed); `PACKAGE_NAME` lives only in `packages/cli/src/update-control.ts` |
| Shutdown | `packages/server/src/daemon/bootstrap.ts:922-932` | `close()` never closes agent sessions: `pi --mode rpc` children can outlive a restart (old D2, still open) |
| PID lock | `bootstrap.ts:214-221`, `cli/src/daemon-control.ts:34-45` | `pi-studio.pid` written, never removed; only the CLI reads it (old D3, still open) |
| Health | `packages/server/src/http/http-server.ts:62-68` | `/api/health` = `{"status":"ok"}`, no version; unauthenticated; Docker HEALTHCHECK uses it |
| Listen | `daemon/main.ts:4`, `config/daemon-config.ts:88` | `PI_STUDIO_LISTEN` → `config.daemon.listen` → `127.0.0.1:6767` (old spec's "env only, 0.0.0.0" is gone) |
| Update engine | `packages/cli/src/update-control.ts`, `update-commands.ts` | `npm view` (15 s, errors → null), `npm i -g` (120 s, ENOTEMPTY retry ×3), numeric `compareVersions`; `pi-studio update` installs + `pi update --extensions`, never restarts the daemon |
| CLI restart | `cli/src/daemon-commands.ts:203-208` | stop (SIGTERM, no wait) then start-if-health-fails: a race; no wait-for-exit primitive exists |
| Detached spawn | `cli/src/daemon-control.ts` `subprocessStarter` | `node --input-type=module -e` with an absolute `import.meta.resolve` URL |
| Docker | `docker/daemon.Dockerfile` | repo-checkout build, no `@av-pi-studio/cli` inside, `PI_STUDIO_LISTEN=0.0.0.0:6767` |
| Install kind | — | no concept in code; `single-binary-daemon.md` proposes a `binary` kind (milestone 6) |
| Observability | `packages/server/src/observability/daemon-status-*.ts`, protocol `messages.ts:1331-1440` | `daemon_status` gives `version`, `pid`, `startedAt`, agents by status, clients; no workbench consumer |
| Timers | `daemon-status-service.ts:191` | one unref'd 5 s interval exists (only while subscribed) |
| Workbench | `features/settings/settings-categories.ts`, `features/connection/ConnectionBar.tsx` | gear always visible; categories providers/skills/viewers; the app-update pill sits at the far right (desktop only) |
| Outdated notice | `workbench/.../use-outdated-daemon-notice.ts`, `outdated-daemon.ts` | toast "npm i -g @av-pi-studio/cli, then restart the daemon" when the host's `minDaemonVersion` is above `serverInfo.version` (desktop only) |
| Desktop local | `desktop/crates/shell/src/supervisor.rs`, `cli_answers.rs`, `engine/src/local.rs` | runs the installed CLI: `--version`, `--json daemon status|start|restart|stop`; `CliOutdated` below 0.0.127 offers the npm command only |
| Desktop SSH | `desktop/crates/shell/src/remote_supervisor.rs` | `pi-studio --version` + `daemon start` over SSH; no stop, restart or update |
| Releases | `.github/workflows/release.yml`, `scripts/publish.sh` | every non-desktop merge to `main` publishes all eight packages at `0.0.N+1`: a new daemon version per merge |
| Compatibility | owner, 2026-11-22 | no backward compatibility kept; a daemon from before this feature never updates itself in the UI |

## Problem & outcome
- **Who:** anyone driving a daemon from a client: the browser, the desktop app (local, direct, relay, SSH entries).
- **Today:** a user runs `npm i -g @av-pi-studio/cli` and `pi-studio daemon restart` in a terminal, or `pi-studio update` and then a restart; remote (relay, SSH) daemons need a shell on the host.
- **Done means:** a client shows that a newer daemon exists; one confirmed click installs it, restarts the daemon, and the client reconnects to the new version by itself.
- **Measured by:** the reconnected client reports the new version, with no terminal used and no orphaned process left.

## Goals
- Any connected client can update its daemon to the newest npm version in one confirmed action, and every client sees the result (D1).
- The daemon checks npm itself at start and every 6 hours and tells every client (D3).
- The restart is clean: no orphaned agent processes, no stale PID file (D5).

## Non-goals
- Docker, repo checkouts and the single binary updating themselves (D2; instructions only).
- Updating the desktop app (milestone 5) or the web client hosted elsewhere.
- Choosing a version, downgrading, release channels.

## Happy path
1. The daemon starts, checks npm, and finds a newer version. Every connected client shows the pill "Daemon 0.0.130".
2. The user clicks it: a dialog shows the current and new versions and "2 agents running, 3 terminals open will stop".
3. "Update and restart": the dialog shows Installing, Updating extensions, Restarting; other clients show "Daemon updating".
4. The daemon stops its agents and terminals, hands over to the helper and exits; clients show their usual reconnecting state.
5. The new daemon answers on the same address; clients reconnect; the dialog shows "Updated to 0.0.130" (with Reload in a browser whose files are older).

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | problem | Who starts a daemon update? | The daemon updates itself when any connected client asks (browser, desktop, relay, SSH): one mechanism everywhere | Remote daemons have no shell for the user; the desktop needs no CLI path of its own | 1 |
| D2 | scope | Which installs self-update? | Global npm installs only; Docker and a repo checkout show the command to run; the single binary is milestone 6 | Docker would need the Docker socket in the container | 1 |
| D3 | scope | When is the offer shown? | Whenever npm has a newer version (checked at daemon start and every 6 h), as a quiet pill like the app's | A new version per merge: quiet, not nagging | 1 |
| D4 | happy path | Restart interrupts agents and terminals | Ask first with the counts of running agents and open terminals; agents resume their sessions after the restart | The user decides with the cost in view | 1 |
| D5 | scope | The two shutdown bugs (orphaned `pi` children, PID file never removed) | Fixed in this milestone | A self-restart would make both routine | 1 |
| D6 | happy path | Where the offer shows | A second pill of the same style beside the app's, labelled for the daemon ("Daemon 0.0.130"); a click opens the confirmation | Same language as the app's update; visible in the browser too | 2 |
| D7 | happy path | What the click opens | A small dialog: versions, counts, "Update and restart" / Cancel, then progress in the same dialog; also reachable from a new Settings category "Daemon" | One step from the pill; Settings holds the status and manual check | 2 |
| D8 | happy path | Pi extensions | `pi update --extensions` runs after the install and before the restart; its failure does not stop the update | Same as the CLI's update; the next start syncs again | 2 |
| D9 | integration | Desktop, outdated or stopped local/SSH daemon | The app offers "Update": it runs `pi-studio update` on the host (locally or over SSH), then starts the daemon. Refines D1: the daemon's own update serves a running, new-enough daemon; the CLI path serves one that is stopped or predates the feature | A daemon below the app's minimum cannot be asked to update itself | 2 |
| D10 | happy path | Web client older than the daemon after the restart | No forced reload: a "Reload" button in the result and a small note when versions differ; the desktop app needs nothing | A forced reload loses composer text and open dialogs | 2 |
| D11 | failure | The install fails | The daemon keeps running the old version, no restart; the dialog shows the reason and the command to run by hand; no `sudo` | A restart would add an outage to a failure | 3 |
| D12 | failure | The new daemon does not come up | Three tries, then the helper reinstalls the previous version and starts it; clients see "update failed, back on X" | A remote daemon must not stay down | 3 |
| D13 | security | Who may update | Any connected client, direct or relay | It can already run commands through agents | 3 |
| D14 | happy path | A second client during an update | Sees the same progress and a restart notice, reconnects by itself; a second click is refused | One story for everyone | 3 |
| D15 | integration | The CLI's restart race | Fixed here: stop waits for the exit; `pi-studio update` restarts a running daemon | D9 relies on it | 3 |
| D16 | ops | Turning the automatic check off | `daemon.update.autoCheck` / `PI_STUDIO_UPDATE_AUTOCHECK`, a switch in Settings → Daemon; the manual check still works | | 3 |

## Agent proposals (rounds 4–8 merged; stand unless the owner objects at the readout)
| # | Theme | Proposal | Why |
|---|-------|----------|-----|
| P1 | wire | One family `daemon_update_*` with real schemas: `daemon_update_status_request` (answers the state), `daemon_update_check_request` (asks npm now), `daemon_update_apply_request` (starts; answers at once), and one broadcast `daemon_update_status` to every session on each change and after `server_info`. Feature flag `daemonUpdate` | One state object carries the offer and the progress; no second push |
| P2 | data | State: `idle`, `checking`, `available {version}`, `installing`, `updating_extensions`, `restarting`, `failed {code, message}`, `cannot_update {reason, version, command}`; plus `currentVersion`, `installKind`, `checkedAt`, `autoCheck`, and `lastResult` (the previous update's outcome, see P8) | Mirrors the app's update states so the pill code is shared |
| P3 | data | Install kind detected once at start: `npm-global`, `docker`, `source`, `unknown`; `PI_STUDIO_INSTALL_KIND` wins and is set in `docker/daemon.Dockerfile`. Only `npm-global` can update (D2) | A container looks like a checkout on disk |
| P4 | data | Before offering, the daemon checks that `npm` is on its PATH and that the global npm folder is writable; otherwise `cannot_update` (`npm_missing`, `not_writable`) with the command to run by hand | D11's most common failure (a root-owned npm folder) is known before the click |
| P5 | integration | The check is `npm view @av-pi-studio/cli version` (15 s), at start and every 6 h; it honours the host's `.npmrc`. An automatic check that fails is silent; a manual one shows the reason | The existing, tested code; mirrors and proxies work |
| P6 | integration | The update engine moves from `packages/cli` to `packages/server/src/update/`; the CLI imports it | One implementation |
| P7 | integration | The helper is a detached, self-contained script (no import from the package), which waits for the old daemon to exit (30 s), starts the new one with the same environment and the effective listen address, and writes `$PI_STUDIO_HOME/logs/update-restart.log` | It must survive the package being replaced under it |
| P8 | failure | "Came up" = `/api/health` answers with the target version (health gains `version`). Three tries; then the helper reinstalls the previous version, starts it, and writes `$PI_STUDIO_HOME/update-result.json`; the started daemon reads it once and reports `lastResult` (updated, or failed and back on the old version) to clients (D12) | Clients learn the outcome after they reconnect |
| P9 | happy path | At the restart every agent session is closed (5 s each, then killed) and terminals are killed; agent records stay and resume on the next prompt | D5 |
| P10 | security | The package is fixed (`@av-pi-studio/cli`) and the version is the one npm reported, matching `x.y.z`; a client cannot name a package or a version. Trust is npm's own (registry, lock, `.npmrc`): no signature of ours | A client can already run commands through agents; the request adds no power |
| P11 | UI | Pill texts: "Daemon 0.0.130" (orange, opens the dialog), "Daemon updating" (grey, spinner), "Daemon update failed" (red), "Daemon 0.0.130 available" (grey, opens the dialog with the command) for `cannot_update`. Nothing for idle, checking, up to date | D6; same styles as the app's pill |
| P12 | desktop | D9: commands `daemon.local.update` and `daemon.remote.update` run `pi-studio update` on the host (5 min limit), read `pi-studio --version` again, then start the daemon. They do not depend on the outdated CLI's output format | The outdated CLI already has `update` |
| P13 | CLI | `pi-studio update` restarts a running daemon after the install (waits for the exit); `daemon stop` and `daemon restart` wait for the exit (10 s, then report failure) (D15) | Removes the race |
| P14 | limits | Install 120 s (three retries of npm's ENOTEMPTY case), extensions 180 s, old daemon exit 30 s, each start try 6 s | From the existing code |
| P15 | compatibility | A daemon from before this feature shows no offer; the desktop's Update (D9) covers local and SSH ones; others update by hand once | No compatibility kept |

## Data & state
- **Daemon memory:** the update state of P2; nothing persisted but the result file.
- **`$PI_STUDIO_HOME/update-result.json`:** written by the helper (`{from, to, outcome: "updated" | "rolled_back" | "failed", at, message?}`), read once at the next start, then removed.
- **`$PI_STUDIO_HOME/logs/update-restart.log`:** the helper's own log.
- **`config.json`:** `daemon.update.autoCheck` (default true); env `PI_STUDIO_UPDATE_AUTOCHECK` wins (D16).
- **`pi-studio.pid`:** removed on a clean shutdown (D5).
- **Wire:** P1; `/api/health` gains `version`.
- **Clients:** a store in the workbench fed by the broadcast; nothing stored in the browser.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/server/src/daemon/bootstrap.ts` `close()` | closes agent sessions, clears the check timer, removes the PID file | writes | every shutdown path changes, not only the update |
| `packages/server/src/http/http-server.ts` | `/api/health` adds `version` | emits | Docker HEALTHCHECK reads only the status |
| `packages/cli/src/update-control.ts`, `update-commands.ts`, `daemon-control.ts`, `daemon-commands.ts` | engine moves to the server; `update` restarts; stop and restart wait for the exit | consumes | third narrow CLI → server import |
| `packages/protocol` | `daemon_update_*` schemas, flag `daemonUpdate`, fixtures for the external client | emits | fixture procedure applies |
| `packages/client` | SDK methods and subscription | consumes | |
| `packages/workbench` connection bar, Settings | second pill, dialog, category "Daemon", version note | consumes | the app's pill code is reused |
| `desktop/crates/shell` `supervisor.rs`, `remote_supervisor.rs`, `engine` | `daemon.local.update`, `daemon.remote.update` | consumes | SSH command over the existing connection |
| `docker/daemon.Dockerfile` | `PI_STUDIO_INSTALL_KIND=docker` | writes | |
| Extensions sync (`extensions/sync-executor.ts`) | `pi update --extensions` through the same spawn seam | consumes | |
| Relay and SSH transports | the daemon reconnects to the relay with the same key; clients reconnect by themselves | — | pairing links survive |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | a client sends a version or package | ignored: the daemon uses its own checked version | P10 |
| inputs | npm answers something that is not `x.y.z`, or nothing | no offer; manual check shows the reason | P5 |
| identity & access | any authenticated client, direct or relay | may update | D13 |
| identity & access | not authenticated | refused like every RPC | — |
| state | already on the newest version | `idle`; apply refused | P2 |
| state | Docker, checkout, unknown, npm missing, folder not writable | `cannot_update` with the command; apply refused on the daemon | D2, P4 |
| state | a daemon without the feature | no pill; desktop Update for local and SSH | D9, P15 |
| timing | two clients click | the first wins; the second is refused; both see the same progress | D14 |
| timing | a client connects during the update | gets the current state after `server_info` | P1 |
| timing | the install fails | the daemon keeps running the old version; no restart; reason and command shown | D11 |
| timing | the extensions step fails | noted; the update continues | D8 |
| timing | the old daemon does not exit in 30 s | the helper goes on; a failed start counts as a try | P7 |
| timing | the new daemon does not come up in three tries | previous version reinstalled and started; clients see "failed, back on X" | D12, P8 |
| timing | the rollback also fails (no network) | the daemon stays down; the log says how to start it | P8 |
| timing | a newer version appears during an update | ignored until the next check | P5 |
| scale | n/a — one daemon, one update at a time | | |
| dependencies | npm registry down or slow | automatic check silent; manual check shows it; 15 s limit | P5 |
| dependencies | the web client is older than the daemon afterwards | a Reload button and a note | D10 |
| data lifecycle | agents running at the restart | sessions closed, records kept, resume on the next prompt | P9 |
| data lifecycle | `update-result.json` left from a crash | read once and removed at the next start | P8 |
| observability & ops | automatic check turned off | no check at start, no timer; manual check works | D16 |
| observability & ops | what is logged | each stage in the daemon's log; the helper's own log file | P7 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | One `npm view` at start and every 6 h; nothing else in the background |
| Security & authorization | Any authenticated client (D13); fixed package, daemon-chosen version (P10); no secret in the state or the logs |
| Privacy | Only npm's own request leaves the host |
| Backward compatibility | None kept (owner, 2026-11-22); P15 |
| Rollout / feature flag | Feature flag `daemonUpdate`; the setting `daemon.update.autoCheck` |
| Observability | Daemon log per stage; `update-restart.log`; `lastResult` to clients |
| Rollback | Automatic to the previous version when the new daemon does not start (D12) |

## Deferred
- Docker and the single binary updating themselves (milestone 6 for the binary).
- Choosing a version, downgrade by hand, channels.
- A "Restart daemon" button of its own.

## Open questions — TODO(verify)
- [ ] Does `pi --mode rpc` exit when the daemon dies? (decides whether orphans are live today) — owner: agent
- [ ] Is `npm` on the PATH of a daemon started by the desktop app or a GUI shell (macOS)? — owner: agent
- [ ] Windows: does `npm i -g` succeed while the daemon runs (a loaded `node-pty` file is locked)? If not, on Windows the helper installs after the daemon stops. Is a Windows daemon supported at all (`LocalState::Unsupported`)? — owner: agent
- [ ] Does reinstalling the previous version work with no network (npm's cache)? — owner: agent

## Acceptance criteria (draft)
- [ ] A global npm install reports `npm-global` and offers a newer version to every connected client without a reload; Docker and a checkout report `cannot_update` with the command.
- [ ] The pill opens the dialog; the counts include another client's terminal.
- [ ] Update: the new version is installed, extensions updated, the daemon restarts on the same address, every client (direct, relay, SSH) reconnects by itself and shows the new version.
- [ ] After the restart no `pi --mode rpc` process of the old daemon is left and the PID file names the new daemon.
- [ ] A failed install leaves the old daemon running, with the reason shown.
- [ ] A new version that does not start is rolled back; clients show "failed, back on X".
- [ ] A second click during an update is refused; a forged apply against Docker is refused.
- [ ] `PI_STUDIO_UPDATE_AUTOCHECK=false` stops the automatic check; the manual one works.
- [ ] `pi-studio daemon restart` always ends with a new process; `pi-studio update` restarts a running daemon.
- [ ] Desktop: an outdated or stopped local daemon, and an SSH one, is updated and started by "Update".

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem & scope (merged) | D1–D5: the daemon updates itself on any client's request; npm installs only; offer whenever npm is newer; confirm with counts; shutdown bugs fixed here |
| 2 | happy path | D6–D10: a second pill; a dialog (also a Settings category "Daemon"); extensions step kept; the desktop runs `pi-studio update` for an outdated or stopped local/SSH daemon; no forced reload |
| 3 | failures & safety | D11–D16: a failed install keeps the old daemon; a new daemon that does not start is rolled back; any client may update; shared progress; CLI restart race fixed; a setting for the automatic check |
| 4–8 | data, integration, edge cases, constraints, acceptance (merged) | Agent proposals P1–P15, presented at the readout |

## Handoff to scope
_(written at grilled)_
