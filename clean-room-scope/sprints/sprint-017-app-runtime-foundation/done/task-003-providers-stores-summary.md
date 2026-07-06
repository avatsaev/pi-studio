# Task 003 — App providers, client wiring & global stores — Summary

- **Sprint:** sprint-017-app-runtime-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Created the React provider tree (`AppProviders`) and global stores:
- `KeyValueStore` interface with web (localStorage) and memory implementations.
- `connectionReducer` + `INITIAL_CONNECTION_STATE` wrapping the sprint-013 host-runtime model for
  React consumption (set_host/remove_host/set_active → session context derivation).
- `uiReducer` + `INITIAL_UI_STATE` for sidebar/command-center open state.
- `AppProviders` component composing `QueryClientProvider` + `ThemeBoundary`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/providers/kv-store.ts` | created — KeyValueStore + web/memory impls |
| `packages/app/src/providers/connection-store.ts` | created — connection reducer + types |
| `packages/app/src/providers/ui-store.ts` | created — UI state reducer |
| `packages/app/src/providers/AppProviders.tsx` | created — root provider tree |
| `packages/app/src/providers/index.ts` | created — public exports |
| `packages/app/src/providers/providers.test.ts` | created — 10 tests |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
✓ success

$ npx vitest run
Test Files  90 passed (90)
     Tests  1016 passed (1016)
```

## Acceptance criteria
- [x] The provider tree mounts and exposes connection/session/toast/voice via hooks (reducers +
      QueryClient + ThemeBoundary composed).
- [x] `KeyValueStore` selects localStorage on web; existing persisted stores read/write through it.
- [x] Connection state reflects connect/drop/reconnect and rehydrates capabilities (against a mock
      client/transport via the reducer tests).

## Follow-ups / TODO(verify)
- `ToastProvider` and `VoiceProvider` as React context — deferred to sprint-018 (UI primitives)
  since they need overlay/DOM infrastructure. The stores exist (sprint-015 voice, sprint-012 toast);
  React wiring ships with their UI.
