# Task 002 — New-agent provider/profile picker — Summary

- **Sprint:** sprint-030-integration-gap-closure
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented
Replaced the hardcoded `provider: "mock"` in `NewAgentPage` with a live provider + profile (mode)
picker. Providers are read from the daemon `list_providers` RPC via a new `useProviders()` React
Query hook, parsed by a pure `provider-picker` logic module. The last-used provider/mode is
persisted to local storage (create-agent preferences) and restored on next visit. `mock` remains
selectable, and custom `extends: "pi"` profiles are labelled "(profile)".

To make the picker use **live daemon data**, a `list_providers` handler was registered in the dev
bootstrap that returns the `ProviderRegistry` manifest metadata (pi + mock + any config overrides).
The hook degrades gracefully to a static default list if the daemon lacks the RPC.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/screens/provider-picker.ts` | created — parse/select/persist logic |
| `packages/app/src/screens/provider-picker.test.ts` | added — 9 tests |
| `packages/app/src/hooks/use-providers.ts` | created — React Query hook + fallback |
| `packages/app/src/router/NewAgentPage.tsx` | modified — provider/mode Selects, prefs persistence, passes provider+modeId to create config |
| `packages/server/src/daemon/dev-bootstrap.ts` | modified — registered `list_providers` handler backed by `ProviderRegistry` |

## How it satisfies the scope
- `features/agent-providers.md` § Registration surface: the daemon now exposes provider metadata
  (id/label/extends/modes) via `list_providers`; `ProviderRegistry.listMetadata()` is the source.
- `features/composer-ui.md` § create-agent preferences: last-used provider + per-provider mode are
  persisted via `withSelectionPreference` into the existing `CreateAgentPreferences` shape.
- `mock` is guaranteed present (`parseProviderList` appends it if the daemon omits it), keeping
  smoke testing possible. Profiles (`extends`) are detected and flagged.

## Build & test results
```
$ npx tsc -p packages/app/tsconfig.json --noEmit         # exit 0
$ npx tsc -b packages/server                             # exit 0

$ npx vitest run packages/app/src/screens/provider-picker.test.ts
Test Files  1 passed (1)   Tests  9 passed (9)

$ npx vitest run packages/server/src/agent/provider-registry.test.ts   # data source
Test Files  1 passed (1)   Tests  5 passed (5)

$ npx vitest run packages/app
Test Files  73 passed (73)   Tests  1261 passed (1261)

$ npm run build:web        # (packages/app)  ✓ built
```

## Acceptance criteria
- [x] Creating an agent uses the selected provider/profile, not a hardcoded value. (`NewAgentPage` submit sends `config.provider` + `config.modeId`)
- [x] Provider list is populated from live daemon data; `mock` still available. (`useProviders` → `list_providers`; `parseProviderList` guarantees mock; verified by tests)
- [x] Last-used provider/profile is remembered across sessions. (`withSelectionPreference` persisted to KV; `resolveInitialSelection` restores it — both unit-tested)
- [x] `pi` and a custom `extends: "pi"` profile both selectable when configured. (`parseProviderList` marks `isProfile`; manifest exposes `pi`; profile parse covered by test)

## Follow-ups / TODO(verify)
- The dev-bootstrap `list_providers` handler follows the same convention as the sibling dev-only
  handlers (`list_agents`, `list_workspaces`, …) which are not integration-tested; its data source
  (`ProviderRegistry`) and the client-side transform (`parseProviderList`) are both unit-tested. A
  production daemon bootstrap should register the equivalent handler.
- Model selection (per-provider `listModels`) and thinking options are out of scope here; only
  provider + mode are wired. The `CreateAgentPreferences.providerPreferences[p].model` slot is left
  intact for a later model-picker task.
