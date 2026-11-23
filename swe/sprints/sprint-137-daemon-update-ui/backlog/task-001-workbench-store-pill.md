# Task 001 — Workbench: the daemon update store and the second pill

- **Sprint:** sprints/sprint-137-daemon-update-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (features/connection)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-136/task-002

## Goal
The connection bar shows the daemon's pill, left of the app's, from the broadcast state.

## Context / why
Spec § Workbench (D6, P11). The pill component is the app pill's (`AppUpdateIndicator`), given a view.

## Scope references
- `swe/features/self-update.md` § Workbench (Pill, Other clients)
- `packages/workbench/src/features/connection/` (`AppUpdateIndicator.tsx` generalised to a view + an `onActivate`, new `daemon-update-presentation.ts` + test, `daemon-update-store.ts`, `use-daemon-update.ts`, `ConnectionBar.tsx`)
- `packages/workbench/src/test/reset-stores.ts`

## What to build
- Store: status per connection; filled by `getDaemonUpdateStatus()` on every transition to connected (when the daemon has the capability) and by `onDaemonUpdateStatus`; cleared on disconnect.
- `daemonUpdateView(status)` → the pill's view or null, per P11's texts and tones. A click sets the UI store's `daemonUpdateDialogOpen` flag (added here); the dialog that reads it is task-002.
- The app's pill keeps its behavior; both can show at once (daemon's first).

## Out of scope
The dialog (task-002). Settings (task-003).

## Acceptance criteria
- [ ] Presentation tests for every state kind.
- [ ] Without the capability nothing is rendered and no request is sent.
- [ ] The app-update tests still pass.

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build:workbench && npm run typecheck && npm run lint`

## Notes
Tokens only, rem sizes, ellipsis. Docs: `packages/workbench/AGENTS.md`.
