# Task 002 — Connection bar becomes a daemon switcher — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** done. Build and unit tests pass. The switcher has not been looked at in a browser or the desktop webview; that is task-007.

## What was implemented
With `host.daemons`, the status pill becomes a button. It shows the current entry's name and status, and opens a list of entries followed by "Manage daemons…". Without `host.daemons`, the bar's markup and logic are the old fields-and-pill branch, moved into a ternary.

- **Status:** shows what `connectionBarView` shows today. For the local entry while its daemon is not running, it shows the local state's label instead ("Starting…", "Stopped", and so on).
- **No current entry:** the control reads "No daemon selected". An unknown `currentId` is treated the same way.
- **The list:** every entry in registry order, the current one marked with a check, each with a "Local", "Direct" or "Relay" label. "Manage daemons…" is last. It is built on `MenuContent`/`MenuItem` (Radix), so the trigger and list are keyboard operable.
- **Choosing an entry:**
  - The current entry while connected does nothing.
  - The current entry while not connected calls `useDaemonsStore.getState().connectCurrent()`.
  - Any other entry calls `host.daemons.switchTo(id)`; a rejection becomes an error toast.
- **"Manage daemons…":** calls `useDaemonsStore.getState().openScreen()`.
- **Action button:** the Connect button is gone, and the Disconnect/Retry button follows the rules below. Retry calls `connectCurrent()`, so it asks the registry again.
  - Connected or closing → Disconnect (disabled while closing).
  - Connecting → a disabled "Connecting…".
  - Local daemon not running: Retry only when the state is an error that has an action (failed, CLI missing or outdated), otherwise no button.
  - Otherwise, Retry when the connection holds an error, otherwise no button.
- **After Disconnect:** with no Connect button, re-picking the current entry in the list reconnects.
- **Layout:** the name is the only part that ellipsises (`.switcherName`) and the pill keeps its 340px cap, so a 64-character name cannot widen the bar. The status word stays readable. The button resets its appearance, margin, font and cursor explicitly.
- **Settings gear and panel toggles:** untouched.

## Files created / changed
| File | Change |
|---|---|
| `packages/workbench/src/features/connection/daemon-switcher-presentation.ts` | New. Pure `daemonSwitcherView`, `daemonChoice`, `switchFailureMessage`, label constants. |
| `packages/workbench/src/features/connection/daemon-switcher-presentation.test.ts` | New. 20 tests. |
| `packages/workbench/src/features/connection/DaemonSwitcher.tsx` | New. The trigger and menu. |
| `packages/workbench/src/features/connection/ConnectionBar.tsx` | Calls `useDaemons()`, branches pill vs switcher, hides the fields, makes the action button optional, updates the header doc. |
| `packages/workbench/src/features/connection/ConnectionBar.module.css` | Adds the `switcher*` classes. |

## Build & test results
- `npx vitest run packages/workbench/src/features/connection packages/workbench/src/features/daemons`: 5 files, 65 tests pass.
- `npm run build:workbench`: passes (including `check-dist`).
- `npm run build:web-client`: passes, with a chunk-size warning that was already there.
- `npx oxfmt` and `npx oxlint` on the changed files: clean.
- `npm run lint` (whole workspace) was not run; the task's verification plan lists it, but only the changed files were linted.

## Acceptance criteria
- [x] Direct B current and connected → name "Bravo", status "connected", Disconnect action. Local current with state `starting` → "Starting…". Verified by unit tests.
- [x] The list has every entry in order, only the current one marked, and "Manage daemons…" last. The list is tested in the view model; the last row is rendered by `DaemonSwitcher.tsx`.
- [x] Choosing the current entry while connected → `nothing`; with an error, or in any other non-connected status → `reconnect`; another entry → `switch` with its id. Unit tests.
- [x] Without `daemons`, the existing `connection-presentation` tests pass unchanged (18). The old markup is the untouched ternary branch. [INFERENCE] that the DOM is identical: no DOM test env, not checked in a browser.
- [x] A 64-character name does not widen the bar: the view model keeps it whole and CSS ellipsises it (`.switcherName`, pill `max-width`). Visual check pending in task-007.
- [x] `build:workbench`, `build:web-client` and the workbench tests pass.

## Follow-ups / TODO(verify)
- In the desktop webview (task-007):
  - the ellipsis on a long name;
  - keyboard open and navigation of the list;
  - the toast when `switchTo` rejects;
  - the web client's bar looks and behaves as before.
- Choosing the current entry while `connecting` or `closing` reconnects, following "while not connected". `connect()` disconnects first, so this restarts the attempt.
- With the current entry's error styling, hovering the pill replaces the red border with the muted one (`button.switcher:hover`). Cosmetic.

## Proposed doc edits for the orchestrator
**`packages/workbench/AGENTS.md`, source layout under `features/connection/`:**
- `daemon-switcher-presentation.ts` — pure view model of the daemon switcher: `daemonSwitcherView` (current name and status, the entry list, the Disconnect/Retry action), `daemonChoice` (nothing / reconnect / switch), `switchFailureMessage` (toast text for a rejected `switchTo`).
- `DaemonSwitcher.tsx` — the pill as a menu trigger, used instead of the url/password fields when `host.daemons` exists.

**Same file, conventions:** "With `host.daemons`, `ConnectionBar` draws `DaemonSwitcher` instead of the address field, password field and Connect button. Disconnect, Retry and the gear stay. Retry and re-picking the current entry call `useDaemonsStore.connectCurrent()`; picking another entry calls `host.daemons.switchTo` (the page reloads); "Manage daemons…" calls `useDaemonsStore.openScreen()`. Without `host.daemons` the bar is unchanged."

**`packages/workbench/README.md`:** no change, nothing public changed.

**`docs/desktop-client-handoff.md`:** one line, "sprint-110/task-002: connection bar switcher done (`features/connection/`)".

## Wave gate (orchestrator)
```
Wave gate (t002+t003 together): npx vitest run packages/workbench 129 files / 1625 tests passed; build:workbench OK; build:web-client OK; oxlint: no warnings in features/daemons or features/connection. AGENTS layout updated by the orchestrator.
```
