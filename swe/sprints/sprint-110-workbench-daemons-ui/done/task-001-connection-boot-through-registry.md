# Task 001 — Workbench: connection boot through the registry, and the shared daemons state

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (hooks, lib/connection, features/daemons)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-109/task-001

## Goal
When the host has a registry, the workbench asks it what to dial at boot and connects, or records why it could not. The state and wording the switcher and the Daemons screen share exist once, as tested pure modules.

## Context / why
Today boot reads `launch.initialConnect()` and fills the connection bar's fields. With a registry the address and secret come from `resolveCurrent()`, and a failure is not an error to throw but a reason to show the Daemons screen (D18).

## Scope references
- `swe/features/desktop-daemon-registry.md` § Launch (the workbench part), § Public contract 3, § Public contract 4, § Error handling (first launch without CLI, auto-start off, D18 rows)
- `packages/workbench/src/hooks/use-connection.ts` (`useConnectionBoot`, `applyConnectIntent`), `src/shell/WorkbenchBoot.tsx`
- `packages/workbench/src/lib/connection/connection-store.ts` (`connect`, `disconnect`, `error: string | null`), `resolve-connect-target.ts`
- `packages/client/src/relay-transport.ts` (`RelayConnectError.reason`, `RelayConnectReason`)
- `packages/workbench/src/host/types.ts`, `src/test/` (the in-memory registry: sprint-109/task-001)

## What to build
- **Boot, when `host.daemons` exists:** call `resolveCurrent()` once.
  - resolved: connect with the intent's URL and password. The secret goes to the connection only: it is not written to the UI store's host and password fields, which the switcher no longer shows.
  - rejected: do not connect; record the `DaemonError` code and ask for the Daemons screen to open.
  - `host.daemons` absent: today's path, byte for byte.
- **A daemons UI store** (new, under `features/daemons/`): whether the Daemons screen is open, the boot or action error to show in it, the set of relay entries marked "pairing link no longer valid" (memory only), and "connect to the current entry" as one action that boot, Retry and "Reconnect now" share.
- **A hook over `host.daemons`** that re-renders on `subscribe` and returns the snapshot.
- **A presentation module** (pure, tested), used by every later task of this sprint:
  - the label of a local state ("Running on 127.0.0.1:6767", "Stopped", "Starting…", "The pi-studio CLI was not found", ...), and which of Start, Stop, Restart, Retry applies in each state;
  - the message for each `DaemonError` code, including the install command for `cli_missing` (`npm i -g @av-pi-studio/cli`, which needs Node), the update command for `cli_outdated`, and the explanation for `unsupported` (a local daemon needs macOS, Linux or WSL);
  - whether a code is shown as an error or as a plain state (`local_stopped` with auto-start off is not an error).
- **Connection store:** keep the failure's reason code beside its message when the error is a `RelayConnectError` (a new optional field; the message is unchanged).

## Out of scope
- Anything drawn: the switcher (task-002), the screen (task-003), the forms (task-004).
- Reacting to stop, removal and `wrong_key` (task-005).

## Acceptance criteria
- [ ] With the in-memory registry on a direct entry, boot connects once to its address with its password, and the UI store's password field stays empty.
- [ ] With `resolveCurrent` rejecting `cli_missing`, no connection is attempted, the store holds the code, and the screen is asked to open.
- [ ] With no `daemons` member, the existing boot tests pass unchanged.
- [ ] Every local state and every error code has a label; a test fails when a code is added to the type without one.
- [ ] A connection failing with a `RelayConnectError` of reason `wrong_key` leaves that reason readable in the connection store; another error leaves it empty.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/hooks packages/workbench/src/lib/connection packages/workbench/src/features/daemons`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`

## Notes
- **Found at planning time:** the connection store keeps only an error message. D23 needs the SDK's reason code, so the store gains it here.
- No DOM test environment in this package: the boot decision is a pure function over injected dependencies, as `applyConnectIntent` is today.
- The intent holds a secret: it is passed to `connect` and stored nowhere else, and never logged.
