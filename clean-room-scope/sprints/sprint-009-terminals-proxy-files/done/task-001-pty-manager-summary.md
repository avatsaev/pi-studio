# Task 001 — PTY terminal manager (worker process) + binary stream — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/terminal/`:
- **`pty-backend.ts`** — injectable `PtyBackend`/`PtyProcess` abstraction. Default
  `ChildProcessPtyBackend` uses `node:child_process` pipes (native-free, per the project's pure-JS
  dep constraint). The production node-pty worker (`terminal-worker-protocol.ts`) is TODO(verify);
  the manager is backend-agnostic.
- **`terminal-manager.ts`** — `TerminalManager`:
  - `createTerminal()` spawns a PTY via the backend, assigns an incrementing `slot`, tracks a
    `TerminalRuntimeEntry`.
  - `subscribe(slot, sink)` emits a **Snapshot** frame (current screen, a bounded rolling output
    buffer) then registers the sink for live **Output** frames; returns an unsubscribe fn. Does NOT
    resize the PTY.
  - `input()` forwards bytes; `resize()` is the ONLY path that claims PTY size (last-interacting
    client-wins — a client concern; never called on attach); no server-side resize broadcast.
  - `capture()` returns the current screen text (one-shot, no subscribe); `kill()` terminates +
    drops the entry.
  - **Output coalescing**: output is batched within a `coalesceMs` window before broadcasting one
    Output frame to all subscribers. Uses the sprint-002 `encodeTerminalFrame` codec.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/terminal/pty-backend.ts` | created |
| `packages/server/src/terminal/terminal-manager.ts` | created |
| `packages/server/src/terminal/index.ts` | created |
| `packages/server/src/index.ts` | modified (re-export) |
| `packages/server/src/terminal/terminal-manager.test.ts` | added — 8 tests (fake PTY backend) |

## Build & test results
```
$ npm run build:server                                                 → exit 0
$ npx vitest run packages/server/src/terminal/terminal-manager.test.ts → 8 passed
$ npx oxlint / oxfmt --check packages/server/src/terminal               → clean
```

## Acceptance criteria
- [x] Creating a terminal spawns a PTY in the backend and assigns a slot.
- [x] Subscribing yields a Snapshot frame followed by live Output frames.
- [x] Input frames reach the PTY; output streams back per slot.
- [x] A passive re-attach (subscribe) does not produce a Resize frame.
- [x] Two clients of different sizes both render output (no server-side resize broadcast).

## Follow-ups / TODO(verify)
- Worker process protocol (`terminal-worker-protocol.ts`) + node-pty backend (modeled via the
  injectable `PtyBackend`; default uses piped child processes).
- Restore opcode value / reflowable-snapshot payload format (snapshot modeled as a bounded byte
  buffer; richer screen modeling would need a vt parser).
- Control RPCs are task-002.
