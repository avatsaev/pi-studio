# Task 004 — Daemon: serve a reflowable `Restore` frame from the headless screen model

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** backlog
- **Type:** feature
- **Estimated size:** M
- **Depends on:** none

## Goal
Implement tier 2 of `terminals.md` § Restore / snapshot: when both sides support it, serve a
subscription with a `Restore` frame (opcode `0x05`) carrying a serialization of the server's screen
grid, instead of the raw byte ring — a redraw that is correct at any client width.

## Background / why
The basic tier replays the daemon's raw 64 KiB byte ring. Even with sprint-052/task-005's escape-safe
truncation, that replay reproduces the wrapping of whatever width the PTY had when the bytes were
written; replaying it at a different width is approximate by construction, and a reattach after a
window/pane resize renders visibly wrong.

The protocol has been carrying the machinery for the fix, unused, since sprint-002:

- `TerminalOpcode.Restore = 0x05` exists and encodes/decodes
  (`packages/protocol/src/binary-frames/terminal-stream-protocol.ts:21,80-81`), but **no server code
  path ever emits it** — `TerminalManager.subscribe` only sends `Snapshot`.
- `SERVER_FEATURES["terminal-restore-modes"]` is advertised (`bootstrap.ts:519` passes
  `restoreModesEnabled: true`) and `terminal-rpc.ts:71-82` already negotiates a `restoreMode`, echoing
  it in the response — but the value is then ignored, and every subscriber gets the same byte ring.
- `CLIENT_CAPS.terminal_reflowable_snapshot` exists and `session.supports(...)` is consulted; no client
  advertises it (task-005 does).

The screen model needed is already maintained: `ScreenBuffer` (`screen-buffer.ts`) feeds every output
byte into an `@xterm/headless` `Terminal` and exposes `snapshotText()` (plain viewport text, used by
`capture` for CLI/MCP). Plain text is not enough for a restore — it has no colours, no attributes, no
cursor position — so this task adds a grid **serialization** alongside it.

## Scope references
- `swe/features/terminals.md` § Restore / snapshot (tier 2), § Binary stream protocol
  (the `Restore` row)
- `swe/features/feature-panels-ui.md` § Reconnect/restore, § TODO(verify) ("Terminal
  snapshot serialization format" — this task fixes it)
- `swe/architecture/websocket-protocol.md` § Binary frames
- `packages/server/src/terminal/screen-buffer.ts` (the `@xterm/headless` grid; note the
  `createRequire` loading workaround and why it exists)
- `packages/server/src/terminal/terminal-manager.ts:184-198` (`subscribe`)
- `packages/server/src/terminal/terminal-rpc.ts:68-86` (`subscribe_terminal_request`, the existing
  `restoreMode` negotiation)
- `packages/server/package.json` (`@xterm/headless` is already a dependency)
- `packages/protocol/src/binary-frames/terminal-stream-protocol.ts` (no change expected — verify)

## What to build
- **Serialization** on `ScreenBuffer`: a method returning a byte/string payload that redraws the
  current screen with attributes and cursor position — e.g. `serialize(): string`. The natural
  mechanism is `@xterm/addon-serialize` loaded into the headless terminal (same `createRequire` route
  `screen-buffer.ts` already uses for `@xterm/headless`; add the dependency to
  `packages/server/package.json`). Bound the scrollback included, per `feature-panels-ui.md`
  § Reconnect/restore ("a visible-snapshot restore (bounded scrollback)") — the viewport plus a small
  bounded history, not the whole 1000-line buffer.
  If `@xterm/addon-serialize` proves unusable headless, hand-rolling an SGR-emitting grid walk over
  `buffer.active` is acceptable — record the choice and its limits in the summary. **Do not** fall
  back to `snapshotText()`: losing colour and cursor state would be a visible regression against the
  byte-ring replay it replaces.
- **Manager**: `subscribe(slot, sink, opts?)` gains a restore mode. For `"basic"` it behaves exactly as
  today (`Snapshot` + raw ring). For the reflowable mode it emits one `Restore` frame carrying the
  serialization and no `Snapshot`. Exactly one of the two frames precedes live `Output` — never both,
  never neither.
- **RPC**: `subscribe_terminal_request` passes the already-negotiated `restoreMode` (`terminal-rpc.ts:75-76`)
  through to `manager.subscribe`, and keeps echoing it in the response so the client knows which tier it
  got. The negotiation gate itself is correct and stays: reflowable requires
  `restoreModesEnabled && session.supports("terminal_reflowable_snapshot")`, otherwise `"basic"`.
  The wire literal is **`"reflowable"`** — this task fixes it and task-005 sends the same string;
  `subscribe_terminal_response.restoreMode` is always exactly `"basic"` or `"reflowable"`. Today the
  gate passes through whatever string the client sent (`requestedMode ?? "basic"`); tighten it so any
  value other than `"reflowable"` is served and echoed as `"basic"` — the response must never name a
  tier that was not actually served.
- Serialization is computed **on subscribe**, not maintained continuously — an idle terminal must cost
  nothing extra.

## Out of scope
- Any client-side consumption — task-005.
- Removing or changing the basic tier: it remains the mandatory fallback for clients that do not
  advertise the capability, and the ring keeps being maintained for them.
- New protocol schema/opcode changes (`0x05` already exists; the protocol is append-only).
- Reflow-on-resize of an already-attached client (that is a live redraw the PTY performs itself).

## Acceptance criteria
- [ ] Subscribing with the reflowable mode yields exactly one `Restore` (`0x05`) frame and **no**
      `Snapshot`, followed by live `Output`.
- [ ] Subscribing without the capability, or with the feature disabled, yields exactly one `Snapshot`
      and no `Restore` — byte-identical behaviour to today.
- [ ] `subscribe_terminal_response.restoreMode` reports the tier actually served, never a tier the
      subscriber did not get.
- [ ] The serialized payload restores colour/attribute state and cursor position, not just text: a
      screen written with SGR colours round-trips coloured.
- [ ] Serialization is bounded — a terminal with a full scrollback produces a payload of predictable
      size, not the entire history.
- [ ] `capture` and `snapshotText()` are unchanged and still pass their existing tests.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: extend `packages/server/src/terminal/screen-buffer.test.ts` — write SGR-coloured output plus
  cursor moves, serialize, and assert the payload contains the expected attribute sequences and
  restores the same visible text as `snapshotText()`. Extend `terminal-manager.test.ts` for the
  one-frame-of-the-right-kind invariant in both modes, and `terminal-rpcs.test.ts` for the negotiation
  → served-tier match (including a session that does not advertise the capability).
  Run `npx vitest run packages/server/src/terminal`.
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual: `npm start`, then drive a subscription with a capability-advertising client (task-005, or a
  scratch script using `@av-pi-studio/client` with the capability set) and confirm from the daemon logs
  and frame opcodes which tier was served in each combination.

## Notes
`@xterm/headless` ships a UMD bundle Node's ESM loader cannot statically read, which is why
`screen-buffer.ts:5-10` loads it through `createRequire`. Any addon loaded into it will very likely
need the same treatment — expect it rather than discovering it as a runtime failure.
