# Grill — Single-binary daemon and install over SSH (desktop milestone 6)

> Status: grilled (readout confirmed by the owner on 2026-11-24)
> Started: 2026-11-24   Last updated: 2026-11-24   Rounds: 4
> Engineer: avatsaev   Agent: Claude (omp)

## Raw idea

Milestone 6 of the desktop roadmap: "single-binary daemon + install over SSH". From the exploration
record (`swe/architecture/single-binary-daemon.md`, 2026-11-22), the owner wants three things, all
about distribution:

1. Run a local daemon from the desktop app without a separately installed `pi-studio` CLI.
2. Install a daemon on a remote host from the app, over a direct or SSH connection.
3. Update a daemon easily.

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Exploration record | `swe/architecture/single-binary-daemon.md` | A one-day spike (2026-11-22): `bun build --compile` of the daemon ran on Linux x64 only (boot, terminals, transfers, a real agent turn, relay). Cross-compiled targets were built and never run. The CLI was not bundled. Nothing of it is in the repository |
| Owner's earlier decisions | same, § Owner's decisions | No Rust rewrite. The app downloads the daemon binary on first use (the installer does not carry it) and carries a pinned list: daemon version, URL and checksum per target |
| Baseline extensions | `packages/server/src/extensions/curated-packs.ts` | The always-selected `core` pack installs `npm:@99percentpeople/pi-background-tasks`. The record says this package fails to load under Bun (`Cannot find package 'node-pty'`) and Pi then exits, so no agent starts. With auto-sync on (the default) a binary daemon would install it at boot |
| Terminal backend | `packages/server/src/terminal/pty-backend.ts` | The only importer of `node-pty`, behind the `PtyBackend` interface. `node-pty` does not work under Bun; `Bun.spawn({terminal})` does, and since Bun 1.3.14 also on Windows (ConPTY) |
| Spawn sites | `packages/server/src/agent/providers/pi/rpc-transport.ts`, `extensions/sync-executor.ts`, `resources/resource-service.ts`, `update/helper.ts`; `packages/cli/src/daemon-control.ts`, `pi-commands.ts`, `relay-control.ts` | All run `process.execPath <script>`; in a compiled binary `process.execPath` is the binary itself. The CLI also finds the server, relay and web-client through `import.meta.resolve` |
| `createRequire` | `packages/server/src/version.ts`, `terminal/screen-buffer.ts`; `packages/cli/src/program.ts`, `update-control.ts`; `packages/relay/src/relay-main.ts` | Not followed by Bun's bundler |
| Daemon self-update | `packages/server/src/update/` (`install-kind.ts`, `update-service.ts`, `helper.ts`, `npm.ts`), `swe/features/self-update.md` | Install kinds are `npm-global`, `docker`, `source`, `unknown`; only `npm-global` on a non-Windows host updates itself. The spec says the binary "joins in milestone 6" with a `binary` kind. The helper (wait for the old daemon, start the new one, three health polls, roll back) exists for npm |
| Desktop: local daemon | `desktop/crates/shell/src/cli_find.rs`, `supervisor.rs`, `desktop/crates/engine/src/local.rs` | The app looks for an installed `pi-studio` in `PATH` and in the Node version managers' folders (or the `cliPath` setting) and runs `pi-studio --json daemon start\|stop\|restart`. No CLI found means the local entry cannot start |
| Desktop: Windows | `desktop/docs/platform-checks.md` row R7 | The local daemon is not offered on Windows today ("not supported") |
| Desktop: SSH host | `desktop/crates/shell/src/remote_supervisor.rs`, `desktop/crates/ssh/src/session/channels.rs` | The app runs `pi-studio --version`, `… daemon start` and `… update` on the host through `run(command, limit)`. A host without the CLI shows "not installed … it needs Node.js … `npm install -g`". The SSH crate can run a command and open a TCP channel; it has no file upload (no SFTP, no stdin stream) |
| Releases | `.github/workflows/release.yml` (one job, Linux runner), `scripts/publish.sh`, `docker/daemon.Dockerfile` (`node:22`) | npm, Docker and the Dokploy deploy run on every push to `main`. No binary is built anywhere. Bun is not installed on the development machine |
| Desktop app update | `swe/features/desktop-self-update.md`, `.github/workflows/desktop-release.yml` | The app updates itself from `desktop-updates/latest.json`; a daemon GitHub Release must not become the repository's "latest" release |
| Minimum daemon | `desktop/apps/pistudiodesktop` (`minDaemonVersion`, 0.0.127 today) | The app already refuses or offers to update a daemon older than its minimum |

## Problem & outcome
- **Who:** the two users of the desktop app (macOS, Windows, Linux), and anyone who wants a daemon on
  a host without installing Node.
- **Today:** a local daemon needs Node 22.20 and `npm install -g @av-pi-studio/cli` before the app can
  start it; an SSH host needs the same, typed by hand on the host.
- **Done means:** a machine with nothing installed gets a working daemon that can be updated, on this
  machine and on an SSH host, from the app alone (D1).
- **Measured by:** the acceptance criteria below, seen live on Linux in containers with nothing
  installed; on macOS only that the released binary starts on a macOS runner (D16).

## Goals
- The binary is built and published with each release (D1 a).
- The app downloads it and runs the local daemon with no Node and no CLI installed (D1 b).
- The app installs it on an SSH host (D1 c).
- A binary daemon updates itself as the npm one does (D1 d).

## Non-goals
- Replacing the npm packages or the Docker image: both stay published as they are (D4).
- The app using an installed npm CLI for its local daemon (D4).
- `pi-background-tasks` on a binary daemon, unless the one-task attempt makes it load (D2).
- Windows: no Windows binary, no local daemon on Windows, no Windows SSH host (D3).

## Happy path
**Local daemon, a machine with nothing installed (macOS or Linux)**
1. The user installs the app and opens it. The local entry is the current one and auto-start is on.
2. The app has no daemon binary: it downloads the pinned version for this system, checks it against
   the checksum it carries, and unpacks it under `~/.pi-studio/bin/` (D5, D9). The Daemons screen
   shows the progress.
3. The app starts the daemon from that binary (`pi-studio --json daemon start`) and connects. The
   workbench opens; no Node, npm or CLI was installed.

**SSH host without a daemon**
1. The user adds an SSH entry. The row says the daemon is not installed and offers Install (D10).
2. On the click the app reads the host's system and CPU, takes the matching pinned file (downloads it
   to this machine if it is not there yet, checks it), sends it over the SSH connection (D6), unpacks
   it under the host's `~/.pi-studio/bin/` and starts the daemon. The row shows the progress.
3. The app connects through the SSH connection as it does today.

**Later versions**
1. A binary daemon checks for a newer release itself and every client shows the "Daemon X" pill; the
   user installs from the dialog; the daemon restarts on the new binary and rolls back if it does not
   answer (D7).
2. A stopped daemon, or one older than the app needs, gets Update on the Daemons screen: the app
   installs its pinned version (D7).

**The command-line tool**
1. Settings offers "Install the command-line tool": the app links the binary into a folder on the
   user's `PATH`, so `pi-studio …` works in a terminal (D11).

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | What ships in this milestone | All four parts, built in this order: (a) the binary built and published with each release, (b) the app downloads it and runs the local daemon with no Node or CLI, (c) the app installs it on an SSH host, (d) a binary daemon updates itself | The milestone is done when a machine with nothing installed gets a working, updatable daemon, locally and over SSH | 1 |
| D2 | scope | `pi-background-tasks` (baseline extension) does not load under the binary and stops every agent | A binary daemon does not install it and tells Pi not to load it if it is already installed. One task first tries to make it load; if that works nothing is lost. The npm daemon keeps it | The binary must run agents by default; stalling on code the project does not own was rejected | 1 |
| D3 | scope | Windows | Out, with no task for it: no Windows binary, no local daemon on Windows, no Windows SSH host. The Windows user keeps connecting to daemons on other machines and can install one on a Linux or macOS host over SSH | oh-my-pi's Windows support is its own agent's tools in Rust and cannot be reused; Pi and Bun cover those parts already, but the daemon itself has never run on Windows and the port cannot be sized without running it. The owner chose not to spend a task on finding out | 1 |
| D4 | scope | The npm install once the binary exists | npm and Docker stay published as they are. The desktop app uses only its own binary for the local daemon and for SSH installs; its search for an installed CLI is removed. A Node daemon is run by hand and added as a direct entry | One path in the app, one version it controls | 1 |
| D5 | happy path | Which daemon version the app installs | The version pinned in the app build: version, address and checksum per system (confirms the decision of 2026-11-22). The app verifies the file against the checksum it carries | The app's own signed update is the only thing trusted. The first daemon may be a few releases old; its own update then offers the newest (D7) | 2 |
| D6 | happy path | How the file reaches an SSH host | The app sends it over the SSH connection, with progress. The SSH part of the app gains file sending | Works on hosts with no internet access or no `curl`, and the host gets exactly the file the app verified | 2 |
| D7 | happy path | Who moves a binary daemon to a newer version | The daemon itself: it checks GitHub as the npm daemon checks npm, shows the same pill, installs, restarts and rolls back. The app steps in only for a stopped daemon or one older than it needs, and then installs its pinned version | One update path for local, SSH, direct and relay daemons; one place that offers an update | 2 |
| D8 | happy path | An npm daemon already on the machine | The binary takes over: same folder (`~/.pi-studio`) and port, so agents, history and settings carry over. A running npm daemon is used as it is; the next Start, Restart or Update from the app uses the binary | Nothing of the user's is lost or duplicated | 2 |
| D9 | happy path | When the first download happens | By itself, the first time the local daemon has to start (the first launch, since auto-start is on), with progress on the Daemons screen. No download for a user of remote daemons only | No extra step before anything works | 2 |
| D10 | happy path | An SSH host without a daemon | The row shows an Install button instead of the npm instructions; nothing is installed without that click | Software does not land on a server unconfirmed | 2 |
| D11 | happy path | `pi-studio` in the user's terminal | Settings offers "Install the command-line tool", which links the binary into a folder on the user's `PATH` (details: P5) | The owner chose convenience over the recommended "do not touch `PATH`" | 2 |
| D12 | data | Which systems get a binary | Four: macOS Apple Silicon, macOS Intel, Linux x64, Linux ARM64 (glibc). Alpine (musl) is not built | Covers the users' machines and ordinary servers; each target adds a build and a smoke test to every release | 3 |
| D13 | security | What the daemon trusts when it updates itself | GitHub over HTTPS plus a checksum from the same release; no signature | The same level of trust the npm daemon gives npm. A signed list needs a key in every npm release; rejected for now | 3 |
| D14 | failure | After a rollback | A version that was rolled back is not offered again; the next newer release is. "Check now" still lets the user try it. Applies to npm and binary daemons (closes the open item of milestone 5b) | The pill would otherwise return after every check | 3 |
| D15 | edge | SSH hosts that already have an npm daemon | A running one keeps being used as it is. Once it is stopped or too old the row offers Install, and from then on the host runs the binary. The host's npm CLI stays installed and unused by the app | One way of running a host daemon in the app; one extra click per host, once | 4 |
| D16 | acceptance | What counts as proof | Linux live in containers with nothing installed (first launch, a real agent turn with Pi, SSH install with upload, self-update and rollback). On macOS only that the binary starts | The owner chose this over the recommended macOS runner checks of the app's local daemon: faster, and the macOS local daemon ships less tested | 4 |

Decisions taken by the agent (low impact; shown to the owner in the round named, no objection):

| # | Theme | Decision | Round |
|---|-------|----------|-------|
| P1 | release | Every push to `main` that publishes npm also builds the four binaries and puts them in a GitHub Release named after the version, never marked "latest". A binary that fails its smoke test is not published and does not block npm or Docker | 3 |
| P2 | release | Each desktop build pins the newest published daemon version at build time (written into the runner's copy, like the app's version). `minDaemonVersion` stays a manual number | 3 |
| P3 | data | Layout `~/.pi-studio/bin/versions/<version>/` with a link to the current one. The current and the previous version are kept; older ones are removed after a successful start | 3 |
| P4 | scope | The one file does everything the npm CLI does, including `pi-studio ui` and the relay commands | 3 |
| P5 | happy path | The command-line tool of D11 is a link in `~/.local/bin`. If that folder is not on `PATH`, or another `pi-studio` comes first, Settings says so; the app never edits shell files | 3 |
| P6 | edge | An SSH host the app cannot serve (Windows, Alpine, an unknown CPU) shows "this system is not supported" and offers nothing | 3 |
| P7 | scope | No "remove the daemon" action, locally or on a host | 3 |
| P8 | integration | The binary daemon shares the user's Pi folder and must not rewrite the user's Pi settings to do its job (see Open questions) | 3 |
| P9 | failure | A failed download, a file that does not match its checksum, or an archive with a path outside its folder: nothing is run, the file is deleted, the row offers Retry; remote entries keep working | 4 |
| P10 | failure | No resume: a partial download or send is removed and the next attempt starts over. A version already present is used. A missing folder or broken link means "not installed". An install unpacks into a temporary folder and renames it into place | 4 |
| P11 | state | The app never downgrades a daemon that is newer than its pin | 4 |
| P12 | failure | A host where the file cannot be written or run shows the host's own error and Retry; nothing half-installed stays | 4 |
| P13 | release | A release where one of the four binaries fails its smoke test publishes none of them | 4 |
| P14 | release | A desktop build fails if the daemon it would pin is older than `minDaemonVersion` | 4 |
| P15 | ops | The daemon's update check reads one fixed file, never GitHub's rate-limited API; its traces go where the npm update's go | 4 |
| P16 | failure | An extension that cannot load in the binary: the agent's error names it, nothing is disabled automatically, and the answer is the npm daemon on a host with Node | 4 |

## Data & state
- **Release assets** (new, per version): one archive per target (D12), a checksum list, and a list
  the daemon's own update reads (version, address and checksum per target; D13). Owner: `release.yml`.
- **The app's pin** (new, inside the app build): daemon version, address and checksum per target (D5,
  P2). Never stored in the user's settings.
- **`~/.pi-studio/bin/`** (new, on every machine and host with a binary daemon): `versions/<version>/`
  and the link to the current one (P3). Written by the app at install, by the daemon's update
  afterwards. Everything else under `~/.pi-studio` is unchanged and shared with an earlier npm
  daemon (D8).
- **Install kind** `binary` (new value of the daemon's `installKind`), reported in the update status.
- **Rolled-back version** (new, per daemon): the version not to offer again (D14); where it is stored
  is for the spec.
- **`~/.local/bin/pi-studio`** (new, optional): the link of D11/P5.
- **Removed:** the app's `cliPath` setting and its search for an installed CLI (D4). No migration:
  an unknown key in the settings file is ignored.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `.github/workflows/release.yml`, `scripts/publish.sh` | Build, smoke-test and upload the binaries per release (P1) | writes | The job has only a Linux runner today; a macOS binary must be started on a macOS runner |
| `.github/workflows/desktop-release.yml` | Resolves the pin at build time (P2) | reads | A desktop build with no published binary yet must fail clearly |
| `packages/server/src/update/` | `binary` install kind, check and install from GitHub, the helper switches the link and rolls back (D7, D13, D14) | changes | The npm path stays; two install paths share the helper |
| `packages/server/src/terminal/pty-backend.ts` | A second backend for Bun; `node-pty` not loaded in the binary | changes | Both backends must pass the same terminal tests |
| Spawn sites and `createRequire` calls (see Codebase context) | Call the binary's own sub-commands; static imports | changes | Nine spawn sites; only the agent path was exercised in the spike |
| `packages/server/src/extensions/curated-packs.ts`, sync | A binary daemon leaves out `pi-background-tasks` (D2) | changes | Depends on the open question about the shared Pi folder |
| `packages/cli` | Bundled into the binary; `pi-studio update` on a binary runs the binary's update (P4) | changes | The CLI finds the server, relay and web UI by module path today |
| `desktop/crates/shell` (`cli_find.rs`, `supervisor.rs`, `remote_supervisor.rs`), `engine`, `model` | Download, verify, unpack and run the binary; the CLI search and `CliMissing`/`cliPath` go away (D4, D9); Install on an SSH row (D10) | changes | The local and remote state machines change shape |
| `desktop/crates/ssh` | File sending over the connection (D6) | adds | New capability; needs the test server to accept it |
| Workbench daemon update pill and dialog | Unchanged; shows the `binary` kind | reads | |
| Docker image | Unchanged (Node) | none | |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | The download fails or there is no internet at the first start | The local row says the daemon could not be downloaded and offers Retry; remote entries keep working | P9 |
| inputs | The downloaded file does not match the pinned checksum | The file is deleted and never run; the row says so and offers Retry | P9 |
| inputs | The archive holds a path outside its folder | The install is refused | P9 |
| identity & access | An SSH host where the file cannot be written or run (no `tar`, a home folder that forbids running programs, no space) | The row shows the host's own error and Retry; nothing half-installed stays | P12 |
| identity & access | An SSH host the app cannot serve (Windows, Alpine, an unknown CPU) | "This system is not supported", nothing offered | P6 |
| state | A daemon newer than the app's pin (it updated itself) | The app never downgrades it | P11 |
| state | An npm daemon is running on this machine | Used as it is; the next Start, Restart or Update from the app uses the binary | D8 |
| state | An SSH host with an npm daemon | A running one is used as it is; once stopped or too old the row offers Install, and from then on the host runs the binary. The host's npm CLI is left installed and unused by the app | D15 |
| state | The pinned version is already on the machine or host | It is used; nothing is downloaded or sent again | P10 |
| state | The folder of the current version is gone or the link is broken | Treated as not installed | P10 |
| state | Two installs to the same host at once | Each unpacks into its own temporary folder and renames it into place; the second finds the version present | P10 |
| timing | The app closes, or the SSH connection drops, during a download or a send | The partial file is removed and the next attempt starts over; no resume | P10 |
| timing | The daemon's update does not answer after the restart | The helper switches back to the previous version (as for npm) and that version is not offered again | D7, D14 |
| scale | n/a — one user, one daemon per machine or host; the only volume is the file itself (about 54 MB down, about 119 MB unpacked per version, two versions kept) | | P3 |
| dependencies | GitHub cannot be reached at an update check | The check error shows as it does for npm; the check never uses GitHub's rate-limited API, it reads one fixed file | P15 |
| dependencies | One of the four binaries fails its smoke test in a release | None of the four is published for that version; daemons and the app keep the previous one; npm and Docker still publish | P13 |
| dependencies | The daemon version a desktop build would pin is older than `minDaemonVersion` | The desktop build fails | P14 |
| dependencies | An extension cannot load in the binary | The agent's error names the extension; nothing is disabled automatically; the answer is the npm daemon on a host with Node. `pi-background-tasks` is the known case and is left out (D2) | P16 |
| data lifecycle | Agents, history, settings and logins of an earlier npm daemon | Carried over unchanged: same `~/.pi-studio` and the same Pi folder | D8, P8 |
| data lifecycle | Old versions on disk | The current and the previous are kept; older ones are removed after a successful start | P3 |
| data lifecycle | The app's `cliPath` setting | Ignored; the key is no longer known | D4 |
| observability & ops | Where an install or update leaves a trace | The app's log for the app's installs; `logs/update-restart.log` on the daemon's machine for its own updates, as for npm | P15 |
| observability & ops | Feature flag | n/a — none; the first app build with the binary uses it | |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | The archive is about 54 MB; a send over SSH shows progress and has no total time limit, only a stall limit (the value is for the spec). The binary build must not delay the npm publish of the same release (a later job) |
| Security & authorization | The app runs only a file that matches the checksum in the app build (D5). The daemon's own update trusts GitHub over HTTPS plus the release's checksum (D13). No secret is involved in a download; a send over SSH uses the existing connection. An archive may not write outside its folder (P9). The binaries are not signed with an OS identity (milestone 8) |
| Privacy | A download tells GitHub the machine's address, as an npm install tells npm. Nothing else leaves the machine |
| Backward compatibility | None kept (owner's rule): the app's CLI search and `cliPath` are removed (D4). Existing npm daemons keep working and are taken over by the binary on the next start (D8, D15) |
| Rollout / feature flag | No flag. Each release publishes binaries (P1); each desktop build pins the newest (P2) |
| Observability | See the two observability rows above (P15) |
| Rollback | The daemon's own update: the helper switches the link back (P3, D7). The app's install: the previous version stays on disk until the new one has started. A bad binary release: the next release replaces it; a daemon that rolled back skips it (D14) |

## Deferred
- Windows in every form (D3).
- Alpine and other musl systems (D12).
- A signed list of release files for the daemon's own update (D13).
- Removing a daemon from the app (P7).

## Open questions — TODO(verify)
- [ ] macOS: a binary the app downloaded is never run in this milestone on a real Mac, and the owner chose "the binary starts" on a macOS runner as the only macOS proof (D16). The app's own download sets no quarantine mark, so Gatekeeper is not expected to check the file; an Apple Silicon binary needs at least an ad-hoc signature. If the cross-built binary does not start on the runner, build or sign it on a macOS runner. — owner: agent, in the release task
- [ ] The server test suite was never run under Bun; `skills` CLI operations, extension auto-sync at boot and a complete OAuth login were not exercised in the binary. — owner: agent
- [ ] The binary daemon must not rewrite the user's Pi settings (P8). A way was shown on Node on 2026-11-24: replacing `SettingsManager.prototype.getNpmCommand` in the process makes Pi's `DefaultPackageManager` use the given command and treat it as `bun`, with nothing written to the Pi folder; Pi's entry for the binary (`dist/bun/cli.js`) loads the same module the SDK exports. Not shown in the compiled binary, and not shown for hiding one installed extension (D2). The milestone's first task proves both in the binary; if either fails, return to the owner before anything else is built. — owner: agent
- [ ] What Pi does in the binary when some other extension fails to load: does it exit, and does its error name the extension (P16)? — owner: agent

## Acceptance criteria (draft)
Proof is on Linux, live, in containers with nothing installed; on macOS the only proof is that the
released binary starts on a macOS runner (D16).

- [ ] Given a release, when its workflow ends, then a GitHub Release named after the version holds four archives, a checksum list and the daemon's update list, it is not marked "latest", and each binary was started once on its own system.
- [ ] Given one binary that fails its smoke test, when the release runs, then no binary is published for that version and npm and Docker are published.
- [ ] Given a Linux machine with no Node, npm or `pi-studio`, when the app is opened for the first time, then it downloads the pinned daemon, the Daemons screen shows the progress, the daemon starts and the workbench connects.
- [ ] Given that daemon, when a real agent turn with Pi runs a shell command and uses the todo tool, then it completes; a terminal opens; a file goes up and down intact.
- [ ] Given a binary daemon, when Pi installs an extension, then it installs with no npm on the machine and the user's Pi `settings.json` is unchanged.
- [ ] Given a binary daemon, when the baseline extensions are synced, then `pi-background-tasks` is not installed, and an agent starts when it was already installed.
- [ ] Given no internet, or a file that does not match its checksum, when the app needs the daemon, then nothing is run and the row offers Retry.
- [ ] Given an npm daemon with agents and history, when the app next starts the local daemon, then the binary runs on the same folder and port and the agents and history are there.
- [ ] Given an SSH host with nothing installed, when the user clicks Install, then the app sends the file over the connection with progress, the daemon starts and the app connects; an unsupported system offers no Install.
- [ ] Given an SSH host with a running npm daemon, then it is used as it is; once stopped, the row offers Install.
- [ ] Given a binary daemon and a newer release, when the user installs from the pill's dialog, then the daemon restarts on the new version; given a new version that does not answer, then the previous one runs again and the failed one is not offered at the next check (for npm daemons too).
- [ ] Given a daemon newer than the app's pin, when the app starts it, then it is not replaced.
- [ ] Given "Install the command-line tool" in Settings, then `pi-studio --version` answers in a new terminal, or Settings says why it will not.
- [ ] The app no longer looks for an installed CLI and has no `cliPath` setting.

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 0 | recon | Read the exploration record, the daemon's spawn and update code, the desktop app's daemon supervision and SSH crate, and the release workflows. Found: a baseline extension that stops every agent under the binary; the SSH crate cannot upload a file; Bun's terminal now exists on Windows |
| 1 | problem, scope | D1, D2, D4 decided. D3 (Windows) open: the owner asked about reusing oh-my-pi's Windows support. Read on 2026-11-24: oh-my-pi runs on Windows because its own agent carries a bash engine, the command-line tools and a PTY in Rust (`omp-shell`, `omp-builtins`, `omp-natives`); that replaces the agent's tools and is not a library for Pi. Pi 1.4.0 runs on native Windows by itself with Git Bash (`docs/windows.md`). Reusable from oh-my-pi: the recipe (Bun-compiled Windows x64 and arm64 binaries, each started by a smoke test on a Windows runner). The Pi Studio daemon has never run on Windows: one `win32` check in `packages/server/src`, `/bin/sh` defaults in three places, POSIX signals in 12 files |
| 1b | scope | D3 decided: Windows is out, with no task |
| 2 | happy path | D5–D11: pinned version, upload over SSH, the daemon updates itself, the binary takes over an npm daemon's folder and port, automatic first download, Install button on an SSH host, Settings offers the command-line tool (the owner chose this over the recommendation). The first pass of this round was submitted with the defaults by mistake and asked again in full |
| 3 | data, integration | D12–D14: four targets, HTTPS plus checksum for the daemon's own update, a rolled-back version is skipped. P1–P8 shown and not objected to |
| 4 | edge cases, constraints, acceptance | D15: an SSH host's npm daemon is used while it runs, then the binary after one Install click. D16: proof is Linux live; on macOS only "the binary starts" (the owner chose less than the recommended runner checks). P9–P16 shown, no objection. The shared-Pi-folder question became non-blocking: a way was shown on Node |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/single-binary-daemon.md` (new: the binary, its release, the app's local daemon, the command-line tool) | Goals, Non-goals, Happy path (local, command-line tool), D1–D5, D8, D9, D11, D12, D16, P1–P5, P8–P11, P13, P14, P16, Edge cases, Acceptance criteria |
| `swe/features/desktop-ssh-daemon-install.md` (new: Install on an SSH host, sending a file over SSH) | Happy path (SSH host), D6, D10, D15, P6, P12, the SSH rows of Edge cases and Integration points |
| `swe/features/self-update.md` (changed: the `binary` install kind, the skipped version) | D7, D13, D14, P3, P15, the update rows of Edge cases |
| `swe/architecture/single-binary-daemon.md` (changed: from exploration record to the design as decided) | Codebase context, Data & state, Integration points, Non-functional constraints, Open questions |
