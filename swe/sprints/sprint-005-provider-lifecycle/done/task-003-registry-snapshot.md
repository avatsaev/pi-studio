# Task 003 — Provider manifest/registry + snapshot refresh

- **Sprint:** sprint-005-provider-lifecycle
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002; task-002 (sprint-003, config/provider overrides)

## Goal
Build the provider manifest, the client-factory registry, custom Pi-compatible profile resolution,
and the per-cwd provider snapshot cache with explicit-refresh semantics.

## Scope references
- `clean-room-scope/features/agent-providers.md` § Registration surface, § Custom Pi-compatible profiles, § Provider snapshot refresh contract
- `clean-room-scope/architecture/config.md` § Provider override

## What to build
- `provider-manifest.ts`: provider definitions + mode metadata (icon, colorTier).
- `provider-registry.ts`: `PROVIDER_CLIENT_FACTORIES` invoked with `(logger, runtimeSettings, options)`.
- Custom profile resolution: `extends:"pi"` + `label`; `command`/`env`/`params.sessionDir`/`models`/
  `additionalModels`/`disallowedTools`/`enabled`/`order`. `models` replaces discovered; `additionalModels`
  merges/relabels.
- Snapshot manager keyed per resolved cwd (blank cwd → user home): probes only while **cold**; once
  warm (`ready`/`error`/`unavailable`) stays cached until explicit refresh (no TTL/focus/selector/config revalidation).
- **Settings refresh:** clear all cwd-scope caches + in-flight loads, then refresh only the home
  snapshot with `force:true`; workspace snapshots re-probe lazily.
- Registry/config replacement updates visible metadata only — must NOT spawn the Pi process.

## Out of scope
- Wiring snapshots into app selectors (sprint-012). MCP injection (sprint-010).

## Acceptance criteria
- [ ] A cold snapshot probes once and stays cached until an explicit refresh.
- [ ] Settings refresh clears all scopes and re-probes only the home snapshot (`force:true`).
- [ ] A custom `extends:"pi"` profile launches via its `command` and locates imports via `params.sessionDir`.
- [ ] Registry/config replacement updates metadata without spawning Pi.

## Test / verification plan
- Tests: `npx vitest run .../provider-registry.test.ts`, `.../snapshot.test.ts` — cold→warm caching,
  settings refresh scope clearing, no-spawn-on-config-replace.

## Notes
- Snapshot caching is a known correctness/perf contract; do not add hidden revalidation triggers.
