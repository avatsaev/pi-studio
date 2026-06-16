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
- A client claims PTY size **only** when its viewport genuinely changes size or the user
  focuses/taps the terminal.
- Passive work — attaching, restoring visibility, font settling, renderer refits, just looking — must
  **not** send a Resize frame.
- The server does **not** broadcast resize ownership; the resized PTY redraws via normal Output, and
  every attached client renders that output in its own local viewport.

### Restore / snapshot
- On (re)subscribe, the client receives a Snapshot to rebuild screen state, then live output.
  Reflowable snapshot support is advertised via `CLIENT_CAPS.terminal_reflowable_snapshot`; restore
  modes via `features["terminal-restore-modes"]`.

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
- [ ] Creating a terminal spawns a PTY in a worker and assigns a slot.
- [ ] Subscribing yields a Snapshot frame followed by live Output frames.
- [ ] Input frames reach the PTY; Output frames stream back per slot.
- [ ] A passive re-attach does not send a Resize frame.
- [ ] Two clients of different sizes both render the PTY output in their own viewports.
- [ ] `capture` returns current screen text without subscribing.

## TODO(verify)
- [ ] Exact Restore opcode value and reflowable-snapshot payload format.
- [ ] Whether the production PTY runs in a dedicated worker process (`terminal-worker-protocol.ts`)
      or in-process; the clean-room build runs `node-pty` in-process behind the `PtyBackend`
      interface.
