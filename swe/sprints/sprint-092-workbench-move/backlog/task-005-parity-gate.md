# Task 005 — Parity gate: the move changed nothing

- **Sprint:** sprint-092-workbench-move
- **Status:** backlog
- **Type:** test
- **Area:** packages/workbench, packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004

## Goal
Prove the browser client behaves and builds as it did before the move.

## Context / why
Sprint 093 starts changing behaviour-adjacent code. A measured checkpoint here separates "the move broke it" from "the host adapter broke it".

## Scope references
- `swe/architecture/workbench-package.md` § Acceptance criteria
- `swe/notes/workbench-baseline.md`

## What to build
- Run the full gates: `npm run clean && npm run build && npm run typecheck && npm run lint && npm test`.
- Compare against the baseline and append an "After the move" section to `swe/notes/workbench-baseline.md`: test files and tests (must not drop); `dist/web` total size (within 1%); chunk-name list (identical, or each difference explained); dynamic import sites (same count).
- Browser check against a production daemon: connect, run a chat turn, split a pane by dragging a tab, open a terminal and type, open a text file, an image and a PDF, upload a file, reload and confirm the layout is restored. Record the result and any console errors.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Fixing differences that are not caused by the move: report them.

## Acceptance criteria
- [ ] Every gate passes from a clean build.
- [ ] Test count is at or above the baseline.
- [ ] `dist/web` is within 1% of the baseline and the chunk list matches.
- [ ] The browser check passes with no new console errors.
- [ ] The note records all of the above.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- The commands above.
- Browser check as described; the summary states which daemon was used.

## Notes
- The dev daemon (`npm run dev:daemon`) has a minimal handler set with no terminal or file-transfer handlers, so the terminal and file steps need a production daemon. One was running on this machine at `:6767` during planning.
