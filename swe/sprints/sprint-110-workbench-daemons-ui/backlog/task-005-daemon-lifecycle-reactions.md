# Task 005 — Workbench: reacting to stop, removal, a dead pairing link and the native menu

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (features/daemons, lib/connection)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-004

## Goal
The window does the right thing when the daemon it is connected to is stopped or its entry removed, when a relay link stops working, when the local daemon dies, and when the native menu asks for the Daemons screen.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Local daemon state (last paragraph: stop is confirmed, then disconnect without retrying; restart keeps the connection), § Adding, editing, removing (Remove; relay link no longer valid), § Error handling (removing the current entry; the local daemon dies while connected), § Public contract 3 (`onManageRequest`)
- `swe/grills/desktop-native-shell.md` D18, D22, D23
- `packages/workbench/src/features/daemons/` (store, screen, forms: task-001, 003, 004), `src/features/connection/` (switcher: task-002)
- `packages/workbench/src/lib/connection/connection-store.ts` (`disconnect`, the reconnection manager, the reason code added in task-001)
- `packages/client/src/relay-transport.ts` (`RelayConnectReason`: `wrong_key`, `daemon_offline`)

## What to build
A small controller (pure decision function plus one hook that applies it), driven by the registry's snapshot and the connection's state:

| When | Then |
|---|---|
| Stop is pressed in the Daemons screen while the current entry is the local one and the connection is up | `host.dialogs.confirm` first ("Agents running on this daemon will stop."); "no" does nothing |
| The local state becomes `stopping` while the current entry is the local one (whoever asked: the screen, the native menu, the control socket) | Disconnect without retrying and open the Daemons screen |
| Restart | Nothing: the connection is kept and the existing reconnect covers the gap |
| The current entry is removed (`currentId` becomes null) | Disconnect without retrying and open the Daemons screen |
| A connection to a relay entry fails with reason `wrong_key` | Mark that entry "pairing link no longer valid" (memory only); the switcher and its row show the marker; the row offers "Replace link" |
| It fails with `daemon_offline` | The SDK's own message, unchanged: it already names both causes |
| A marked entry gets a new link, or connects | The marker is cleared |
| The connection drops while the current entry is the local one | Call `local.refresh()` once per drop. The existing reconnect runs; the workbench never starts the daemon by itself |
| The host fires a manage request | Open the Daemons screen |

- "Disconnect without retrying" is the manual disconnect the Disconnect button performs today.
- With `host.daemons` absent the controller is not mounted.

## Out of scope
- The native menu's own confirm (sprint-109/task-004).
- Restarting a daemon automatically, in any case.

## Acceptance criteria
- [ ] The decision function has one test per row of the table.
- [ ] With the in-memory registry and a fake connection: Stop with "yes" leads to one disconnect, no reconnect attempt, and the screen open; "no" leads to nothing.
- [ ] A `stopping` state while the current entry is a direct one changes nothing.
- [ ] Removing the current entry disconnects and opens the screen; removing another entry does neither.
- [ ] `wrong_key` marks only the entry that was being connected; `daemon_offline` marks nothing.
- [ ] Replacing the link clears the marker.
- [ ] A dropped connection on the local entry calls `local.refresh()` exactly once, and no `local.start()`.
- [ ] A manage request opens the screen.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons packages/workbench/src/lib/connection`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Each row is observed in the desktop webview in task-007.

## Notes
- **Found at planning time:** the spec puts the stop confirm on "stopping while the window is connected", but a stop can come from three places and the engine command cannot ask. The confirm is the caller's (this screen; the native menu), and the window reacts to the `stopping` state, so all three paths end the same way. sprint-111/task-003 records it.
- **Found at planning time:** the registry file has no field for "link no longer valid", so the marker lasts until the app restarts or the link is replaced.
