# Task 003 — App providers, client wiring & global stores

- **Sprint:** sprint-017-app-runtime-foundation
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-007 (client SDK), sprint-013/task-001 (host runtime, session context)

## Goal
Assemble the React provider tree and global stores that every screen depends on: query client, the
Pi-Studio client/connection + host runtime, session context, toast, voice, sidebar/command-center state,
and the `KeyValueStore` persistence abstraction.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` (host runtime, connection state, reconnection,
  data & persistence)
- `clean-room-scope/features/app-navigation-screens.md` (providers/contexts inventory)

## What to build
- A `KeyValueStore` interface with a `localStorage` web impl and an Electron settings-bridge impl
  selected via `getIsElectron()`; back the sprint-012/015 stores (theme, drafts, prefs, layout, pins,
  shortcuts overrides) through it.
- React providers wrapping the app: `QueryClientProvider` (`@tanstack/react-query`), a
  `ConnectionProvider` bridging `@av-pi-studio/client` → the sprint-013 host runtime + `ConnectionState`
  (backoff reconnect, capability rehydrate), `SessionProvider` (sprint-013 session context),
  `ToastProvider`, `VoiceProvider`, sidebar-animation + command-center context.
- `zustand` stores as needed for cross-screen UI state (sidebar open, command-center open, active host).
- A `useHostRuntime()`/`useConnection()`/`useSession()` hook surface consumed by later screens.

## Out of scope
- Theme bridge (task-002). Router/boot (task-004). Actual screens/chrome (sprint-018+).

## Acceptance criteria
- [ ] The provider tree mounts and exposes connection/session/toast/voice via hooks.
- [ ] `KeyValueStore` selects localStorage on web; existing persisted stores read/write through it.
- [ ] Connection state reflects connect/drop/reconnect and rehydrates capabilities (against a mock
      client/transport).

## Test / verification plan
- Tests: KeyValueStore web impl round-trip; connection-state reducer transitions (mock transport);
  store wiring (theme/draft persistence through KeyValueStore).

## Notes
- Reuse the sprint-013 host-runtime + session-context view models; this task wires them into React
  context, it does not re-implement them.
