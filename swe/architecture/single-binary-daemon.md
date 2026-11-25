# Single-Binary Daemon — Architecture

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [daemon-bootstrap.md](daemon-bootstrap.md),
> [../features/single-binary-daemon.md](../features/single-binary-daemon.md),
> [../features/desktop-ssh-daemon-install.md](../features/desktop-ssh-daemon-install.md),
> [../features/self-update.md](../features/self-update.md),
> [../features/desktop-self-update.md](../features/desktop-self-update.md)

> **Status (2026-11-24): built (sprints 139–145).** Desktop roadmap milestone 6. The design follows the
> grill [../grills/single-binary-daemon.md](../grills/single-binary-daemon.md) (readout confirmed by
> the owner on 2026-11-24). Until then this file was the record of a one-day exploration
> (2026-11-22); its measurements are kept below. A1–A10 were proposed here and built; the evidence
> is in the sprint summaries and `packages/server/docs/binary-live-results.md`.

## Goal

Three things the owner wants, all about distribution (2026-11-22):

1. Run a local daemon from the desktop app without a separately installed `pi-studio` CLI.
2. Install a daemon on a remote host from the app over SSH.
3. Update a daemon easily.

The features are [../features/single-binary-daemon.md](../features/single-binary-daemon.md) (the binary,
its release, the app's local daemon), [../features/desktop-ssh-daemon-install.md](../features/desktop-ssh-daemon-install.md)
(SSH hosts) and the `binary` install kind of [../features/self-update.md](../features/self-update.md).
This file is how the binary is made and what changes in the code.

## A Rust rewrite was rejected

A daemon in Rust is possible but does not remove the JavaScript runtime, because Pi is a JavaScript
program and the daemon uses it two ways: as a subprocess (`pi --mode rpc`), and as an in-process
library (`ModelRuntime`, `SessionManager`, `SettingsManager`, `DefaultPackageManager`,
`loadSkillsFromDir`), which Rust cannot import. The server is about 23,000 lines with 27,000 lines of
tests; the estimate was 4–6 months to parity. The owner chose the single binary instead (2026-11-22).

## Decisions proposed here

| # | Decision | Why |
|---|---|---|
| A1 | Bun is an exact-pinned root `devDependency` (`bun`, 1.4.5 or the version the first task proves); `npm run build:binary -- --target <target>` builds one target with it | No separate install for developers or CI; one version everywhere |
| A2 | The binary's entry is `packages/cli/src/binary-main.ts`. It dispatches on its first argument: a hidden sub-command (below) or the normal CLI | One file is every program (P4) |
| A3 | One module, `packages/server/src/runtime/self.ts`, answers "how do I start Pi, the `skills` CLI, the daemon, the relay, the update helper" for both runtimes; every spawn site and the CLI's starters use it | Nine spawn sites and three starters agree; the Node path stays the default |
| A4 | Under Bun the terminal backend is `Bun.spawn(…, { terminal })`; under Node it stays `node-pty`, imported lazily | `node-pty` does not load under Bun; importing it at module load stops the daemon |
| A5 | The five `createRequire` calls become static imports or build-time constants (`SERVER_VERSION` from a generated module) | Bun's bundler does not follow `createRequire` |
| A6 | `packages/server/src/runtime/pi-overrides.ts` replaces `SettingsManager.prototype.getNpmCommand` and filters the package list (`BINARY_EXCLUDED_PACKAGES`) when running as the binary; the daemon applies it at start, the `__pi` entry before Pi's own entry | P8: the user's Pi settings are never written; D2 |
| A7 | Pi's runtime assets and the `bun` script ship beside the executable; `self.ts` finds them from `process.execPath` | Pi reads its assets from the executable's folder |
| A8 | `installKind` is `binary` when a build-time constant says so; whether it can update depends on the executable being under `$PI_STUDIO_HOME/bin/versions/` | [../features/self-update.md](../features/self-update.md) |
| A9 | Server and CLI tests keep running on Node. The binary is checked by the smoke test of each release job and by `npm run test:binary` (the same smoke test, local) | The suite was never run under Bun; making it run there is not a goal |
| A10 | macOS binaries are built and ad-hoc signed on macOS runners | An Apple Silicon Mac kills an unsigned binary |

## The build

```
npm run build                                   # as today: tsc -b, the web UI
npm run build:binary -- --target linux-x64      # scripts/build-binary.mjs
    bun build --compile packages/cli/dist/binary-main.js
        --target=bun-<os>-<arch>
        --define PI_STUDIO_BINARY=true
        extra entry points: Pi's two worker files
        autoloadBunfig: false, autoloadDotenv: false        # as Pi's own build does
    assemble dist-binary/pi-studio-<version>-<target>/:
        pi-studio
        bun                       # #!/bin/sh  BUN_BE_BUN=1 exec "$(dirname "$0")/pi-studio" "$@"
        Pi's package.json, theme/, export-html/, photon_rs_bg.wasm
    macOS: codesign -s - pi-studio  (on a macOS runner, A10)
    tar.gz
```

Size from the spike: 119 MiB unpacked, 54 MiB as a tar.gz without the web UI.

## The sub-commands (A2)

| First argument | Program | Started by |
|---|---|---|
| (none of the below) | the CLI (`program.ts`) | the user, the desktop app |
| `__daemon <json>` | `runDaemon` of the server, with host, port and home | `pi-studio daemon start` (replaces `node -e` with a module URL) |
| `__relay <json>` | the relay server | `pi-studio relay start` |
| `__pi …` | Pi's `dist/bun/cli.js`, after `pi-overrides` (A6) | the agent provider, extension sync, resources, `pi-studio pi` |
| `__skills …` | the `skills` CLI | resources |
| `__update-helper <json>` | the self-update helper | the daemon's apply ([../features/self-update.md](../features/self-update.md)) |

`bun` is not a sub-command: the `bun` script sets `BUN_BE_BUN=1`, which makes a Bun-compiled executable
behave as Bun itself (shown in the spike). These names are internal and may change between versions;
nothing outside the binary calls them, because a running daemon and its helper always come from the
same version folder.

## The runtime seam (A3)

```
self.ts
    isBinary: boolean                         # PI_STUDIO_BINARY
    piCommand(args)        → Node: [execPath, <Pi's bin>, …args]     Binary: [execPath, "__pi", …args]
    skillsCommand(args)    → Node: [execPath, <skills bin>, …args]  Binary: [execPath, "__skills", …args]
    daemonCommand(opts)    → Node: [execPath, "--input-type=module", "-e", <script>]   Binary: [execPath, "__daemon", json]
    relayCommand(opts)     → likewise
    helperCommand(params)  → Node: [execPath, "-e", HELPER_SCRIPT, json]               Binary: [execPath, "__update-helper", json]
    assetsDir()            → Binary: dirname(execPath); Node: unused
    webDist()              → Binary: assetsDir()/web; Node: resolve @av-pi-studio/web-client
```

`agents.providers.pi.command` still overrides the Pi command on both runtimes, so a host with Node can
run Pi under Node for an extension that needs it (P16).

The daemon also imports Pi's `dist/bun/runtime-setup.js` before it uses the Pi SDK when it is the
binary; without it an OAuth login fails with `Cannot find module './anthropic.js'` (spike).

## Pi's settings (A6, P8, D2)

```
applyPiOverrides(SettingsManager, DefaultPackageManager):          # only when isBinary
    SettingsManager.prototype.getNpmCommand = () => [assetsDir()/bun]
    DefaultPackageManager.prototype.resolve runs inside an AsyncLocalStorage scope; the settings
    reads made inside it (getGlobalSettings, getProjectSettings) leave out every `packages` entry
    whose identity is in BINARY_EXCLUDED_PACKAGES
```

Only `resolve()` is filtered: it is the one place Pi turns its configured packages into what it
loads and installs what is missing. `addSourceToSettings` and the other writers read the whole list,
so a write never drops an excluded entry from the user's settings. Applied in the daemon at start
(it uses `SettingsManager` and `DefaultPackageManager` in-process for skills and resources) and in
`__pi` before Pi's entry runs. The code is `packages/server/src/runtime/pi-overrides.ts`; the pure
source parsing it needs is `extensions/pi-source.ts` (split out of `curated-packs.ts` so the module
loads inside the binary without the server version).

**Proved 2026-11-24 (sprint-139/task-001), linux-x64, Bun 1.4.5, a bare container with no Node or
npm:** `pi install` works through the `bun` script; with the excluded package installed on disk and
in settings, `pi --mode rpc` starts, answers and does not load it, and the other extension loads;
without the exclusion the same setup fails with `Cannot find module 'node-pty'` (the known limit).
`settings.json` gains only the entry that was installed, no `npmCommand`, and keeps the excluded
entry. Proof script: `packages/server/scripts/pi-overrides-proof/run.sh`. This is a fifth place that
mirrors Pi internals (root `AGENTS.md` § Pi dependency posture); re-check it on every Pi bump.

## Install kind and paths (A8)

The binary reports `installKind: binary`. It can update itself when `realpath(execPath)` is
`$PI_STUDIO_HOME/bin/versions/<version>/pi-studio` and that `bin` folder is writable; otherwise
`cannot_update(unmanaged_binary)`. The layout and the update are in the two feature specs.

## Measured in the spike (2026-11-22, Linux x64, Bun 1.4.5)

Each row was run against the compiled daemon; where a comparison is named, the Node daemon gave the
same result.

| Check | Result |
|---|---|
| Boot, CLI and SDK connect | Works |
| Terminal: real TTY, resize, capture, reflowable restore | Works with Bun's PTY |
| File upload and download, 64 MiB, and a ranged read | Works, hashes match |
| `provider_auth_list`, `skills_list` (Pi SDK in-process) | Works, same output as Node |
| A real agent turn through the embedded Pi: model call, shell tool, `todo` tool | Works |
| Restart, then timeline and todos of the process-less agent, then a follow-up prompt | Works |
| API-key login and logout, in a throwaway Pi home | Works |
| OAuth login | Starts and reaches its first prompt; a full login was not done |
| Relay protocol 2: terminal and a 16 MiB file through a local relay | Works |
| `pi install npm:…` and loading the package, with no Node or npm on `PATH` | Works with the `bun` script and `npmCommand` (set in Pi's settings file then) |
| Cross-compile: Linux arm64, Linux x64 musl, macOS arm64 and x64, Windows x64 | All build; none were run |

Time to listening about 200 ms (Node about 320 ms); idle memory about the same as Node.

## Known limit: some Pi extensions do not load

`@99percentpeople/pi-background-tasks` fails to load under the binary (`Cannot find package
'node-pty'`), and Pi exits, so no agent starts. Pi's official standalone binary (1.4.0) fails the same
way. Of 15 other packages probed one at a time, 14 loaded identically on Node and on the binary and
one failed on both. Answer (D2): the binary leaves it out; the npm daemon keeps it.

## Owner's decisions

- 2026-11-22: no Rust rewrite; the app can update itself; the app downloads the daemon binary on first
  use and carries a pinned list (version, address and checksum per target).
- 2026-11-24 (grill): all four parts in milestone 6; no Windows; npm and Docker stay; the app uses only
  its binary; four targets; the daemon updates itself trusting GitHub over HTTPS plus a checksum; a
  rolled-back version is skipped; the binary takes over an npm daemon's folder and port; proof is
  Linux live and "the binary starts" on macOS. The full list is the grill brief.

## Open points

- Both `SettingsManager` replacements inside the compiled binary (first task; the work stops if they
  fail).
- The server test suite was never run under Bun; `skills` operations, extension sync at boot and a
  full OAuth login were not exercised in the binary.
- What Pi in the binary does when another extension fails to load.
- The oldest glibc the Linux binaries run on; the Intel macOS runner label.
- A macOS binary is never started on a real Mac in this milestone (owner's choice of proof).
