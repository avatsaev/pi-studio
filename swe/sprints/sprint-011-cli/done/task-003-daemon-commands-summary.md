# Task 003 — Daemon command group + local spawn + QR pairing — Summary

- **Sprint:** sprint-011-cli
- **Completed:** 2026-06-14
- **Status:** done

## What was implemented
The `daemon` command group, a local daemon spawner, and QR pairing — all built on injectable
side-effects so the command layer is unit-testable without real processes/sockets.

- **`daemon-control.ts`**:
  - `daemonPaths`/`readDaemonPid` (shared `$PI_STUDIO_HOME` files: `config.json`, `pi-studio.pid`,
    `daemon-keypair.json`).
  - Injectable `DaemonRuntime` = `{ probe, hash, kill, start }` with production defaults:
    `httpHealthProbe` (GET `/api/health`), `bcryptHasher` (bcryptjs), `signalKiller` (`process.kill`),
    `subprocessStarter` (detached `node` importing `@av-pi-studio/server` → `bootstrap`).
  - `daemonStatus`, `setDaemonPassword` (writes bcrypt hash into `config.json` → `daemon.auth.password`,
    preserving existing keys), `stopDaemon`, `waitForDaemon` (bounded health poll).
- **`pairing.ts`** — `readDaemonPublicKey` (from `daemon-keypair.json`) and `buildPairingUrl` which
  puts the Curve25519 public key in the **URL fragment** (`https://app.pi-studio.sh/#offer=<key>`),
  never sent to the web origin (relay-e2ee § Pairing).
- **`qr.ts`** — `renderQrToTerminal` via `qrcode` (terminal block rendering).
- **`daemon-commands.ts`** — `registerDaemonCommands` wires `daemon status|start|stop|restart|pair|
  set-password` plus top-level `onboard`; `printPairing` and `ensureLocalDaemonAndPair` (probe →
  spawn if down → wait healthy → pair). The root default action (bare `pi-studio`) now runs
  `ensureLocalDaemonAndPair`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/package.json` | added `qrcode`, `bcryptjs` deps (+ `@types/*` dev) |
| `packages/cli/src/daemon-control.ts` | created |
| `packages/cli/src/pairing.ts` | created |
| `packages/cli/src/qr.ts` | created |
| `packages/cli/src/daemon-commands.ts` | created |
| `packages/cli/src/daemon-commands.test.ts` | added (15 tests) |
| `packages/cli/src/cli-core.ts` | `CliContext.daemon?: DaemonRuntime` injection point |
| `packages/cli/src/program.ts` | register daemon commands; root default → onboard |
| `packages/cli/src/index.ts` | re-export new modules |

## How it satisfies the scope
Maps to `features/cli.md` § Command tree (daemon) + § Behavior, `architecture/daemon-bootstrap.md`,
and `architecture/relay-e2ee.md` § Pairing:
- `daemon start` → spawn local daemon (`$PI_STUDIO_HOME`, `127.0.0.1:6767`) + render pairing QR.
- `stop`/`restart`/`status` → manage/report the local daemon via pid lock + health probe.
- `set-password` → bcrypt hash persisted to `config.json` the daemon enforces on next start.
- Bare `pi-studio` / `onboard` → start a local daemon when none is reachable, then show the QR.
- Pairing key rides in the URL fragment (trust anchor), matching relay-e2ee.

## Build & test results
```
$ npx tsc -b packages/cli                                   → exit 0
$ npm run build                                             → exit 0 (all packages)
$ npx vitest run packages/cli/src                           → 48 passed (4 files)
$ npx vitest run            (full suite)                    → 405 passed (59 files)
$ npx oxlint packages/cli/src                               → clean
$ npx oxfmt --check packages/cli/src                        → clean
```

## Acceptance criteria
- [x] `pi-studio daemon start` starts a daemon and shows a pairing QR code (verified:
      `ensureLocalDaemonAndPair starts a daemon …` asserts spawn + "Pairing link"; QR rendered for
      real by `qrcode`).
- [x] `daemon stop`/`restart`/`status` manage/report the local daemon (verified: `stopDaemon` signals
      the recorded pid / returns false when absent; `daemonStatus` up/down).
- [x] `set-password` stores a bcrypt-hashed password the daemon enforces (verified: writes
      `daemon.auth.password`, preserves config; `bcryptHasher` produces a hash `bcrypt.compareSync`
      accepts — the same primitive the daemon's password-auth uses).
- [x] When no daemon is reachable, `pi-studio` starts a local one or errors with guidance (verified:
      `ensureLocalDaemonAndPair` starts when down, skips when already running, errors when it never
      becomes healthy).

## Follow-ups / TODO(verify)
- Exact bytes/encoding of the pairing `offer` fragment — uses the base64 public key directly
  (relay-e2ee TODO(verify)).
- `subprocessStarter` boots via `import('@av-pi-studio/server').bootstrap(...)`; the server package's
  packaged daemon bin/entry is finalized in the desktop/integration sprint. Tests inject a fake
  starter, so the default isn't exercised in CI.
- Relay `daemon pair` flow specifics remain TODO(verify) per cli.md; current `pair` renders the
  direct pairing link/QR.
