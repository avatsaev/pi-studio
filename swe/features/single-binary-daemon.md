# Feature — Single-binary daemon

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Status: **specified 2026-11-24, not built.** Desktop roadmap milestone 6, from the grill
> [../grills/single-binary-daemon.md](../grills/single-binary-daemon.md) (D1–D16 owner, P1–P16 agent,
> readout confirmed by the owner on 2026-11-24). S1–S12 are proposed in this document. **Compatibility
> is not a concern** (owner, 2026-11-22): no fallback to an installed CLI, no migration of the app's
> settings.
> Dependencies: [../architecture/single-binary-daemon.md](../architecture/single-binary-daemon.md) (how
> the binary is built and what changes in the code), [desktop-ssh-daemon-install.md](desktop-ssh-daemon-install.md)
> (the same binary installed on an SSH host), [self-update.md](self-update.md) (the `binary` install kind),
> [desktop-daemon-registry.md](desktop-daemon-registry.md) (the local entry and its supervisor, changed
> here), [desktop-self-update.md](desktop-self-update.md) (the release workflow pattern reused),
> [preinstalled-extensions.md](preinstalled-extensions.md) (the baseline pack, changed here),
> [cli.md](cli.md) (the command surface the binary carries).
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

Today the desktop app can run a local daemon only when the user has installed Node 22.20 and
`npm install -g @av-pi-studio/cli`. This feature removes that step on macOS and Linux:

1. Every release publishes `pi-studio` as one executable per system: the CLI, the daemon, Pi and the
   `skills` CLI together, with no Node needed.
2. The desktop app downloads the version it was built with the first time it needs the local daemon,
   checks it, and runs the daemon from it. It no longer looks for an installed CLI.
3. The daemon from that binary keeps the same folder, port, agents, history and logins as an npm
   daemon had on the machine.
4. The daemon's Settings section offers to put `pi-studio` on the user's `PATH`.

Installing the same binary on an SSH host is [desktop-ssh-daemon-install.md](desktop-ssh-daemon-install.md).
How a binary daemon updates itself is [self-update.md](self-update.md).

## Ground truth (checked 2026-11-24)

- The spike of 2026-11-22 compiled the daemon with `bun build --compile` (Bun 1.4.5) and ran it on
  Linux x64 only (terminals, transfers, a real agent turn, the relay, `pi install` with no npm). The
  CLI was not bundled. Nothing of it is in the repository.
- Nine places start Pi or the `skills` CLI as `process.execPath <script>`; the CLI starts the daemon
  and the relay with `node --input-type=module -e` and an absolute module URL, and finds the web UI's
  files through `import.meta.resolve`. Five files use `createRequire`.
- `node-pty` is imported only by `packages/server/src/terminal/pty-backend.ts`, behind the
  `PtyBackend` interface. It does not work under Bun.
- The baseline pack (`curated-packs.ts`, `core`) installed `npm:@99percentpeople/pi-background-tasks`
  until 2026-11-24, which does not load under Bun; Pi then exits and no agent starts. The pack no
  longer carries it, but a user can still have it installed.
- Pi's package manager is the array `npmCommand` of Pi's `settings.json` (default `npm`). Pi accepts
  `bun`. Replacing `SettingsManager.prototype.getNpmCommand` inside a process makes Pi's
  `DefaultPackageManager` use the given command, with nothing written to the Pi folder (shown on Node,
  2026-11-24).
- The desktop app finds the CLI through `cli_find.rs` (the `cliPath` setting, `PATH` of the login
  shell, the Node version managers' folders) and runs `pi-studio --json daemon status|start|restart|stop`.
  `LocalState` has `cli_missing` and `cli_outdated`. On Windows the local entry is `unsupported`.
- The app's local settings (`autoStartLocalDaemon`, `checkForUpdates`, `cliPath`) are shown on the
  workbench's Daemons screen (`packages/workbench/src/features/daemons/`).
- `release.yml` is one Linux job: bump, npm publish, Docker publish, Dokploy deploy, and a commit
  `chore: release X [skip ci]`. There are no git tags for npm versions. Desktop releases are
  `desktop-v<version>`; the app reads `desktop-updates/latest.json`.
- `minDaemonVersion` is a constant in `desktop/crates/shell/src/daemons.rs` (0.0.127).

## Non-goals

- Windows in any form: no Windows binary, the local entry stays `unsupported` on Windows (D3).
- Alpine and other musl systems (D12).
- Replacing the npm packages or the Docker image; both stay published as they are (D4).
- The app running an installed npm CLI (D4).
- `pi-background-tasks` on a binary daemon, unless the first task makes it load (D2).
- A button that removes the daemon (P7). Resuming a broken download (P10).
- Signing the binary with an OS identity (milestone 8).

## Decisions

From the grill (summary; the brief has the rationale): D1 all four parts; D2 leave the extension out
on the binary; D3 no Windows; D4 the app uses only its binary; D5 the version is pinned in the app
build and checked against a checksum it carries; D8 the binary takes over an npm daemon's folder and
port; D9 the first download starts by itself; D11 the command-line tool is offered; D12 four systems;
D16 proof is Linux live, on macOS only that the binary starts. P1 binaries in every release, never
"latest"; P2 the pin moves by itself; P3 the version layout; P4 the binary does everything the CLI
does; P5 the link in `~/.local/bin`; P8 the user's Pi settings are never rewritten; P9–P14 failure
handling; P16 extensions that do not load.

### Proposed here

| # | Decision | Why |
|---|---|---|
| S1 | Each version's binaries are a GitHub Release tagged `daemon-v<version>`, never "latest", never a draft. One fixed release, `daemon-updates`, holds `latest.json`: the newest version whose four binaries all passed | The same pattern as `desktop-updates`: a fixed address to read, no API, no rate limit (P15) |
| S2 | Asset names `pi-studio-<version>-<target>.tar.gz`, targets `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`; plus `SHA256SUMS` and `latest.json` | Plain names a user can download by hand |
| S3 | Each binary is built and smoke-tested on a runner of its own system: `ubuntu-24.04` (x64), `ubuntu-24.04-arm` (arm64), `macos-15` (arm64), an Intel macOS runner. macOS binaries get an ad-hoc signature (`codesign -s -`) | An Apple Silicon Mac kills an unsigned binary; a cross-built one cannot be started where it was built |
| S4 | The archive holds one folder `pi-studio-<version>-<target>/` with `pi-studio`, `bun` (a two-line shell script, see the architecture), Pi's runtime assets, and `web/` (the web UI for `pi-studio ui`) | One unpack gives a complete, movable version folder |
| S5 | The pin is `desktop/daemon-pin.json` (`{version, assets: {target: {url, sha256, size}}}`), compiled into the app. The release workflow overwrites the runner's copy from `daemon-updates/latest.json`; the committed copy is refreshed by the same script when a developer runs it | P2 without a manual step in releases; a local build still has a valid pin |
| S6 | The desktop release waits up to 30 minutes for `daemon-updates/latest.json` to reach `minDaemonVersion`, then fails (P14) | A merge that raises the minimum and changes the daemon starts the npm release and the desktop release at the same time; the binaries come later |
| S7 | The app makes sure the binary is installed before it does anything with the local entry, a status probe included. A running npm daemon is then found by the binary's `daemon status` (same folder, same PID file) and used as it is | The app has one way to talk to the local daemon. Cost: a user with a running npm daemon also downloads the binary on first use (refines D9: "no download for a user of remote daemons only" still holds) |
| S8 | Downloads use `reqwest` with rustls (already in the app through the updater plug-in), streamed to a temporary file with the SHA-256 computed on the way; a stall limit of 60 s, no total limit | Constant memory for a 54 MB file; slow links are not cut off |
| S9 | Downloaded archives are kept in the app's data folder, `daemon-archives/<version>/<target>.tar.gz`, for the pinned version only; other versions are removed when the pin changes | An SSH install for the same system does not download again (P10) |
| S10 | `LocalState`: `cli_missing` is removed; `cli_outdated` becomes `outdated {version}` (the running daemon is older than `minDaemonVersion`); new `downloading {received, total}` and `installing`; `failed` gains reasons `download_failed`, `checksum_mismatch`, `install_failed`; `update_failed` is removed, because Update now installs the pin and fails with the install's reasons. Windows stays `unsupported` | States follow what the app now does |
| S11 | The command-line tool is a section of the Daemons screen's local settings, where `autoStartLocalDaemon` already is (the "Settings" of D11) | The desktop's own settings live there |
| S12 | The app's settings drop `cliPath`; an old settings file's `cliPath` is ignored as an unknown key | No compatibility (owner) |

## Public contract

### 1. Release files (S1, S2)

| Release | Assets |
|---|---|
| `daemon-v<version>` | `pi-studio-<version>-<target>.tar.gz` for the four targets, `SHA256SUMS` |
| `daemon-updates` (fixed) | `latest.json` |

```
latest.json {
  version: "0.0.131"
  pub_date: ISO 8601
  assets: { "<target>": { url, sha256, size } }     // url points into daemon-v<version>
}
```

Every asset of a version is uploaded before `latest.json` is replaced (P13: one failed binary
publishes none of them, and `latest.json` keeps the previous version).

### 2. The binary (P4)

One executable, `pi-studio`, with the CLI's whole command surface ([cli.md](cli.md)), including
`ui`, `relay` and `--json daemon start|restart|stop|status|pair`. Hidden sub-commands start the
binary's other programs; they are an internal contract, listed in the architecture document.
`pi-studio --version` prints the version and nothing else.

### 3. The layout on a machine (P3)

```
$PI_STUDIO_HOME/bin/                    # default ~/.pi-studio/bin
  versions/<version>/pi-studio         # one folder per installed version (S4)
  current -> versions/<version>        # symbolic link, switched by rename
  tmp/                                 # downloads and unpacking; emptied at every install
```

The executable the app and the command-line tool run is `$PI_STUDIO_HOME/bin/current/pi-studio`. The
current and the previous version are kept; older folders are removed after the daemon of the current
one has started. The rest of `$PI_STUDIO_HOME` is unchanged and shared with an npm daemon (D8).

The app reads `PI_STUDIO_HOME` from the login shell's environment it already captures
(`shell_env.rs`), so a user who moved the folder keeps it.

### 4. Desktop app

| Surface | Change |
|---|---|
| `desktop/daemon-pin.json` (S5) | compiled in; `daemons.local.pin()` gives `{version, target}` to the page for display |
| `LocalState` (S10) | `unsupported`, `checking`, `downloading {received, total}`, `installing`, `stopped`, `starting`, `stopping`, `updating`, `running {host, port}`, `outdated {version}`, `failed {reason, output?}` |
| `daemon.local.start` / `restart` / `refresh` | install the pin first when needed (S7) |
| `daemon.local.update` | installs the pin and restarts; offered only for `outdated`, or `stopped` with a daemon older than the pin (P11) |
| `cli_tool.state` → `CliToolState`, `cli_tool.install` | new (D11, P5) |
| Settings `cliPath` | removed (S12) |
| Workbench host contract | the `cliPath` field and the CLI-missing view go; the Daemons screen shows the new states and the tool section |

```
CliToolState =
  | { state: "absent" }                         // nothing at ~/.local/bin/pi-studio
  | { state: "installed" }                      // our link, and `pi-studio` in the login shell is ours
  | { state: "not_on_path" }                    // our link, but ~/.local/bin is not on PATH
  | { state: "shadowed", path }                 // our link, but another pi-studio comes first on PATH
  | { state: "occupied" }                       // a file that is not our link is at ~/.local/bin/pi-studio
  | { state: "unavailable" }                    // no binary installed yet, or Windows
```

### 5. Daemon and CLI

| Surface | Change |
|---|---|
| `installKind` | new value `binary` ([self-update.md](self-update.md)) |
| Baseline pack | `pi-background-tasks` is no longer in `core`; on a binary daemon the sources in `BINARY_EXCLUDED_PACKAGES` (the same package) are still neither loaded nor installed, for users who installed it themselves (D2) |
| Pi's package manager | on a binary daemon, the `bun` script beside the binary, set inside each process (P8) |
| `pi-studio ui` | serves `web/` beside the binary |

## Behavior & algorithms

### Release (P1, P13, S1–S3)

`release.yml` keeps its first job (bump, npm, Docker, deploy, version commit). The job also outputs
the version and the commit it pushed. New jobs run after it:

```
binaries (matrix of the four targets, each on its own runner, S3):
    checkout the release commit; npm ci; build the packages
    bun build --compile for the target (exact Bun version, see the architecture)
    macOS: codesign -s - pi-studio
    assemble the folder (S4); tar.gz
    smoke test on this runner, HOME and PI_STUDIO_HOME in a temporary folder:
        pi-studio --version == version
        pi-studio --json daemon start; /api/health answers {status: ok, version}
        a mock agent turn through the SDK; a terminal echoes; a 1 MiB upload and download match
        pi-studio __pi --version answers
        pi-studio --json daemon stop
    upload the archive as a workflow artifact

publish (needs all four):
    write SHA256SUMS and latest.json
    gh release create daemon-v<version> --latest=false  (assets)
    gh release create daemon-updates --latest=false if missing; upload latest.json --clobber
```

The npm release is never delayed or failed by these jobs. A failed `binaries` job leaves the
previous `latest.json` in place.

### The pin (P2, P14, S5, S6)

```
desktop-release.yml, before the bundle jobs:
    read daemon-updates/latest.json; retry every 60 s for up to 30 min while version < minDaemonVersion
    if still lower: fail ("no daemon binary ≥ <min> is published")
    write desktop/daemon-pin.json in the runner's copy
```

`desktop/apps/pistudiodesktop/scripts/release/daemon-pin.mjs` does the reading and writing; a
developer runs the same script to refresh the committed copy. The Rust side compiles the file in and
refuses to build when it is not valid (a version, four targets, 64-hex checksums).

### The local entry (D8, D9, S7, S10)

```
ensure_binary():                                     # before any local action
    if platform is Windows: state unsupported; stop
    target = this machine's target                   # compile-time os + arch
    cur = version of $HOME_PS/bin/current/pi-studio (`--version`, 15 s)   # missing or broken → none
    if cur is some and cur >= pin.version: return cur                   # P11: never downgrade
    install(pin.version):
        if versions/<pin>/pi-studio answers --version == pin: switch current; return
        archive = cached archive (S9) or download(pin.assets[target]) with state downloading
        sha256 of the archive != pin sha256 → delete; failed(checksum_mismatch)
        state installing
        unpack into bin/tmp/<random>/; refuse an entry outside it (P9) → failed(install_failed)
        <tmp>/pi-studio --version must equal pin.version → else failed(install_failed, output)
        rename into versions/<pin> (replacing a broken folder of that name)
        switch current: symlink current.new → versions/<pin>; rename current.new → current
        empty bin/tmp
    return pin.version

start / restart / refresh: ensure_binary(), then today's flow with
    program = $HOME_PS/bin/current/pi-studio and the captured environment
after a start that reached running: remove version folders other than current and the previous one
```

A running daemon older than `minDaemonVersion` is `outdated {version}`; Update stops it with the
binary's `daemon stop` (the PID file is shared), installs the pin, and starts it. A daemon newer than
the pin is never replaced (P11); its own updates move it ([self-update.md](self-update.md)).

The download runs on the supervisor's thread, like the other local commands, and reports progress
through the same `apply` hook, at most every 250 ms. Closing the app during a download leaves a
partial file in `bin/tmp` or the archive cache's temporary name; both are removed at the next
install (P10).

### The command-line tool (D11, P5, S11)

```
cli_tool.state:
    if no current binary or Windows: unavailable
    link = ~/.local/bin/pi-studio
    if link missing: absent
    if link is not a symlink to $HOME_PS/bin/current/pi-studio: occupied
    found = `command -v pi-studio` in the login shell (the captured environment's PATH)
    if found is none: not_on_path
    if realpath(found) != realpath(link): shadowed(found)
    else installed

cli_tool.install:
    mkdir -p ~/.local/bin
    if state is occupied: refuse (never overwrite a file the app did not make)
    create the symlink; recapture the login shell's environment; answer cli_tool.state
```

The link points at `current`, so it follows every update. The Daemons screen shows the state in a
sentence: for `not_on_path`, the line to add to the shell's start-up file; for `shadowed`, the other
path; for `occupied`, that a file is in the way. The app never edits a shell file.

### Pi in the binary (D2, P8, P16)

Every process of the binary that loads Pi, the daemon and each `__pi` child, replaces two methods of
Pi's `SettingsManager` before Pi reads its settings:

- `getNpmCommand()` answers the `bun` script beside the binary, so `pi install npm:…` works with no
  npm and Pi's `settings.json` is not written.
- The package list Pi loads leaves out every source in `BINARY_EXCLUDED_PACKAGES`, so an excluded
  package already installed (by an npm daemon or the user's own Pi) is not loaded by the binary's
  Pi, and stays in the user's settings for their own Pi.

The baseline sync on a binary daemon skips the excluded sources. An extension that fails to load for
another reason is not hidden: the agent's error names it (P16). The first task of the milestone
proves both replacements in the compiled binary; if either does not work, the work stops and goes
back to the owner (grill, open question 3).

## Data & persistence touchpoints

- New on every machine with a binary: `$PI_STUDIO_HOME/bin/` (layout above).
- New in the app's data folder: `daemon-archives/<version>/<target>.tar.gz` (S9).
- New in the repository: `desktop/daemon-pin.json`.
- App settings: `cliPath` removed (S12).
- Optional: `~/.local/bin/pi-studio`, a symbolic link.
- Unchanged and shared with an npm daemon: everything else under `$PI_STUDIO_HOME` and the Pi folder.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| No internet, or GitHub fails, at the first local start | `failed(download_failed)`; the row offers Retry; remote entries work (P9) |
| The download stalls for 60 s | as a failed download |
| The archive's checksum differs from the pin | deleted, never unpacked; `failed(checksum_mismatch)` (P9) |
| An entry of the archive points outside its folder | the install stops; `failed(install_failed)` (P9) |
| The unpacked binary does not answer `--version` with the pin (an old glibc, a full disk, a folder mounted `noexec`) | `failed(install_failed)` with its output; the folder is removed (P12) |
| The app closes during a download or an install | the partial files are removed at the next attempt (P10) |
| `current` is a broken link or its folder is gone | treated as not installed (P10) |
| The pinned version is already in `versions/` | used without a download (P10) |
| An npm daemon is running | the binary's `daemon status` finds it and the app connects (D8, S7) |
| An npm daemon is running and is older than `minDaemonVersion` | `outdated`; Update stops it, installs the pin, starts the binary |
| The binary is newer than the pin | used; never replaced by the app (P11) |
| Two app windows | the app is single instance; the supervisor runs one command at a time |
| An excluded package is installed | not loaded by the binary's Pi; still installed for the user's own Pi (D2) |
| Another extension fails under Bun | the agent's error names it; nothing is disabled (P16) |
| A desktop release while no binary ≥ the minimum is published | waits 30 min, then fails (S6) |
| One binary fails its smoke test | no binary for that version; `latest.json` unchanged (P13) |
| Windows | the local entry stays `unsupported`; the tool section is `unavailable` (D3) |
| `~/.local/bin/pi-studio` is a file of the user's | `occupied`; nothing is overwritten |
| `PI_STUDIO_HOME` set in the login shell | the binary goes under that folder |

## Dependencies on other specs

- `architecture/single-binary-daemon.md`: the build, the sub-commands, the code seams.
- `features/desktop-ssh-daemon-install.md`: uses the pin, the archive cache and the version layout.
- `features/self-update.md`: the `binary` install kind and what moves a binary daemon forward.
- `features/desktop-daemon-registry.md`: the local supervisor and the Daemons screen change.
- `features/preinstalled-extensions.md`: the excluded sources.
- `features/desktop-self-update.md`: `desktop-release.yml` gains the pin step.

## Acceptance criteria

Proof is on Linux, live, in containers with nothing installed; on macOS only that the released binary
starts on a macOS runner (D16).

- [ ] A release creates `daemon-v<version>` with four archives and `SHA256SUMS`, not marked "latest";
      `daemon-updates/latest.json` names that version; each binary passed its smoke test on its own
      system, macOS included.
- [ ] A binary made to fail its smoke test publishes no binary for that version; npm and Docker are
      published; `latest.json` keeps the previous version.
- [ ] A desktop build pins the version of `latest.json`; with a `minDaemonVersion` above it the build
      waits, then fails.
- [ ] Linux container with no Node, npm or `pi-studio`: the app's first launch downloads the pin with
      progress on the Daemons screen, the daemon starts, the workbench connects.
- [ ] On that daemon a real agent turn with Pi runs a shell command and uses the todo tool; a terminal
      opens; a file goes up and down intact.
- [ ] Pi installs an extension on that daemon with no npm on the machine; Pi's `settings.json` gains
      only the installed entry (no `npmCommand`, no entry removed).
- [ ] With `pi-background-tasks` already installed (it is no longer in the baseline), an agent starts.
- [ ] With no network, and with a corrupted archive, nothing is run and the row offers Retry.
- [ ] With an npm daemon running that has agents and history, the app connects to it; after Restart
      the binary runs on the same folder and port and the agents and history are there.
- [ ] A binary newer than the pin is not replaced.
- [ ] "Install the command-line tool": `pi-studio --version` answers in a new terminal; with
      `~/.local/bin` off `PATH`, or another `pi-studio` first, or a file in the way, the screen says
      so and nothing is overwritten.
- [ ] The app has no `cliPath` setting and no search for an installed CLI.

## TODO(verify)

- The two `SettingsManager` replacements in the compiled binary (the first task; the work stops if
  they fail). — agent
- The server test suite was never run under Bun; `skills` CLI operations, extension auto-sync at boot
  and a complete OAuth login were not exercised in the binary. — agent
- What Pi in the binary does when another extension fails to load: does it exit, and does its error
  name the extension (P16)? — agent
- The label of an Intel macOS runner (S3). — agent
- A macOS binary the app downloaded is never started on a real Mac in this milestone (D16). The app's
  download sets no quarantine attribute, so Gatekeeper is not expected to check it. [INFERENCE] until
  the owner runs it.
- The oldest glibc the Linux binaries run on. — agent, in the release task
