# Task 006 — Outdated-daemon notice — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** done. Builds, lint and tests pass. The notice has not been seen in the desktop webview; that check is task-007.

## What was implemented
- **`outdated-daemon.ts`** (pure):
  - `parseVersion` reads `major.minor.patch`, with an optional `v` prefix and `-pre`/`+build` suffix that is ignored. Anything else returns `null`.
  - `outdatedDaemonNotice(min, reported)` compares numerically per part, so `0.0.9` is older than `0.0.119`.
  - An absent or unparsable daemon version gives the text "This daemon did not report a version; …". An older version gives "This daemon is X; this app expects Y or newer. Update it with `npm i -g @av-pi-studio/cli`, then restart the daemon."
  - A daemon at or above the minimum, or a missing or unparsable minimum, gives `null`.
- **`use-outdated-daemon-notice.ts`**: a connection counts as established while `status === "open"` and `serverInfo` is set.
  - `noticeOnEstablish(tracker, min, status, serverInfo)` fires only on the rise into that state.
  - `watchOutdatedDaemon(tracker, min | undefined, show)` checks the current state, then every store change, and returns the unsubscribe. With no minimum it subscribes to nothing.
  - `useOutdatedDaemonNotice()` reads `getHost().app.minDaemonVersion`. It keeps the tracker in a `useRef`, so a development remount of the effect does not count the same connection twice. The toast is `useToastStore.show(text, { durationMs: 12000 })`.
  - **Why `serverInfo` is required:** `DaemonClient` sets `open` before the store receives `server_info`, so `open` alone would read no version.
  - **Switching daemons:** `connect()` calls `disconnect()` first, which clears `serverInfo`, so a stale version from the previous daemon is never read.
- **`WorkspaceShell.tsx`**: calls `useOutdatedDaemonNotice()`.

## Files
| File | Change |
|---|---|
| `packages/workbench/src/features/connection/outdated-daemon.ts` | new |
| `packages/workbench/src/features/connection/outdated-daemon.test.ts` | new, 8 tests |
| `packages/workbench/src/features/connection/use-outdated-daemon-notice.ts` | new |
| `packages/workbench/src/features/connection/use-outdated-daemon-notice.test.ts` | new, 11 tests, uses the real connection store |
| `packages/workbench/src/shell/WorkspaceShell.tsx` | mounts the hook |

## Build & test results
- `npx vitest run packages/workbench/src/features/connection`: 4 files, 57 tests pass.
- `npm run build:workbench`: passes, `check-dist: ok`.
- `npm run build:web-client`: passes. Its chunk-size warning (over 500 kB) is Vite's, not from this change.
- `npx oxfmt` on the changed files: formatted.
- `npx oxlint` on the touched files: no output, so no warnings.

## Acceptance criteria
- [x] Minimum `0.0.119`: `0.0.118` and `0.0.9` give a notice; `0.0.119`, `0.0.120`, `0.1.0` and `1.0.0` give none (`outdated-daemon.test.ts`).
- [x] An absent or unparsable daemon version gives the "did not report a version" notice (`outdated-daemon.test.ts`, plus a watch test).
- [x] With a fake connection (the real store driven by `setState`): one connection gives one notice, a reconnect gives one more, unrelated store changes give none. A development-remount test shows the same tracker does not double-count.
- [x] Without `minDaemonVersion`, nothing is subscribed and no notice is added (test "adds nothing without a minimum").
- [x] The workbench and web-client builds and the workbench tests pass.

## Follow-ups / TODO(verify)
- **Reconnect version is stale:** the store sets `serverInfo` only on the initial `connect()`; `ReconnectionManager` re-handshakes but the version is not refreshed. After a reconnect the check therefore uses the version from the first handshake. If the daemon was upgraded in between, the reconnect toast could be spurious. Fixing it needs a change in `lib/connection/connection-store.ts` or the client, which was outside this task's files.
- **Seeing it in the webview (task-007):** the host must set `app.minDaemonVersion` (sprint-109/task-002) and connect to an older daemon.

## Proposed doc edits
- **`packages/workbench/AGENTS.md`**, source-layout tree under `features/connection/`, add:
  - `outdated-daemon.ts` — pure: `parseVersion`, `outdatedDaemonNotice(min, reported)`; numeric semver compare, an unparsable version counts as absent, no usable minimum gives no notice. (+ `.test.ts`)
  - `use-outdated-daemon-notice.ts` — `useOutdatedDaemonNotice()` mounted in `WorkspaceShell`; one toast per established connection (`open` + `serverInfo`), again after a reconnect; does nothing without `app.minDaemonVersion`. Pure core: `noticeOnEstablish`, `watchOutdatedDaemon`. (+ `.test.ts`)
- **`packages/workbench/AGENTS.md`**, invariants, add: "The outdated-daemon notice is informational only; it never blocks a connection or hides features by version (those stay gated by `server_info.features`). The reconnect check uses `serverInfo` from the first handshake."
- **`docs/desktop-client-handoff.md`**: sprint-110/task-006 done; `app.minDaemonVersion` is now consumed by the workbench shell.

## Wave gate (orchestrator)
```
Wave gate (t004+t006): npx vitest run packages/workbench 132 files / 1687 tests passed; build:workbench OK; build:web-client OK; oxlint clean on features/daemons and the new connection files. AGENTS layout updated by the orchestrator.
```
