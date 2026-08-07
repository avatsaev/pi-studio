# Task 003 — Terminals: PTY manager + binary frame wiring

- **Sprint:** sprint-035-production-daemon
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Problem
dev-bootstrap explicitly skips binary/terminal frames ("Binary (terminal) frames not wired"). The
terminal pane needs real PTYs and the binary stream.

## Scope references
- `features/terminals.md`; `architecture/websocket-protocol.md` § binary frames
- Existing: sprint-009 PTY terminal manager (worker) + terminal control RPCs; `protocol` terminal
  binary frame codec (`[opcode][slot]`).

## What to build
- Instantiate the PTY terminal manager in the production bootstrap; register terminal control RPCs
  (open/close/resize/restore/capture).
- Route **binary frames** in the WS server `onMessage` (dev bootstrap ignores them): decode
  `[opcode][slot]`, forward input to the PTY, and stream PTY output back as binary frames to the
  owning session(s).
- Handle reconnect/rehydrate (reflowable snapshot / restore opcode).

## Acceptance criteria
- [ ] Opening a terminal in the app spawns a real shell; typing echoes; output streams live.
- [ ] Resize propagates; closing releases the PTY.
- [ ] `npm run build:server` + server tests pass.

## Test / verification plan
- Unit: binary frame decode/route with a fake PTY.
- Manual: open a terminal pane in the app, run `ls`, confirm live output.
