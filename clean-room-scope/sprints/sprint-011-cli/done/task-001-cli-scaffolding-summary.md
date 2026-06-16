# Task 001 — CLI scaffolding + connection + output rendering — Summary

- **Sprint:** sprint-011-cli
- **Completed:** 2026-06-14
- **Status:** done

## What was implemented
Stood up the `@av-pi-studio/cli` Commander.js program shell plus the testable CLI core: daemon
connection (hello handshake with a stable `clientId`), host targeting, password auth, table/json
output rendering, and an RPC-dispatch helper that maps connection/RPC failures to exit codes.

- **`client-id.ts`** — `resolveHome()` (`$PI_STUDIO_HOME`, default `~/.pi-studio`) and
  `resolveClientId()` which persists a stable `cli-client-id` so the CLI presents the same identity
  across runs; best-effort persistence (still usable on a read-only home).
- **`output.ts`** — `renderTable` (fixed-width, uppercase headers, column selection), `renderJson`,
  `renderObject` (key/value lines for `inspect`), and the `OutputSink` abstraction (`consoleSink`).
- **`connection.ts`** — `parseHost` (`host` / `host:port` / `ws(s)://` / `http(s)://`, default port
  6767), `hostToUrl`, `buildDaemonClient` / `connectDaemon` (clientType `"cli"`), and password auth
  carried via the `pi-studio.bearer.<password>` WS subprotocol.
- **`cli-core.ts`** — `CliContext` (injectable connect + sink + transport overrides), exit-code
  constants (`EXIT_OK`/`EXIT_ERROR`/`EXIT_CONNECTION`), `withDaemon` (connect → run action → close,
  translating `RpcError`/`RpcTimeoutError`/connection failure to codes), and `runRpc`
  (single-RPC dispatch + render).
- **`program.ts`** — `buildProgram` (global options `-H/--host`, `--password`, `--home`, `--json`;
  `exitOverride`; a `registerCommands` seam for later tasks) and `run(argv, ctx)` returning a process
  exit code (help/version → 0, usage errors → nonzero).
- **`cli.ts`** — `#!/usr/bin/env node` bin entry wired as `bin.pi-studio` → `dist/cli.js`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/package.json` | added `commander` dep + `bin.pi-studio` |
| `packages/cli/src/client-id.ts` | created |
| `packages/cli/src/output.ts` | created |
| `packages/cli/src/connection.ts` | created |
| `packages/cli/src/cli-core.ts` | created |
| `packages/cli/src/program.ts` | created |
| `packages/cli/src/cli.ts` | created (bin entry) |
| `packages/cli/src/index.ts` | re-exports the CLI core |
| `packages/cli/src/cli-core.test.ts` | added (15 tests) |
| `packages/cli/src/program.test.ts` | added (4 tests) |

## How it satisfies the scope
Maps to `features/cli.md`:
- § Global options → `--host`, `--password`, `--json`, `--home` on the root program.
- § Behavior (main) → `run` parses globals → `withDaemon` connects `DaemonClient` (hello handshake)
  → dispatch RPC → render (table/json) → exit code reflects success/failure.
- § Data & Persistence → stable `cli-client-id` persisted under `$PI_STUDIO_HOME`; daemon owns state.
- § Error Handling → `rpc_error` surfaces a message + `EXIT_ERROR`; unreachable host → `EXIT_CONNECTION`.
- Password auth via subprotocol matches `architecture/auth-security.md` (`pi-studio.bearer.<password>`).

The CLI is a thin client over `@av-pi-studio/client` (`DaemonClient`), tested against a scripted
fake transport (the daemon-side feature handlers are wired in their own sprints, not by the CLI).

## Build & test results
```
$ npx tsc -b packages/cli                                   → exit 0
$ npm run build                                             → exit 0 (all packages)
$ npx vitest run packages/cli/src/cli-core.test.ts \
                 packages/cli/src/program.test.ts           → 19 passed (2 files)
$ npx vitest run            (full suite)                    → 376 passed (57 files)
$ npx oxlint packages/cli/src                               → clean
$ npx oxfmt packages/cli/src                                → clean
```

## Acceptance criteria
- [x] The CLI connects to a daemon and completes the hello handshake with a stable `clientId`
      (verified: `withDaemon` test asserts the hello frame carries `clientId`/`clientType:"cli"`;
      `resolveClientId` persistence test).
- [x] `--host <host:port>` targets a remote daemon over the same protocol (verified: `parseHost` /
      `hostToUrl` tests; `buildDaemonClient` builds the ws URL).
- [x] RPC failures surface `rpc_error` and exit nonzero (verified: rpc_error test → `EXIT_ERROR` +
      message includes code).
- [x] Output renders as table or json per flag (verified: `renderTable`/`renderJson` tests + `runRpc`
      json/table dispatch tests; `formatOf` honors `--json`).

## Follow-ups / TODO(verify)
- Exact per-command table columns and flags are deferred to tasks 002–004 (TODO(verify) in cli.md).
- The daemon `bootstrap.ts` does not yet register feature RPC handlers (deferred to an integration
  step); CLI command tests run against a scripted fake daemon transport, consistent with the
  client-package test strategy.
- Relay/pairing connection options (`daemon pair`) are scoped to task 003 / sprint-018.
