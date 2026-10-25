# Task 004 — `ResourceService` list + toggle, file watcher, `skills_*` handlers, production bootstrap

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** done
- **Type:** feature
- **Area:** packages/server (resources, daemon)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal

The daemon answers `skills_list_request` and `skills_set_enabled_request`, and broadcasts `skills_changed` on its own mutations and on external edits.

## Context / why

This makes the backend live. Toggles bypass any queue (Pi's file lock serialises writers); the FIFO queue arrives with spawned operations in sprint 076.

## Scope references

- swe/architecture/pi-resource-management.md § Toggle, § Queue, watcher, broadcast, § Wire family
- packages/server/src/viewers/viewer-settings-rpc.ts:46 (registration + broadcast-before-response pattern)
- packages/server/src/files/file-watch-service.ts (`subscribe`)
- packages/server/src/daemon/bootstrap.ts:505-510 (production registration)
- packages/server/src/daemon/dev-bootstrap.ts (must NOT register)
- Create: packages/server/src/resources/resource-service.ts, skills-rpc.ts, wire.ts (+ tests)

## What to build

- `ResourceService.list()` → catalog (task-003), mapped by `wire.ts`.
- `setEnabled(path, enabled)`: find the row (absent ⇒ `not_found`), refuse on `settings_unreadable`, derive the pattern with task-002, write through `SettingsManager` (`setSkillPaths` or `setPackages`), `await flush()`, broadcast `skills_changed("mutation")`, return the re-built list.
- Watcher: started on the first `skills_*` RPC; subscribes `<agentDir>/settings.json`, `<agentDir>/skills`, `~/.agents/skills`, the lock file; 500 ms debounce ⇒ `skills_changed("external")` to every session. An event that lands within the debounce of the service's own write is folded into the mutation broadcast.
- `skills-rpc.ts`: registers both handlers; validates shapes; domain errors, never `rpc_error`.
- Advertise `SERVER_FEATURES.skills` and register in `bootstrap.ts` only.
- `packages/server/AGENTS.md`: new `resources/` subsystem section (layout, tenets, "never hand-edit settings.json").

## Out of scope

- Spawned operations, queue, redaction (sprint 076)
- Client/UI

## Acceptance criteria

- [ ] Toggling an agents_dir skill off writes `-skills/<name>/SKILL.md` to `settings.skills`; a fresh `resolve()` reports it disabled; on again replaces it with `+…`
- [ ] Toggling a package skill upgrades the entry to object form; re-enabling a package skill writes `+…`, exactly as `pi config` does (entry stays object form; no collapse on enable) — **amended from the original "collapses it back" wording**: task-002 found Pi's own `ResourceList` toggle always appends a replacement `±pattern` entry, so Pi's collapse-to-string branch is unreachable on a real enable/disable; `toggle-patterns.ts` only reaches collapse when clearing an override outright (`enabled === undefined`), which `setEnabled` never passes. See `resource-service.test.ts`'s "amended acceptance #2" test and `architecture/pi-resource-management.md` § Toggle's note.
- [ ] `skills_changed("mutation")` reaches every session before the response
- [ ] An external write to the watched settings.json yields exactly one `skills_changed("external")`
- [ ] Dev-bootstrap registry answers `unknown_message_type` for both RPCs

## Test / verification plan

- `npx vitest run packages/server/src/resources` (temp HOME/agentDir)
- `npm run build:server`
