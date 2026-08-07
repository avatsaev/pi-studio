# Terminals — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [service-proxy.md](service-proxy.md), [cli.md](cli.md)

## Purpose

Workspace-scoped PTY shells streamed to clients over a binary multiplexed channel. Multiple terminals
can run per workspace alongside agents; each client renders output in its own local viewport. The PTY
runs in a dedicated worker process. Workspace `pi-studio.json` scripts (including long-running services)
can be started as terminals.

## Public Contract

### Control RPCs
| Operation | Message |
|-----------|---------|
| List terminals | `ListTerminalsRequest` |
| Subscribe/unsubscribe to all | `SubscribeTerminalsRequest` / `UnsubscribeTerminalsRequest` |
| Create | `CreateTerminalRequest`, `create_terminal` (MCP), `pi-studio terminal create` |
| Rename | `RenameTerminalRequest` |
| Subscribe/unsubscribe to one | `SubscribeTerminalRequest` / `UnsubscribeTerminalRequest` |
| Input | `TerminalInput` (or binary input frame) |
| Kill | `KillTerminalRequest`, `kill_terminal` (MCP), `pi-studio terminal kill` |
| Capture | `CaptureTerminalRequest`, `capture_terminal` (MCP), `pi-studio terminal capture` |
| Start a workspace script | `StartWorkspaceScriptRequest` |
| Send keys | `send_terminal_keys` (MCP), `pi-studio terminal send-keys` |

### Binary stream protocol (terminal)
Frame = `[1-byte opcode][1-byte slot][payload]`:
| Opcode | Value | Payload |
|--------|-------|---------|
| Output | `0x01` | raw bytes (PTY → clients) |
| Input | `0x02` | raw bytes (client → PTY) |
| Resize | `0x03` | JSON `{ rows, cols }` |
| Snapshot | `0x04` | terminal snapshot bytes |
| Restore | (restore) | restore snapshot (modes gated by `features["terminal-restore-modes"]`) |

`slot` is the terminal slot id used to demux multiple terminals on one socket.

## Behavior & Algorithms

```
createTerminal(workspaceId, ...): spawn PTY in worker process; assign slot; persist runtime entry
subscribe(slot): send a Snapshot frame (current screen) then live Output frames
input(slot, bytes): forward to PTY
capture(slot): return current screen text (one-shot, for CLI/MCP)
kill(slot): terminate PTY; notify subscribers
```

### PTY size ownership (last-interacting-client-wins)
A client may resize a PTY only while it is that terminal's **size authority**: the terminal is
rendered on screen by that client right now — in the workspace the user is looking at, as its pane's
visible tab. Authority is about visibility, not keyboard focus: which pane receives keystrokes has
no bearing on whether a rendered grid is real.

| Trigger | Mechanism | Notes |
|---------|-----------|-------|
| **Create** | `CreateTerminalRequest.cols` / `.rows` | The creating client measures its own grid and the PTY spawns at that size. Not a Resize frame: the terminal does not exist yet, so nothing is taken from anyone. A creator that cannot measure (panel not laid out, or not visible) omits both fields and the PTY spawns at the 80×24 default. The response echoes the size the PTY actually got. |
| **Genuine viewport change** | Resize frame | The rendered grid's dimensions actually changed: window resize, pane-divider drag, split/collapse, font-size change. |
| **Attach** | `SubscribeTerminalRequest.cols` / `.rows` | Not a Resize frame either: the size rides along in the subscribe payload so the daemon can apply it **before** emitting the `Snapshot` (see § Restore / snapshot — a frame sent after the response is always too late). An attaching client that cannot measure omits both fields; the response echoes the PTY's resulting size so it still learns what it attached to. |
| **Reconcile** | Resize frame | Post-attach: the authority's measured grid differs from what it believes the PTY to be — on becoming visible, on focus, or after a settling refit. This is how a client corrects a size that drifted after it was already subscribed. |

Two independent conditions gate every Resize frame, and **conflating them is a real defect** (it
shipped once — see below):

1. **Permission** — is this client the size authority, per above? A background tab, a tab in a
   non-active workspace, or an unmounted panel is a passive observer and MUST stay silent.
2. **Validity + dedupe** — is the measurement real (finite integers at or above the emulator
   minimum), and does it differ from the size this client believes the PTY currently has?

A client's *belief* about the PTY's size is knowledge, never permission. It comes from the create
response's echo or from the last size the client itself sent, and it is **unknown for any terminal
the client did not create** — the normal state of a restored/reattached terminal, whose PTY predates
the client. An unknown belief MUST count as "differs", because that is precisely the case that most
needs reconciling: such a PTY is typically still at its 80×24 spawn default while the panel renders
far wider.

> Treating "this client has never sent a size" as "this client may not send one" makes every
> *restored* terminal permanently unresizable — it ignores divider drags and window resizes for its
> entire life. Likewise, gating on keyboard/pane focus makes the outcome depend on transient focus
> state at the instant a resize lands, so splitting with a non-terminal tab, switching workspaces, or
> restoring a session each strand a visibly-rendered terminal at the wrong width.

Explicit non-triggers — these MUST NOT send a Resize frame:
- any resize from a client that is not the size authority (not visible, backgrounded, or in another
  workspace) — a passive observer never resizes what it is only watching;
- any resize whose computed `{ rows, cols }` equals the size this client believes the PTY has
  (dedupe);
- any unmeasurable proposal — a 0×0 or below-minimum grid, which is what a hidden panel measures.

Getting this wrong is not cosmetic. The PTY's width is what the shell's line editor uses to decide
where a line wraps and where the cursor is, so a PTY narrower than the rendered grid produces early
wrapping, misplaced cursor moves on backspace and history recall, ghost characters, background
colour that stops short of the rendered columns, and progressively scrambled redraws — the terminal
looks broken while every individual frame is in fact delivered correctly.

- The server does **not** broadcast resize ownership; the resized PTY redraws via normal Output, and
  every attached client renders that output in its own local viewport.
- Resize frames SHOULD be coalesced client-side — one frame once the size settles, not one per
  animation frame — so a divider drag does not produce a `SIGWINCH` storm and a full shell redraw
  per intermediate width.
- A fit that lands on an unchanged grid emits no change event, so a client that measured 0×0 while
  hidden MUST reconcile explicitly when it becomes visible rather than relying on a change event.
- **The daemon MUST validate every requested size, whatever path it arrives on** — binary `Resize`
  frame, subscribe payload, or create. A client is not a trusted source of dimensions: a malformed or
  hostile frame can carry `NaN`, `0`, a negative, or an absurdly large value, and passing those
  through to the real PTY / server-side screen model is how one bad frame takes down a terminal (or
  the connection handling it). Validate at the manager — the single choke point every path funnels
  through — not per call site, and reject rather than clamp-and-guess so a bug stays visible. The
  screen model's own minimum (2×1) is the floor; a generous ceiling (a few hundred each way) bounds
  the memory a resize can ask a headless grid to allocate.
- Because ownership is never broadcast, a client's *belief* about the PTY size goes stale the moment
  another client resizes the same terminal, and its dedupe can then suppress a frame it should send.
  Broadcasting the new size on resize (as create/rename/kill already broadcast their entry changes)
  is the clean fix; until then this is a known limitation of multi-client sizing, not a bug in the
  gating rules above.

### Restore / snapshot
Two tiers, negotiated per subscription:

1. **Basic snapshot (always available).** `subscribe(slot)` emits one `Snapshot` frame carrying the
   server's transient raw byte ring (bounded; default 64 KiB) before any live `Output`. Two
   constraints follow from the payload being raw bytes: the ring MUST NOT be truncated in the middle
   of an escape sequence (a byte-boundary trim can cut one in half and corrupt everything after it),
   and the replay reproduces the wrapping of whatever width the PTY had when those bytes were
   written — so replaying at a different width is approximate by construction.

   Because of that width-dependence, `SubscribeTerminalRequest` carries the attaching client's
   measured `cols`/`rows`, and the daemon MUST apply them **before** emitting the `Snapshot`. A
   full-screen app (htop, vim) paints by absolute cursor position, so replaying its 80-column stream
   into a 190-column emulator does not merely wrap oddly — it renders scrambled. Resizing first
   makes the PTY deliver SIGWINCH, and the app's own repaint arrives as live `Output` immediately
   behind the snapshot, which is self-correcting at the right width.

   A Resize frame sent *after* the subscribe response cannot achieve this: `subscribe` emits the
   snapshot synchronously, so those bytes are already on the wire before any client frame could
   arrive. (Symptom when this is got wrong: reattaching shows garbled text that a manual pane resize
   "fixes" — the drag is just triggering the repaint that should have happened at attach.)

   A client that cannot measure (hidden panel, 0×0) MUST omit both fields rather than send a
   placeholder — it is a passive observer and must not resize what it is only watching.
   `SubscribeTerminalResponse` echoes the PTY's resulting `cols`/`rows` so any subscriber, including
   one that sent nothing, learns the true size instead of guessing at it.

   Finding an escape-safe boundary requires parsing from the **start** of the retained bytes — whether
   an offset sits inside a sequence depends on where that sequence began, which may be arbitrarily far
   back. That makes the trim O(ring), so it MUST NOT run on every append: trimming the instant the cap
   is exceeded means a full scan *and* a full copy per output chunk, on the hottest path the daemon
   has (every byte of every terminal). Trim with hysteresis instead — when the ring exceeds the cap,
   cut back to a low-water mark well below it — so the cost amortizes over the headroom reclaimed
   instead of recurring per chunk. Subscribers cannot observe the difference; only the retained
   backlog varies, and it is explicitly "bounded", not "exactly N bytes".
2. **Reflowable restore (capability-gated).** When the daemon advertises
   `features["terminal-restore-modes"]` **and** the client advertised
   `CLIENT_CAPS.terminal_reflowable_snapshot`, the subscription may instead be served a `Restore`
   frame (opcode `0x05`) carrying a **serialization of the server's screen model** rather than a
   byte ring — a redraw of the current grid, correct at any client width.
   `SubscribeTerminalResponse.restoreMode` echoes which tier was chosen, and is `"basic"` whenever
   either side lacks support, so an old client always degrades cleanly.

Before replaying either payload the client MUST **reset** its emulator, not merely clear it: a bare
clear leaves alt-screen state, scroll margins, and character-set selections from the previous stream
in place, and those corrupt the replay.

### Output coalescing
- Output is coalesced (batched) before broadcast to reduce frame overhead.

## Data & Persistence
- Terminal runtime state is tracked in a workspace script/terminal runtime store; PTY content is not
  persisted long-term (snapshots are transient).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| PTY exits | Notify subscribers; terminal closed |
| Resize from passive render | Suppressed (no Resize frame) |
| Multiple clients, different viewport sizes | Last-interacting size wins; each renders locally |
| Subscribe to nonexistent slot | Error / no-op |
| Old client without restore-modes feature | Falls back to basic snapshot behavior |

## Dependencies
- Internal: terminal-manager, terminal-stream router, workspace script runtime, shell integration,
  service proxy (for service scripts), the `ScreenBuffer` screen model.
- External: **`node-pty`** for the real PTY (programs see `isatty`, get SIGWINCH on resize, and run
  full-screen apps correctly); **`@xterm/headless`** to maintain a server-side screen grid for
  accurate text `capture`; **`tree-kill`** to terminate the whole PTY process tree on close;
  **`which`** to resolve the shell binary; **`strip-ansi`** to defend capture output. A piped
  `node:child_process` backend (`ChildProcessPtyBackend`) is the fallback when the native module is
  unavailable, and the manager accepts an injected backend for deterministic tests.

  > Implementation note: the daemon adopts `node-pty` (a native dependency) for terminal fidelity —
  > see [../MAIN-SCOPE.md](../MAIN-SCOPE.md) § Backend dependency policy. `capture` feeds the byte
  > stream through `@xterm/headless` and reads the visible grid, so cursor moves / clears / redraws
  > (progress bars, full-screen apps) produce the true on-screen text rather than a stripped byte
  > dump. The binary `Snapshot` frame remains the raw byte ring (each client's own xterm replays it).

## Acceptance Criteria

Ticked = covered by an automated test. The size-ownership items below are inherently live-only (there
is no jsdom/component-test path for the web client's terminal panel), so they stay unticked until a
browser pass against a real daemon confirms them.

- [x] Creating a terminal spawns a PTY in a worker and assigns a slot.
- [x] Subscribing yields a Snapshot frame followed by live Output frames.
- [x] Input frames reach the PTY; Output frames stream back per slot.
- [ ] A terminal created by a client that can measure its grid spawns at that grid's size — `stty size`
      inside the new shell reports the rendered dimensions, not `24 80`.
- [ ] A terminal restored/reattached from a previous session resizes on a divider drag or window
      resize like any other — a client that never sized the PTY is still allowed to resize it.
- [ ] Attaching to a terminal whose PTY size differs from the rendered grid reconciles it without
      user interaction; no click or throwaway resize is required to make the terminal usable.
- [ ] Reattaching to a terminal running a full-screen app (htop, vim) at a different width renders
      correctly from the first paint — the daemon resized the PTY before replaying the snapshot, so
      no manual pane resize is needed to unscramble it.
- [ ] A terminal that is not visible — backgrounded tab, or a tab in a non-active workspace — sends
      no Resize frame however the layout around it changes.
- [ ] Splitting a pane with a non-terminal tab still resizes the visible terminal whose pane shrank,
      even though focus moved to the new pane.
- [ ] Switching to a workspace whose terminal was hidden reconciles that terminal's size on becoming
      visible, without a click.
- [ ] A recomputed size identical to the believed one sends nothing, and a pane-divider drag
      produces one Resize once the drag settles rather than one per animation frame.
- [ ] Typing a command longer than the viewport width, then backspacing back through the wrap, leaves
      no ghost characters and no misplaced cursor.
- [ ] A snapshot/restore replay is preceded by an emulator reset and begins at an escape-sequence
      boundary (never mid-sequence).
- [x] Two clients of different sizes both render the PTY output in their own viewports.
- [x] `capture` returns current screen text without subscribing.

## TODO(verify)
- [x] Restore opcode value — `0x05`, confirmed against the live codec
      (`packages/protocol/src/binary-frames/terminal-stream-protocol.ts`). The reflowable payload
      format is unconstrained by any external peer (both ends are ours) and is fixed by the task that
      implements tier 2.
- [ ] Whether the production PTY runs in a dedicated worker process (`terminal-worker-protocol.ts`)
      or in-process; the clean-room build runs `node-pty` in-process behind the `PtyBackend`
      interface.
