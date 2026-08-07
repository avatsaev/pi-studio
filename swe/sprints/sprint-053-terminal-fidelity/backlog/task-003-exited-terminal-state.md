# Task 003 — Surface an exited PTY instead of leaving a zombie tab

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** backlog
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** none

## Goal
Make a terminal whose PTY has exited say so: an "exited" state on the tab and panel, input disabled,
and no misleading live-looking cursor.

## Background / why
`feature-panels-ui.md` § Terminal pane → Streaming requires it — "exit sets 'Terminal exited'" — and
§ Error Handling lists `PTY exits → Notify subscribers; terminal closed`. Today, typing `exit` in a
terminal leaves a tab that looks completely alive: a blinking cursor, an input box that swallows
keystrokes into nothing, and no indication the shell is gone. Closing the tab then fires
`kill_terminal_request` for a slot that no longer exists.

Two facts make this a real gap rather than a missing nicety:

1. **There is no close opcode.** `terminal-manager.ts:278-294` (`onExit`) flushes pending output, marks
   `entry.closed = true`, disposes the screen model, deletes the map entry, and **clears subscribers** —
   its own comment says "Notify subscribers the terminal closed (empty Output then drop) … no dedicated
   close opcode exists in the binary protocol". So the binary stream simply stops; nothing on it says why.
2. **The only signal is a broadcast nothing listens to.** `terminal-rpc.ts:56,64,109,136` broadcasts
   `terminals_update` with the full list on create/rename/kill — but a grep for `terminals_update` in
   `packages/web-client/src` returns zero hits. The web client's only terminal-inventory read is
   `list_terminals_request`, once per connection, in `use-terminal-restore.ts`. The sidebar Terminals tab
   that might once have consumed it was removed (`features/files/RightSidebar.tsx:3-6`).

Note the ordering hazard in `onExit`: the map entry is deleted *before* subscribers are cleared, and an
exit triggered by `kill()` runs `onExit` synchronously from the RPC handler — so the `terminals_update`
broadcast that follows `manager.kill(slot)` already reflects the removal. A PTY that exits on its own
(the `exit` command, a crash) emits **no** broadcast at all, because `onExit` is not called from an RPC
handler in that path. Whatever mechanism this task chooses must cover the self-exit case, which is the
common one.

## Scope references
- `swe/features/feature-panels-ui.md` § Terminal pane → Streaming ("exit sets 'Terminal
  exited'"), § States, § Error Handling & Edge Cases (`PTY exits`)
- `swe/features/terminals.md` § Behavior (`kill(slot)`: "terminate PTY; notify
  subscribers"), § Error Handling & Edge Cases
- `packages/server/src/terminal/terminal-manager.ts:236-294` (`kill`, `onExit`)
- `packages/server/src/terminal/terminal-rpc.ts` (the `terminals_update` broadcasts)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (status surface from
  sprint-052/task-001)
- `packages/web-client/src/stores/tab-store.ts` (`TerminalTabData`, tab label rendering)
- `packages/web-client/src/features/workspace/TabStrip.tsx` (tab label/icon)

## What to build
Choose the **narrowest** mechanism that covers a self-exit, and state the choice in the summary:

- Ensure the daemon emits `terminals_update` when a PTY exits on its own, not only when an RPC killed
  it — `onExit` currently has no way to broadcast. Give `TerminalManager` an exit notification seam
  (callback/event) that `registerTerminalHandlers` wires to the same broadcast it already sends for
  create/rename/kill, so all four paths produce one consistent signal. Do **not** invent a new binary
  opcode: the protocol is append-only and a JSON broadcast already exists for this inventory.
- Web client: listen for `terminals_update` and reconcile open terminal tabs against it. The daemon
  broadcasts it to **every** active session unconditionally, so no subscribe RPC call is needed —
  just a message listener, following the established push-family convention
  (`checkout_status_update` / `file_changed`: local TypeScript interface + type guard at the point
  of use, no protocol-package schema; root `AGENTS.md` § Protocol overview). Reconcile only tabs
  whose `data.slot` is non-null — the create broadcast lands **before** `create_terminal_response`
  resolves (`terminal-rpc.ts:56-57`), so this client's own freshly created tab has no slot yet when
  the broadcast naming its slot arrives. A reconciled tab whose slot is absent from the update (or
  `closed: true`) enters an exited state:
  - the panel shows "Terminal exited" per the spec, over the last rendered screen (do not clear it —
    the final output is what the user wants to read);
  - input is disabled: `onData` sends nothing;
  - the tab remains open and closable — an exited terminal is not auto-closed, since its output is
    still the reason the user is looking at it.
- Closing an exited tab must not send `kill_terminal_request` for a slot the daemon no longer has (or
  must tolerate the `ok: false` it gets back without surfacing an error).
- `use-terminal-restore.ts` already skips `entry.closed` entries on connect (`:83`); keep that.

## Out of scope
- Any new binary opcode or protocol schema change.
- Auto-closing exited tabs, or a "restart terminal" affordance.
- Reintroducing a sidebar Terminals list (deliberately removed).
- Exit codes / exit reason in the UI — `onExit` does not currently carry one; note it as a follow-up
  rather than plumbing a new field.

## Acceptance criteria
- [ ] Typing `exit` in a terminal marks the tab and panel exited within a second, with "Terminal
      exited" shown and the last screen still readable.
- [ ] Keystrokes into an exited terminal send nothing (verified: no binary frames in devtools).
- [ ] `pi-studio terminal kill <slot>` from the CLI produces the same state in an open browser tab.
- [ ] Closing an exited tab produces no user-visible error and no exception.
- [ ] A terminal that is still alive is never marked exited — including immediately after another
      terminal exits, and across a reconnect (the reconnect's `list_terminals_request` must not
      transiently mark live terminals exited before the first `terminals_update` arrives).
- [ ] Creating and killing terminals still broadcasts exactly one `terminals_update` per operation; no
      duplicate broadcast is introduced for the RPC-kill path (which already sends one).
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: extend `packages/server/src/terminal/terminal-manager.test.ts` — a self-exiting PTY (the fake
  backend's exit emitter) fires the new exit notification exactly once, and `kill()` does not fire it
  twice. Extend `terminal-rpcs.test.ts` to assert a broadcast reaches sessions on self-exit.
  Run `npx vitest run packages/server/src/terminal`.
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`:
  1. Open two terminals. `exit` in one → only that one is marked exited; the other keeps working.
  2. `pi-studio terminal kill <slot>` for the survivor → it too is marked exited.
  3. Type into an exited terminal → nothing sent, no errors.
  4. Close both tabs → no errors; `pi-studio terminal ls` is empty.
  5. Open a terminal, drop and restore connectivity → it is **not** marked exited at any point.

## Notes
`onExit` deletes the map entry before clearing subscribers, and `kill()` calls `onExit` synchronously,
so the existing post-`kill` broadcast already sees the removal — verify the new seam does not produce a
second, duplicate broadcast on that path.
