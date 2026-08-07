# Task 002 — Daemon config (config.json) + env precedence

- **Sprint:** sprint-003-persistence-config
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement `PersistedConfigSchema` loading for `config.json` with legacy normalization and
environment-variable overlay.

## Scope references
- `clean-room-scope/architecture/config.md` § Daemon config, § Env precedence, § Behavior
- `clean-room-scope/MAIN-SCOPE.md` § 6 (Configuration surface)
- `clean-room-scope/architecture/persistence.md` (store reuse)

## What to build
- `PersistedConfigSchema` covering: `version`, `daemon.{listen,hostnames,mcp,appendSystemPrompt,
  cors.allowedOrigins,relay,auth.password,serviceProxy}`, `app.baseUrl`, `worktrees.root`,
  `providers.local.modelsDir`, `agents.{providers, metadataGeneration.providers}`, `log.*`.
- All fields optional with sensible defaults.
- `loadConfig(path)`: read JSON or `{}`; migrate legacy (`allowedHosts`→`hostnames`, provider
  `command:{mode,...}`→current shape via `migrateProviderSettings`); `parse`; overlay env vars
  (env wins) for the keys in MAIN-SCOPE § 6 / config.md.
- Provider override schema (`agents.providers.{id}`): id `/^[a-z][a-z0-9-]*$/`, `extends:"pi"` +
  `label` required for custom; `command?`, `env?`, `params?`, `models?`, `additionalModels?`,
  `disallowedTools?`, `enabled?`, `order?`, `description?`.

## Out of scope
- Per-project `pi-studio.json` (task-003). Using config in bootstrap (sprint-004).

## Acceptance criteria
- [ ] Missing `config.json` → all defaults.
- [ ] Legacy `allowedHosts` and provider `command.mode` load without error (migrated inline).
- [ ] Env vars override matching config keys (env wins).
- [ ] A custom provider missing `extends`+`label` is rejected; bad provider id rejected.

## Test / verification plan
- Tests: `npx vitest run .../config.test.ts` — defaults, legacy migration, env overlay, provider id rules.

## Notes
- `agents.metadataGeneration.providers` ordering feeds structured generation (sprint-006). Exact
  per-field defaults + log rotation values are TODO(verify).
