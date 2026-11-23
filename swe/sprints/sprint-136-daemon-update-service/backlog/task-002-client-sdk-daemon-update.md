# Task 002 — Client SDK: daemon update methods and subscription

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** backlog
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
`PiStudioClient` has `getDaemonUpdateStatus`, `checkDaemonUpdate`, `applyDaemonUpdate`, `setDaemonUpdateAutoCheck`, `onDaemonUpdateStatus`, `hasDaemonUpdateCapability`.

## Context / why
Spec § Other surfaces. Same shape as the viewer-settings members.

## Scope references
- `swe/features/self-update.md` § Other surfaces
- `packages/client/src/` (the facade file holding `getViewerSettings`/`onViewerSettingsUpdate`, + tests)

## What to build
- Requests through `daemon.request`; `checkDaemonUpdate` uses a 30 s timeout; `applyDaemonUpdate` returns `{ok, error?}` and never throws for a refusal.
- `onDaemonUpdateStatus` delivers the broadcast's status; returns an unsubscribe.

## Out of scope
The workbench store (sprint-137).

## Acceptance criteria
- [ ] Tests against the package's fake daemon: each method's wire message, a refusal, the subscription and its removal.

## Test / verification plan
- `npx vitest run packages/client`
- `npm run build:client && npm run typecheck && npm run lint`

## Notes
Docs: `packages/client/AGENTS.md`.
