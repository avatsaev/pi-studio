# Task 005 — Client: advertise the capability, request the reflowable tier, apply `Restore`

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** backlog
- **Type:** feature
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Make the web client advertise `terminal_reflowable_snapshot`, request the reflowable restore tier when
subscribing, and apply the resulting `Restore` frame — so a reattach at a different width renders
correctly instead of approximately.

## Background / why
The client half of tier 2 is entirely absent, in three places:

1. **The capability is never advertised.** `packages/web-client/src/lib/connection/connection-store.ts:87-90`
   sends only `inline_image_markdown` and `file_link_markdown`. Without
   `CLIENT_CAPS.terminal_reflowable_snapshot`, `terminal-rpc.ts:74-76` resolves the mode to `"basic"`
   for every subscription regardless of what the daemon supports.
2. **No mode is requested.** `TerminalPanel.tsx:222` sends `subscribe_terminal_request { slot }` with no
   `restoreMode`, and ignores the `restoreMode` the response echoes.
3. **The handler is dead code.** `TerminalStreamRouter`'s `onRestore` (`terminal-stream-router.ts:79-81`)
   and `TerminalPanel`'s `onRestore` (`:219`) have existed since sprint-007 and have never received a
   frame, because no server path emitted one until task-004. `TerminalPanel`'s version also just
   `write`s the chunk with no reset, unlike its `onSnapshot` sibling.

## Scope references
- `clean-room-scope/features/terminals.md` § Restore / snapshot (tier 2; the reset-before-replay
  requirement applies to both tiers)
- `clean-room-scope/features/feature-panels-ui.md` § Reconnect/restore
- `clean-room-scope/architecture/websocket-protocol.md` § Binary frames, capability negotiation
- `packages/protocol/src/client-capabilities.ts` (`CLIENT_CAPS.terminal_reflowable_snapshot` — exists,
  no change)
- `packages/web-client/src/lib/connection/connection-store.ts:80-95` (the `hello` capabilities map)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (`subscribe_terminal_request`,
  `onSnapshot`/`onRestore`)
- `packages/client/src/terminal-stream-router.ts` (`onRestore` dispatch — verify, likely no change)

## What to build
- Add `[CLIENT_CAPS.terminal_reflowable_snapshot]: true` to the web client's `hello` capabilities. Note
  this is a **connection-wide** claim: after it, every terminal subscription from this client is served
  tier 2 by a daemon that supports it, so the `Restore` path must be correct before the flag ships (this
  task does both together, deliberately).
- Send `restoreMode: "reflowable"` on `subscribe_terminal_request` (the exact literal task-004
  fixes; do not invent a variant), and read the echoed `restoreMode` from the response. The echoed
  value is the source of truth for which frame to expect; do not assume the request was honoured.
- Apply `Restore` through the same reset-then-write helper `onSnapshot` uses (sprint-052/task-005
  introduced it as one shared local helper precisely so the two cannot diverge).
- Reconnect path: sprint-052/task-001 split subscription from the emulator mount, so a reconnect
  re-subscribes and will now receive a `Restore` — the emulator must be reset before the replay, not
  appended to, or the restored screen lands under the pre-reconnect content.
- An older daemon (no `terminal-restore-modes`) must be unaffected: the response says `"basic"`, a
  `Snapshot` arrives, and the existing path handles it. Verify against that combination, do not just
  reason about it.

## Out of scope
- The CLI advertising the capability (it renders no live terminal; `pi-studio terminal capture` uses the
  text `capture` RPC, not the binary stream).
- Any change to the basic tier.
- Client-side reflow of an already-attached terminal on resize (the PTY redraws itself).

## Acceptance criteria
- [ ] The web client's `hello` advertises `terminal_reflowable_snapshot`, and a subscription against the
      current daemon is served `restoreMode: "reflowable"`, with a `Restore` frame and no `Snapshot`.
- [ ] Reattach at a **different** width renders correctly: resize the window (or move the terminal into a
      much narrower/wider pane), reload, and the restored screen is laid out for the current width with
      no stale wrapping, no duplicated fragments, and no misplaced cursor.
- [ ] Colours and attributes survive the restore (a coloured `ls`/`git status` screen comes back coloured).
- [ ] The emulator is reset before either replay; no pre-existing content remains beneath the restored
      screen after a reconnect.
- [ ] Against a daemon with restore modes disabled, the client falls back to `Snapshot` with no error and
      no behaviour change.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: extend `packages/client/src/terminal-router.test.ts` if the dispatch changes at all (it likely
  does not — assert `Restore` reaches `onRestore` as a regression guard, since nothing has ever exercised
  that branch end to end).
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`, devtools WS frames visible:
  1. Open a terminal, run a colourful command with plenty of output, resize the window substantially,
     reload → `Restore` frame received (opcode `0x05`), screen restored at the new width, colours intact.
  2. Same but with a pane split so the terminal is much narrower than when the output was produced.
  3. Drop and restore connectivity mid-session → one `Restore`, screen replaced not appended.
  4. Temporarily set `restoreModesEnabled: false` in `bootstrap.ts` (revert after) → `Snapshot` path
     still works with no console errors.

## Notes
Capability advertisement is connection-wide and rehydrated on reconnect by `ReconnectionManager`
(`packages/client/AGENTS.md` § Invariants), so no per-reconnect re-advertisement work is needed — but it
does mean a regression in the `Restore` path degrades every terminal on the connection at once, which is
why this task's acceptance criteria include the disabled-daemon fallback rather than treating it as
theoretical.
