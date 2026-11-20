# Task 001 — Connection boot through the registry — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- **Boot.** `bootConnection(host, deps)` in `hooks/use-connection.ts` is a pure decision, and `useConnectionBoot` calls it.
  - With `host.daemons`, it runs `useDaemonsStore.connectCurrent()` once. That calls `resolveCurrent()` and connects with the intent's URL and password.
  - The password is not written to the UI store's host/password/cwd fields. A pairing link gets no password.
  - If `resolveCurrent()` rejects, nothing is dialed. The store records the code and sets `open: true`.
  - Without `host.daemons`, it calls `applyConnectIntent(launch.initialConnect(), …)` as before. `applyConnectIntent` is unchanged.
- **`features/daemons/`** (new):
  - `connect-current.ts` is the pure `connectCurrent(daemons, deps)` that boot, Retry and "Reconnect now" share.
  - `daemons-store.ts` is the in-memory `useDaemonsStore`. It holds `open`, `error` and `invalidLinks` (relay entry ids), and has `openScreen`, `closeScreen`, `setError`, `markLinkInvalid`, `clearLinkInvalid` and `connectCurrent`. `resetDaemonsStoreForTests` resets it.
  - `use-daemons.ts` is `useDaemons(): DaemonsSnapshot | null`. It re-reads the snapshot on `subscribe` and returns `null` when the host has no registry.
  - `daemon-presentation.ts` holds the shared labels and rules:
    - `localStateView(state)` gives `{label, tone, actions}` for every local state. Actions are Start, Stop, Restart and Retry; each carries the `local.*` member to call. Retry maps to `refresh` for `cli_missing`/`cli_outdated` and to `start` for `failed`.
    - `daemonErrorView(code)` gives `{message, detail?, command?, isError}`. It uses `INSTALL_CLI_COMMAND = "npm i -g @av-pi-studio/cli"` (detail mentions Node), `UPDATE_CLI_COMMAND = "npm i -g @av-pi-studio/cli@latest"`, and the macOS/Linux/WSL text for `unsupported`.
    - `DAEMON_ERROR_CODES`, `daemonFailureOf` and `isDaemonErrorCode` support the above.
    - The error table is `Record<DaemonFailure, …>`, so adding a code to `DaemonErrorCode` without a message breaks the build.
- **Connection store.** `errorReason: RelayConnectReason | null` sits beside `error`, set by the new `lib/connection/connect-failure.ts#connectFailure`. It is set when the failure is a `RelayConnectError`, at all four failure sites (including the transport factory throwing). It is cleared on connect start and on reconnect. Messages are unchanged.

## Files
| File | Change |
|---|---|
| `features/daemons/daemon-presentation.ts` + `.test.ts` | new |
| `features/daemons/connect-current.ts` + `.test.ts` | new |
| `features/daemons/daemons-store.ts` + `.test.ts` | new |
| `features/daemons/use-daemons.ts` | new |
| `lib/connection/connect-failure.ts` + `.test.ts` | new |
| `lib/connection/connection-store.test.ts` | new |
| `lib/connection/connection-store.ts` | changed (`errorReason`) |
| `hooks/use-connection.ts` | changed (`bootConnection`, registry branch) |
| `hooks/use-connection.test.ts` | new |

All paths are under `packages/workbench/src/`. `WorkbenchBoot.tsx` needed no change.

## Build & test results
- `npx vitest run` over `hooks`, `lib/connection`, `features/daemons`, `host` and `test`: 32 files, 230 tests passed. The existing `host/launch.test.ts` and `host/connection.test.ts` pass unchanged.
- `npm run build:workbench`: ok, including `check-dist`.
- `npm run build:web-client`: ok. The only output flagged is the existing chunk-size notice.
- `npx tsc -p packages/workbench/tsconfig.json --noEmit`: no errors.
- `npx oxfmt` and `npx oxlint` on the changed files: clean.

## Acceptance criteria
- [x] Direct entry connects once with its password, and the UI store password stays empty. This is checked in `daemons-store.test.ts` by reading the `createTransport` args, and in `use-connection.test.ts` by asserting the fields are untouched.
- [x] `cli_missing` rejection: no `createTransport` call, no dial, `error === "cli_missing"`, `open === true`. Checked in `daemons-store.test.ts`.
- [x] Without `daemons`, the existing boot tests pass unchanged, and `use-connection.test.ts` checks the launch-intent path.
- [x] Every local state and every error code has a label. This is checked in `daemon-presentation.test.ts` by iterating the states and `DAEMON_ERROR_CODES`, and by the typed `Record` at build time. The test also pins the code list.
- [x] A `RelayConnectError("wrong_key")` leaves `errorReason === "wrong_key"`. Another error leaves it `null`. Checked in `connection-store.test.ts`.
- [x] `build:workbench`, `build:web-client` and the workbench tests pass.

## Follow-ups / TODO(verify)
- Choices where the task was silent:
  - `no_current` is shown as a plain state, not an error, like `local_stopped`.
  - A rejection that is not a `DaemonError` maps to `"unexpected"` (the extra `DaemonFailure` type).
  - A successful `resolveCurrent` clears the held error but does not close the screen; task-003 decides that.
- The `DaemonsSnapshot` type is `ReturnType<HostDaemons["snapshot"]>`. A named type would belong in `host/types.ts`, which was outside this task's files.
- `useDaemons` is a `useState`/`useEffect` hook with no DOM test here, in line with the package's no-jsdom rule.

## Proposed doc edits for the orchestrator
**`packages/workbench/AGENTS.md`**, source layout, under `features/`:
```
daemons/   daemon-presentation.ts (pure: localStateView — label/tone/actions per LocalDaemonState; daemonErrorView — message/detail/command/isError per DaemonErrorCode, DAEMON_ERROR_CODES, INSTALL_CLI_COMMAND/UPDATE_CLI_COMMAND), connect-current.ts (pure connectCurrent(daemons, deps): resolveCurrent → connect, or rejected(code)), daemons-store.ts (useDaemonsStore: open, error, invalidLinks, connectCurrent — in memory only), use-daemons.ts (useDaemons(): snapshot kept fresh through subscribe, null without host.daemons)
```
`lib/connection/` line: add `connect-failure.ts (connectFailure(error) → {error, errorReason})`. The connection store gains `errorReason: RelayConnectReason | null`, set when a failure is a `RelayConnectError`.

**Invariants:**
> **Boot through the registry (sprint-110).** With `host.daemons`, `useConnectionBoot` → `bootConnection` calls `useDaemonsStore.connectCurrent()`: `resolveCurrent()` once, then `connect(intent.url, password)`. The secret never reaches `ui-store` host/password fields. A rejection dials nothing and records its code in `useDaemonsStore.error` with `open: true`. Retry and "Reconnect now" call the same action. Without `host.daemons`, `applyConnectIntent(launch.initialConnect())` is unchanged.

**`README.md`:** no change.

## Wave gate (orchestrator)
```
npx vitest run packages/workbench: 126 files / 1561 tests passed; build:workbench OK. AGENTS layout entries added by the orchestrator.
```
