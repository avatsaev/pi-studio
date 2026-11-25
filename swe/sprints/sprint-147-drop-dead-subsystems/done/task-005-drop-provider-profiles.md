# Task 005 — Drop `extends: "pi"` provider profiles

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (agent, config), packages/protocol
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-002, task-004

## Goal
`agents.providers` holds only the built-in `pi` entry's `command` and `env`; nothing else in it is
read, and the code for custom profiles is gone.

## Context / why
Owner decision 2026-11-24. Profiles are reachable only by editing `config.json`, the workbench always
creates agents with `provider: "pi"`, and auth, skills and extensions ignore a profile's own home.
Depends on task-002 (`daemon-config.ts`) and task-004 (`pi/agent.ts`, `provider-registry.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved: drop `extends: "pi"` profiles
- `packages/server/src/config/daemon-config.ts` (`providerOverrideSchema`, `providersRecordSchema`)
- `packages/server/src/agent/provider-registry.ts` (`PROVIDER_CLIENT_FACTORIES`, `applyModelOverrides`,
  `ProviderRegistry.replaceMetadata`, the custom-profile branch of `resolveProviderClient`)
- `packages/server/src/agent/providers/pi/agent.ts` (`provider` id option, `sessionDir`,
  `listImportableSessions`)
- `packages/protocol/src/provider-manifest.ts` (`extends`)

## What to build
- Config: `agents.providers` accepts only `pi`, with `command` and `env`. Any other key is a config
  error naming the key. Unlike other removed keys (task-006, ignored), a profile id is something agent
  records point at, so ignoring it would only move the failure to the agent's next start.
  `models`, `additionalModels`, `params`, `label`, `description`, `disallowedTools`, `enabled`, `order` go.
- Registry: `resolveProviderClient` handles `pi` and `mock` only; `list_providers` answers the
  manifest as is.
- `import_agent_session` by explicit handle keeps working (CLI and SDK use it).
Docs: root `AGENTS.md` § Agent provider model (the "Custom Pi-compatible profiles" sentence),
`packages/server/README.md` (line about `"extends": "pi"`), `swe/features/agent-providers.md`.

## Acceptance criteria
- [ ] A `config.json` with `agents.providers.foo` fails to load with a message naming `foo`.
- [ ] `agents.providers.pi.command` and `.env` still apply (existing tests).

## Test / verification plan
- `npx vitest run packages/server/src/agent packages/server/src/config packages/protocol/src`
- `npm run build:protocol && npm run build:server`
