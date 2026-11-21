# Task 005 — Daemon lifecycle reactions — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** Done. Observed in the real desktop webview only in task-007; no browser checks were run here.

## What was implemented
- **Decision function.** `lifecycleReactions(prev, next)` is a pure function over `LifecycleFacts`. It returns `leave`, `markLinkInvalid`, `clearLinkInvalid` and `refreshLocal` reactions, one case per table row. `watchDaemonLifecycle(daemons, effects)` reads the facts from the registry and the connection store, applies the reactions through injected effects, opens the screen on `onManageRequest`, and returns an unsubscribe.
- **`leave`.** It calls the store's manual `disconnect()` (no reconnection) and opens the Daemons screen. It fires when the local state rises into `stopping` while the current entry is local, or when `currentId` goes non-null to null.
- **Restart and direct entries.** A restart changes nothing. `stopping` on a direct entry changes nothing.
- **`wrong_key`.** It marks the current entry only if that entry is a relay one, on the transition into `wrong_key`. `daemon_offline` marks nothing.
- **Marker cleared on connect.** The marker is cleared when the current entry connects (`open` after not-`open`).
- **Marker cleared on a new link.** `DaemonForm` clears it after a saved edit that typed a new link, using the new pure `linkReplaced(entry, fields)`.
- **Dropped local connection.** `open` followed by `closed` on the local entry calls `local.refresh()` once per drop. Retry loops and a manual disconnect (`open`, `closing`, `closed`) do not, and the workbench never calls `local.start()`.
- **Hook.** `useDaemonLifecycle()` is mounted in `WorkspaceShell`. It does nothing when `host.daemons` is absent.
- **Stop confirm.** In the Daemons screen, `stopNeedsConfirm(call, onCurrentEntry, status)` is true for Stop on the current entry while the connection is `open`. `runLocalActionAsking` then calls `host.dialogs.confirm("Agents running on this daemon will stop.")`; "no" does nothing.
- **Screen display.** `EntryRowView.linkInvalid` shows a red "Pairing link no longer valid" line on the row, plus a "Replace link" button that opens the edit form. It sits after Open and before Edit. `buildDaemonsScreenView` takes a third parameter `invalidLinks` that defaults to none.
- **Switcher display.** `DaemonSwitcherItem.linkInvalid` adds a red tag in the menu. For the current marked relay entry the status label becomes "Pairing link no longer valid" and the kind is `error`, unless the status is `open` or `connecting`. `daemonSwitcherView` takes an optional `invalidLinks` input.

## Files
| File | Change |
|---|---|
| `features/daemons/daemon-lifecycle.ts` | New: decision function, `watchDaemonLifecycle`, `LifecycleEffects` |
| `features/daemons/use-daemon-lifecycle.ts` | New: hook plus the real store effects |
| `features/daemons/daemon-lifecycle.test.ts` | New: 10 decision tests, one per table row plus the negative cases, and 10 watcher tests with the in-memory registry |
| `features/daemons/daemons-screen-actions.ts` | `STOP_CONFIRM_MESSAGE`, `stopNeedsConfirm`, `runLocalActionAsking` |
| `features/daemons/daemons-screen-view.ts` | `linkInvalid`, the `replaceLink` action, `LINK_INVALID_LABEL`, `invalidLinks` parameter |
| `features/daemons/DaemonsScreen.tsx` and `DaemonsScreen.module.css` | Stop confirm, marker line, "Replace link" button |
| `features/daemons/DaemonForm.tsx` and `daemon-form.ts` | Clear the marker on a replaced link; add `linkReplaced` |
| `features/connection/daemon-switcher-presentation.ts`, `DaemonSwitcher.tsx` and `ConnectionBar.module.css` | Marker in the switcher |
| `features/connection/ConnectionBar.tsx` | Passes `invalidLinks` to `daemonSwitcherView`. This file is outside the listed ones but was needed to bind the marker. |
| `shell/WorkspaceShell.tsx` | Mounts `useDaemonLifecycle()` |
| Tests extended | `daemons-screen-actions`, `daemons-screen-view`, `daemon-form`, `daemon-switcher-presentation` |

`lib/connection` is unchanged: the existing `disconnect()` is the manual disconnect, and the `open` to `closed` transition tells a drop from a manual close.

## Build & test
- `npx vitest run packages/workbench/src/features packages/workbench/src/lib/connection`: 72 files, 1038 tests pass.
- `npm run build:workbench` and `npm run build:web-client` pass.
- `oxlint` on the changed folders shows no warnings from this work. The one warning I introduced was fixed.
- I ran `npx oxfmt` on all dirty workbench files in the first pass, so it may have reformatted files other agents are editing. It did not touch Markdown.

## Acceptance criteria
- [x] One test per table row in `lifecycleReactions`.
- [x] Stop with "yes" gives one `leave`: store idle, `reconnection` null, screen opened, no refresh. "No" does nothing (watcher tests).
- [x] `stopping` on a direct entry does nothing.
- [x] Removing the current entry disconnects and opens the screen; removing another does neither.
- [x] `wrong_key` marks only the current relay entry; `daemon_offline` marks nothing.
- [x] Replacing the link clears the marker (`linkReplaced`, wired in `DaemonForm`) and so does a successful connect. Only the connect path is covered by a watcher test; the form path is covered by the `linkReplaced` unit test only.
- [x] A dropped local connection calls `refresh` exactly once per drop and never `start`.
- [x] A manage request opens the screen, and the listener is removed on unmount.
- [x] Both builds and the tests pass.

## Follow-ups
- `[INFERENCE]` The drop rule (`open` followed by `closed`) assumes the SDK emits `closing` first for a manual `close()` and goes straight to `closed` on a remote close, which matches the `DaemonClient` source. Check it live in task-007.
- A marker stays in memory for an entry that is later removed. It is harmless but not pruned.

## Proposed doc edits
- **`packages/workbench/AGENTS.md`, daemons layout:** add these lines.
  - `daemon-lifecycle.ts` — pure `lifecycleReactions(prev, next)` (leave on local stopping or current removed, mark/clear the "pairing link no longer valid" marker, refresh the local daemon on a dropped connection) and `watchDaemonLifecycle`, which applies it and opens the screen on `onManageRequest`. A restart changes nothing.
  - `use-daemon-lifecycle.ts` — mounts it with the store effects; called once from `WorkspaceShell`.
- **`packages/workbench/AGENTS.md`, invariants:** "Stop on the current local entry while connected asks first (`stopNeedsConfirm`); the window reacts to the `stopping` state whoever asked. The marker is memory only, cleared on a successful connect or a saved new link. The workbench never starts a daemon by itself."
- **`packages/workbench/README.md`:** a short note that the Daemons screen and switcher show "Pairing link no longer valid" and offer "Replace link".
- **`swe/` task and sprint docs:** mark task-005 done.

## Wave gate (orchestrator)
```
npx vitest run packages/workbench 133 files / 1718 tests passed; build:workbench OK; build:web-client OK. AGENTS daemons layout updated by the orchestrator.
```
