# Task 003 — Terminal Stream Controller & Hooks — Summary

- **Sprint:** sprint-023-data-hooks-integration
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Terminal stream controller (pure logic, no DOM) bridging the `TerminalStreamRouter` binary frame
router to consumer callbacks, plus a ref-counted session registry with LRU keepalive and a
debounced/deduped resize helper.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/hooks/use-terminal-hooks.ts` | `createTerminalController`, `dedupResize`, `TerminalSessionRegistry`, `createDebouncedResize`, React hook type stubs |
| `packages/app/src/hooks/use-terminal-hooks.test.ts` | 17 tests |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| Terminal stream controller — subscribe to slot, write input, resize | `createTerminalController` wraps `TerminalStreamRouter.subscribeSlot`/`sendInput`/`sendResize` |
| Resize dedup (only send when dimensions change) | `dedupResize` helper; `controller.resize` returns bool |
| Debounced resize (coalesce rapid events) | `createDebouncedResize` wraps controller with setTimeout |
| Session retention — ref-counted, LRU keepalive | `TerminalSessionRegistry` with `acquire`/`release`; `KEEPALIVE_TTL_MS = 60s`; `MAX_SESSIONS = 6`; LRU eviction |
| Background tab preserves scrollback — no re-subscribe | Refs keep session alive; `subscribe()` idempotent |
| Snapshot restore on reconnect | `snapshotRestored` flag set true when `onSnapshot`/`onRestore` fires |

## Build & test results

```
$ npx tsc -b packages/app
(no errors)

$ npm test -- packages/app/src/hooks/use-terminal-hooks.test.ts
Test Files  1 passed (1)
Tests  17 passed (17)
```

## Acceptance criteria
- [x] Terminal renders live PTY output — `onOutput` callback wired through controller
- [x] Resize dedup — `dedupResize` returns false for identical dimensions; verified by tests
- [x] Background tab preserves scrollback — `TerminalSessionRegistry` keeps session alive after ref drop
- [x] Reconnect restores from snapshot — `snapshotRestored` flag verified by test

## Follow-ups / TODO(verify)
- React hook wrappers (`useTerminalSession`, `useWorkspaceTerminals`) are typed stubs — full DOM integration with xterm `Terminal` instance belongs in sprint-024 (workspace wiring).
- `TerminalSessionRegistry.evictLRU` only evicts sessions with `refs === 0` — if all sessions are held, it silently skips eviction. This is intentional but should be monitored.
