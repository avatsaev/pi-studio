# Task 005 — Drop `extends: "pi"` provider profiles — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`agents.providers` accepts only `pi` (`command`, `env`); any other key makes `loadConfig` throw `agents.providers.<key>: only "pi" is supported` (validation errors are now plain `path: message` text, not ZodError JSON). `resolveProviderClient` handles `pi` and `mock` only; `applyModelOverrides`, the custom-profile branch and `ProviderRegistry.replaceMetadata` are gone, `list_providers` answers the manifest as is. The Pi adapter lost the `provider` and `sessionDir` options and `listImportableSessions` (with its contract member and `ImportableSessionRow`: nothing called them once `sessionDir` went); `importSession` by explicit handle still works. `extends` is removed from the protocol's provider definition.

## Files changed
`packages/server/src/config/daemon-config.ts` (+test), `agent/provider-registry.ts` (+test), `agent/provider-contract.ts`, `agent/providers/pi/agent.ts` (+tests), `daemon/bootstrap.ts`, `packages/protocol/src/provider-manifest.ts` (+test); docs: root `AGENTS.md`, server `AGENTS.md`/`README.md`, `swe/features/agent-providers.md`, `agent-sessions.md`, `swe/architecture/config.md`.

## Build & test results
```
$ npx vitest run packages/server/src/agent packages/server/src/config packages/protocol/src   -> 52 files, 917 passed
$ npm run build:protocol && npm run build:server                                              -> success
```
The full-tree gate runs once at the end of the sprint (after task-006).

## Acceptance criteria
- [x] `agents.providers.foo` fails to load with a message naming `foo` (new test)
- [x] `agents.providers.pi.command` and `.env` still apply (new test)

## Follow-ups / TODO(verify)
- `migrateProviderSettings` (the legacy `command: {mode, …}` shim) is still in `daemon-config.ts`; sprint-148/task-001 covers the config shims.
- No fixture carries `extends`; desktop and workbench do not use profiles (grep).
