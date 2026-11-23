# Task 001 — Workbench: the optional `updates` host member and the connection bar's indicator

- **Sprint:** sprints/sprint-133-desktop-update-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (host types, connection bar)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`WorkbenchHost.updates?` exists; when present the connection bar shows U14's indicator next to the
version and its click runs install, restart, retry or opens the release page; the browser shows nothing.

## Context / why
Spec § 5, D5, U14, P8. Amended `swe/architecture/workbench-host-adapter.md` (`updates` row).

## Scope references
- `swe/features/desktop-self-update.md` § 5, U14
- `packages/workbench/src/host/types.ts`, the connection bar component and its presentation module
  (find with `rg "minDaemonVersion|ConnectionBar" packages/workbench/src`), the test host

## What to build
- Types: `AppUpdateState` (the eight states), `HostUpdates`.
- A pure presentation function state → `{text, tooltip, action}` per U14 (unit-tested), and the
  indicator rendered from it with ui-library tokens (rule: no new tokens; ellipsize).
- Actions: `available`/`failed` → `install()`; `restart_needed` → `restart()`; `cannot_install` →
  `links.openExternal(releaseUrl)`.

## Out of scope
The desktop host (task-002).

## Acceptance criteria
- [ ] Unit tests of the presentation for every state.
- [ ] `npm run build`, `typecheck`, `lint`, `npx vitest run packages/workbench` pass.
- [ ] The web client in a browser looks unchanged (orchestrator's check at the wave gate).

## Test / verification plan
- `npx vitest run packages/workbench/src` ; `npm run build:workbench`
