# Task 003 — Terminal-stream router + reconnection/rehydrate — Summary

- **Sprint:** sprint-007-client-sdk
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/client/src/terminal-stream-router.ts` — `TerminalStreamRouter`:
  - `start()`/`stop()` tap `DaemonClient.onTerminalFrame`.
  - `subscribeSlot(slot, { onOutput, onSnapshot, onRestore })` registers a per-slot subscriber;
    inbound `Output`/`Snapshot`/`Restore` frames are demuxed to the matching slot; frames for
    unsubscribed slots are dropped (no throw).
  - Outbound `sendInput(slot, bytes)` (opcode `Input=0x02`) and `sendResize(slot, rows, cols)`
    (opcode `Resize=0x03`, JSON `{rows,cols}`) encode via the sprint-002 codec and send on the data
    path.
- `packages/client/src/reconnect.ts` — `ReconnectionManager`:
  - Watches `DaemonClient` state; on `closed` schedules a backoff reconnect; resets backoff on a
    healthy `open`.
  - `delayForAttempt(n)` — exponential backoff (`initialDelayMs * factor^(n-1)`) capped at
    `maxDelayMs`, with optional jitter. Defaults: 500ms / ×2 / 30s / 0.2 jitter (TODO(verify)).
  - `tryReconnect()` calls `DaemonClient.connect()` which re-sends `hello` with the SAME
    capabilities (daemon rehydrates them) and re-records `serverId`/`features`.
  - Hooks: `onReconnected({attempt, serverId})` (the sprint-012 timeline-resume planner rides this),
    `onReconnectFailed`. Injectable `setTimer`/`clearTimer`/`random` for deterministic tests.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/terminal-stream-router.ts` | created |
| `packages/client/src/reconnect.ts` | created |
| `packages/client/src/index.ts` | modified |
| `packages/client/src/terminal-router.test.ts` | added — 7 tests |

## Commands & results
- `npm run build:client` → exit 0 (no type errors)
- `npx vitest run packages/client/src/terminal-router.test.ts` → **7 passed**
- `npx vitest run packages/client` → **22 passed** (3 files)
- `npx oxlint packages/client` → clean
- `npx oxfmt --check packages/client` → clean

## Acceptance criteria
- [x] Output/Snapshot frames are delivered to the correct slot subscriber.
- [x] Input/Resize frames are encoded with the right opcode + slot.
- [x] On reconnect the driver re-handshakes and rehydrates capabilities (same hello caps; serverId +
      features re-recorded).

## Notes / TODO(verify)
- Reconnection backoff parameters (defaults are conservative placeholders).
- Restore opcode value (`0x05`) and reflowable-snapshot payload format (carried from sprint-002).
- Timeline resume-from-cursor planning is sprint-012; this exposes `onReconnected` as the hook.
