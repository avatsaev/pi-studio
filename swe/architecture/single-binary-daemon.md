# Single-Binary Daemon — Exploration Record

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [daemon-bootstrap.md](daemon-bootstrap.md),
> [ssh-gateway-connections.md](ssh-gateway-connections.md),
> [../features/self-update.md](../features/self-update.md),
> [../features/desktop-app.md](../features/desktop-app.md)

> **Status (2026-11-22): explored, not built, not scheduled.** This is the record of a one-day
> exploration the owner asked for. It holds what was measured, what was only designed, and what the
> owner decided. No feature specification or sprint plan exists. Nothing in the repository changed:
> the spike lived in a scratch directory and patched files at build time.

## Goal

Three things the owner wants, all about distribution:

1. Run a local daemon from the desktop app without a separately installed `pi-studio` CLI.
2. Install a daemon on a remote host from the app, over a direct or SSH connection.
3. Update a daemon easily.

## A Rust rewrite was rejected

A daemon in Rust is possible but does not remove the JavaScript runtime, because Pi is a JavaScript
program and the daemon uses it two ways:

- As a subprocess (`pi --mode rpc`). This works from any language.
- As an in-process library, which Rust cannot import: `ModelRuntime` (provider login, structured
  generation), `SessionManager` (history and todos of an agent with no process), and
  `SettingsManager` / `DefaultPackageManager` / `loadSkillsFromDir` (skills).

Each in-process use would have to be reimplemented in Rust and re-checked on every Pi release, or
kept in a JavaScript helper. The server is about 23,000 lines with 27,000 lines of tests, 134 RPC
message types and 65 protocol schemas. The estimate was 4–6 months to parity. The goals above do not
need it.

## What was tried instead

The existing daemon was compiled into one executable with `bun build --compile` (Bun 1.4.5), the
same way Pi builds its own standalone binaries. One file acts as three programs:

```ts
const sub = process.argv[2];
if (sub === "__pi") {
  process.argv.splice(2, 1);
  await import("@earendil-works/pi-coding-agent/dist/bun/cli.js"); // by file path
} else if (sub === "__skills") {
  process.argv.splice(2, 1);
  await import("skills/bin/cli.mjs"); // by file path
} else {
  await import("@earendil-works/pi-coding-agent/dist/bun/runtime-setup.js"); // by file path
  await import("packages/server/dist/daemon/main.js");
}
```

Pi's two worker files (`dist/utils/image-resize-worker.js`, `dist/extensions/codemode/worker.js`)
are extra entry points, and the build uses `autoloadBunfig: false` and `autoloadDotenv: false`, as
Pi's own build does. Pi reads its assets (its `package.json`, `theme/`, `export-html/`,
`photon_rs_bg.wasm`) from the directory of the executable, so they ship next to it.

## Measured on Linux x64

Each row was run against the compiled daemon; where a comparison is named, the Node daemon gave the
same result.

| Check | Result |
|---|---|
| Boot, CLI and SDK connect | Works |
| Terminal: real TTY, resize, capture, reflowable restore | Works with Bun's PTY (see Required changes) |
| File upload and download, 64 MiB, and a ranged read | Works, hashes match |
| `provider_auth_list`, `skills_list` (Pi SDK in-process) | Works, same output as Node |
| A real agent turn through the embedded Pi: model call, shell tool, `todo` tool | Works |
| Restart, then timeline and todos of the process-less agent, then a follow-up prompt | Works |
| API-key login and logout, in a throwaway Pi home | Works |
| OAuth login | Starts and reaches its first prompt; a full login was not done |
| Relay protocol 2: terminal and a 16 MiB file through a local relay | Works |
| `pi install npm:…` and loading the package, with no Node or npm on `PATH` | Works (see below) |
| Cross-compile: Linux arm64, Linux x64 musl, macOS arm64 and x64, Windows x64 | All build; none were run |

- Size: 119 MiB; 54 MiB as a tar.gz with Pi's runtime assets.
- Time to listening: about 200 ms, against about 320 ms for Node.
- Idle memory: about the same as Node (56 MiB against 60 MiB, loosely measured).

**No npm on the host.** Pi accepts `bun` as its package manager (`npmCommand` in Pi's
`settings.json`), and a Bun executable started with `BUN_BE_BUN=1` behaves as the `bun` program. A
two-line shell script named `bun` next to the binary was enough:

```sh
#!/bin/sh
BUN_BE_BUN=1 exec "$(dirname "$0")/pi-studiod" "$@"
```

Without it, `pi install npm:…` fails with `Executable not found in $PATH: "npm"`.

## Required changes

The spike made these at build time; a real build target needs them in the source.

1. **Terminal backend.** `node-pty` does not work under Bun: the shell exits within 2 ms with
   SIGHUP. `Bun.spawn(…, { terminal })` gives a real TTY with resize. `PtyBackend`
   (`packages/server/src/terminal/pty-backend.ts`) is already an interface, so this is one more
   backend. `node-pty` must not be imported at module load in the binary, or the daemon does not
   start.
2. **Spawn sites.** Nine places run `process.execPath <script>` for Pi and the `skills` CLI
   (`rpc-transport.ts`, `sync-executor.ts`, `resource-service.ts`). In the binary `process.execPath`
   is the binary, so they must call its sub-commands. The spike exercised only the agent path,
   through `agents.providers.pi.command`.
3. **Two `createRequire` calls.** `version.ts` (reads `../package.json`) and `screen-buffer.ts`
   (loads the xterm packages) are not followed by Bun's bundler. They need static imports or a
   build-time constant.
4. **Pi's standalone setup.** The daemon must import Pi's `dist/bun/runtime-setup.js` before using
   the SDK. Without it OAuth login fails with `Cannot find module './anthropic.js'`.
5. **Package manager.** Pi's `npmCommand` must point at the `bun` script above.

## Known limit: some Pi extensions do not load

`@99percentpeople/pi-background-tasks` fails to load under the binary
(`Cannot find package 'node-pty'`), and Pi exits, so no agent starts. Pi's official standalone
binary (1.4.0) fails the same way, so this is a limit of Pi on Bun. Of 15 other packages probed one
at a time, 14 loaded identically on Node and on the binary and one failed on both.

The planned answer is to keep both modes: the binary by default, and Pi run through Node
(`agents.providers.pi.command`) on a host that has Node and needs such an extension.

## Releases and updates (designed, not tried)

- **One executable.** A single `pi-studio` binary holds the CLI, the daemon, Pi and the `skills`
  CLI, so `pi-studio --json daemon start|stop|restart` and the desktop app's use of it do not
  change. Bundling the CLI was not tried.
- **Release.** `release.yml` gains a job that cross-compiles the four POSIX targets on the Linux
  runner and uploads one tar.gz per target, `SHA256SUMS` and a manifest to a GitHub Release with the
  npm version. npm and Docker stay. The Bun version is pinned exactly. A smoke test runs against
  the built binary, because the test suite runs on Node.
- **Layout on a host.** `~/.pi-studio/bin/versions/<version>/` with a `current` symlink. An update
  never overwrites a running file, and the previous version stays for rollback.
- **Local daemon of the desktop app.** The app downloads the daemon binary on first use (the
  owner's decision, below) into that layout and runs it from there, never from inside the app
  bundle: the daemon outlives the app, and an AppImage's files disappear when the app exits.
- **Remote host over SSH.** The app reads the host's OS and CPU, downloads the matching tar.gz,
  verifies it, uploads it over the SSH connection and runs `pi-studio --json daemon start`.
- **Direct or relay connection.** The daemon updates itself through the `update_*` RPCs of
  [../features/self-update.md](../features/self-update.md), with a new `binary` install kind:
  download and verify into `versions/<new>/`, start a waiter from the new binary, shut down; the
  waiter flips `current`, starts the new daemon, checks health, and flips back on failure.
- **A restart** kills open terminals and interrupts a running turn; history, todos and resume were
  seen to survive one in the spike.

## Desktop app self-update (designed, not tried; specified 2026-11-23)

Specified in [../features/desktop-self-update.md](../features/desktop-self-update.md), which
supersedes this sketch. Two points of the sketch were wrong or changed: the plug-in 2.14.1 installs
`.deb` and `.rpm` packages too (through `pkexec`; the app runs that step itself, D7), and the private
key lives in a GitHub environment restricted to `main` rather than as a plain repository secret
(U1). The app never restarts on its own, and updating it does not stop the daemon.

## Owner's decisions (2026-11-22)

- A Rust rewrite of the daemon is not pursued; the single-binary route is the one to explore.
- The desktop app can update itself.
- The desktop app downloads the daemon binary on first use; the installer does not carry it. The
  app carries a pinned list (daemon version, URL and checksum per target). The first local daemon
  start needs internet access.

## Open points

- macOS and Windows binaries were never run. Unknown: macOS signing and Gatekeeper for a downloaded
  daemon, and whether Bun's PTY exists on Windows.
- The server test suite was not run under Bun. `skills` CLI operations, extension auto-sync on boot
  and a complete OAuth login were not exercised.
- Whether the app updates a remote daemon to its own pinned version or to the latest release.
- Every qualifying merge publishes a desktop release, so update prompts need a slower channel or a
  rate limit.
- The app is ad-hoc signed on macOS; the keychain may ask again after each update. Not checked.
- A daemon GitHub Release must not become the repository's "latest" release, or the app's update
  manifest URL breaks.
- The daemon version the app pins must be published before the desktop build runs; the two
  workflows are independent today.
- Three gaps listed by the self-update specification, not re-checked: shutdown does not stop agent
  processes, the PID file is not removed, `daemon restart` does not wait for the old process.
