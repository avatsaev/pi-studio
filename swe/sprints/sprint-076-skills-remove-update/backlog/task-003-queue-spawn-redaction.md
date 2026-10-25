# Task 003 — `ResourceService` FIFO queue, spawn runner, credential redaction, mutation logging

- **Sprint:** sprint-076-skills-remove-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal

Shared machinery every spawned operation uses: one FIFO, bounded stderr, timeouts with tree-kill, redacted sources in logs and responses.

## Context / why

Remove and update (this sprint) and install (077) all run external commands; building it once against the simplest consumers.

## Scope references

- swe/architecture/pi-resource-management.md § Queue, watcher, broadcast, § Spawn environment, § Redaction & logging, § Timeouts
- packages/server/src/extensions/sync-executor.ts:49-58 (`InstallSpawn`, `defaultInstallSpawn`, `STDERR_TAIL_MAX`)
- packages/server/src/util/concurrency.ts:27 (`createLimiter`)
- packages/server/src/resources/resource-service.ts (sprint-075)

## What to build

- `createLimiter(1)` queue inside `ResourceService`, separate from `ExtensionsService`'s mutex; `list`/`setEnabled` bypass it.
- `runSpawn(command, timeoutMs)` over the injected `InstallSpawn` → `{ok, error?: "spawn_failed"|"timeout", stderr (≤2048, redacted)}`.
- `redactSource(s)`: strip `user[:pass]@` from URL-like substrings; mask `token`/`access_token` query values. Pure, tested.
- Info log per mutation `{op, kind, source, outcome, durationMs}`; warn with stderr tail on failure.
- Every queued mutation ends with: re-list, broadcast `skills_changed("mutation")`, respond.

## Out of scope

- Concrete operations (tasks 004-005)

## Acceptance criteria

- [ ] Two queued operations run strictly in submission order; a `setEnabled` issued meanwhile completes immediately
- [ ] A timed-out spawn returns `timeout` and the queue proceeds
- [ ] `git:https://user:tok@host/r?access_token=x` is fully redacted

## Test / verification plan

- `npx vitest run packages/server/src/resources` with a fake `InstallSpawn`
- `npm run build:server`
