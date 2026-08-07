# Task 001 — PTY terminal manager (worker process) + binary stream

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005 (sprint-004), task-004 (sprint-002, terminal codec)

## Goal
Implement the workspace-scoped PTY terminal manager running in a dedicated worker process, multiplexed
over the binary terminal stream protocol.

## Scope references
- `clean-room-scope/features/terminals.md` § Behavior, § PTY size ownership, § Output coalescing
- `clean-room-scope/architecture/websocket-protocol.md` § Binary frames — terminal stream

## What to build
- `packages/server/src/terminal/`: `terminal-manager` spawning PTYs (node-pty or equivalent) inside a
  worker process; assign a `slot` per terminal; track runtime entries.
- Stream wiring: subscribe(slot) → emit a `Snapshot` frame (current screen) then live `Output`
  frames; input(slot, bytes) → forward to PTY; kill(slot) → terminate + notify subscribers.
- **Size ownership (last-interacting-client-wins):** a client claims PTY size only on genuine
  viewport change or focus/tap; passive attach/restore/refit must NOT send Resize. Server does NOT
  broadcast resize ownership; resized PTY redraws via normal Output.
- Output coalescing (batch before broadcast).

## Out of scope
- Control RPC handlers (task-002). Service scripts/proxy (task-003).

## Acceptance criteria
- [ ] Creating a terminal spawns a PTY in a worker and assigns a slot.
- [ ] Subscribing yields a Snapshot frame followed by live Output frames.
- [ ] Input frames reach the PTY; output streams back per slot.
- [ ] A passive re-attach does not produce a Resize frame.
- [ ] Two clients of different sizes both render output (no server-side resize broadcast).

## Test / verification plan
- Tests: `npx vitest run .../terminal-manager.test.ts` — spawn+slot, snapshot-then-output, input
  forward, passive-no-resize.

## Notes
- Worker protocol (`terminal-worker-protocol.ts`) + Restore opcode value are TODO(verify).
