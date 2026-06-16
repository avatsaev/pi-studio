# Task 003 — Provider manifest/registry + snapshot refresh — Summary

- **Sprint:** sprint-005-provider-lifecycle
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `agent/manifest.ts` — `PROVIDER_MANIFEST` (pi + mock) with mode metadata (`icon`, `colorTier`)
  using protocol's `ProviderDefinition` types.
- `agent/provider-registry.ts`:
  - `PROVIDER_CLIENT_FACTORIES` (`pi`, `mock`) invoked with `(deps)` = `{ logger, transportFactory,
    binaryResolver }`.
  - `resolveProviderClient(providerId, config, deps)` — built-ins, `pi` overrides, and custom
    `extends:"pi"` profiles (launch via `command`, imports via `params.sessionDir`). `models` replaces
    discovered models; `additionalModels` merge/relabel. Building a client never spawns Pi.
  - `ProviderRegistry` — visible metadata holder; `replaceMetadata(config)` updates
    label/description/capabilities/modes without constructing/launching a client.
- `agent/provider-snapshot.ts` — `ProviderSnapshotManager` keyed per resolved cwd (blank → home):
  probes only while **cold**; warm (`ready`/`error`/`unavailable`) stays cached until an **explicit
  refresh** (no TTL/focus/selector/config revalidation); concurrent cold reads share one probe;
  `refreshSettings()` clears all scopes + in-flight and re-probes only home with `force:true`
  (workspaces re-probe lazily).

## Files created / changed
| File | Change |
|------|--------|
| `agent/manifest.ts` | created |
| `agent/provider-registry.ts` | created |
| `agent/provider-snapshot.ts` | created |
| `agent/index.ts` | modified — re-exports manifest/registry/snapshot |
| `agent/provider-registry.test.ts` | added — 5 tests |
| `agent/snapshot.test.ts` | added — 4 tests |

## How it satisfies the scope
- **agent-providers.md § Registration surface / § Custom Pi-compatible profiles / § Provider
  snapshot refresh contract:** manifest entries, factory registry, profile resolution + model
  override semantics, and the cold→warm / settings-refresh caching contract are reproduced exactly.
- **config.md § Provider override:** custom-profile fields (`command`/`env`/`params.sessionDir`/
  `models`/`additionalModels`) drive client construction + metadata.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/agent/provider-registry.test.ts packages/server/src/agent/snapshot.test.ts
 ✓ provider-registry.test.ts (5) ✓ snapshot.test.ts (4)   → 9 passed
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] A cold snapshot probes once and stays cached until an explicit refresh.
- [x] Settings refresh clears all scopes and re-probes only the home snapshot (`force:true`);
      workspaces re-probe lazily.
- [x] A custom `extends:"pi"` profile launches via its `command` and locates imports via
      `params.sessionDir`.
- [x] Registry/config replacement updates metadata without spawning Pi (building a client never spawns).

## Follow-ups / TODO(verify)
- Snapshot caching deliberately has **no hidden revalidation triggers** (per scope warning); the
  probe function is injected so the daemon wires it to `resolveProviderClient` + `listModels`/
  `listModes`/`isAvailable` in bootstrap.
- Wiring snapshots into app selectors (sprint-012) and MCP injection (sprint-010) are out of scope.
