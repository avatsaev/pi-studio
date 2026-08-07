# Task 003 — Docs sync + full verification pass

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Status:** done
- **Estimated size:** XS
- **Depends on:** task-001, task-002

## Goal
Bring `packages/web-client/AGENTS.md` back in sync with the new tab-strip control and run the
package's full verification (typecheck + tests + lint) so the sprint closes clean.

## Scope references
- `packages/web-client/AGENTS.md` § Source layout (`features/workspace/` row) and any behavioral
  note that should mention the tab strip's "+" menu.

## What to build
- Update `packages/web-client/AGENTS.md`'s source-layout tree entry for `features/workspace/` to
  mention the TabStrip now hosts a new-tab ("+" menu: new chat / new terminal) control, and list
  `NewTabMenu.tsx` if task-002 split it into its own file.
- No source changes in this task beyond docs — this is the cleanup/closure pass.

## Out of scope
- Any further UI/behavior change — if verification surfaces a real bug, fix it as part of task-001
  or task-002 (reopen/amend those), not here.

## Acceptance criteria
- [ ] `packages/web-client/AGENTS.md` source layout accurately reflects the files task-001/002 added
      or changed.
- [ ] `npm run typecheck -w @av-pi-studio/web-client` passes.
- [ ] `npm run lint` passes (or only pre-existing, unrelated warnings remain).
- [ ] `npm test` (vitest, workspace-wide) passes.

## Test / verification plan
- `npm run typecheck -w @av-pi-studio/web-client`
- `npm run lint`
- `npm test`
- Re-run the task-002 manual check end-to-end once more after docs are updated, as the final smoke
  test for the sprint.

## Notes
- Per repo convention (root `AGENTS.md` "Docs sync on code changes"), doc updates ship in the same
  change as the code — this task exists only to make that an explicit, checkable step in the sprint,
  not to defer it.
