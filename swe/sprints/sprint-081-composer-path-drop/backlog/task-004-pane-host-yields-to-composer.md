# Task 004 — Pane drop host yields to a composer drop zone for path-ref drags

- **Sprint:** sprint-081-composer-path-drop
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (hooks, features/workspace)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

While a path-ref-carrying drag is over a composer drop zone, the pane host previews nothing and does
nothing on release. Every other drag behaves exactly as today.

## Context / why

The composer sits inside a pane body, and the host (`useExternalPaneDrop`, on `TabPanelHost`'s area)
hit-tests pane zones by pointer position. It would otherwise (a) open or split a file dropped on the
composer, and (b) keep a stale preview when the pointer moves from a pane body onto the composer.
Its `dragleave` guard never fires for moves that stay inside the host. This must hold even when the
composer refuses the drop (compacting, D9), so the yield is decided by the host, not by the
composer's `preventDefault`.

## Scope references

- swe/features/composer-path-drop.md § Public contract 3 (zone marker), 4 (Precedence)
- swe/grills/drag-file-into-composer.md D4, D9, D18
- packages/web-client/src/hooks/use-external-pane-drop.ts (`paneDropProps`/`PANE_DROP_ATTR`
  pattern, `outcomeAt`, `onDragOver`, `onDrop`)
- packages/web-client/src/features/workspace/TabPanelHost.tsx

## What to build

- A composer drop-zone marker, written once: `composerDropProps()` spreading a `data-composer-drop`
  attribute (exact name is this task's call; follow the single-definition rule documented on
  `PANE_DROP_ATTR`). It lives beside `paneDropProps` or in `external-drag.ts`.
- A pure predicate, unit-tested:
  `yieldsToComposer(types: readonly string[], targetInsideComposer: boolean) → boolean` =
  `targetInsideComposer && hasPathRef(types)`.
- `useExternalPaneDrop`:
  - On `dragover`, when the event target is inside a marked zone (`closest(...)`) and the predicate
    holds, set `preview = null` and return **without** `preventDefault`.
  - On `drop`, the same check returns without acting.
  - The no-op is computed per event, so moving back onto the pane body resumes previewing.

## Out of scope

- The composer's own handlers and affordance (task-005). The marker is applied to the composer card
  in task-005. For this task's manual check, a temporary marker is acceptable, or the check runs
  after task-005 is wired.

## Acceptance criteria

- [ ] `yieldsToComposer`: `true` only for inside + ref; `false` for inside without ref (chat row,
      timeline link), and for outside with ref
- [ ] Hook logic (by review against the predicate): no preview and no `preventDefault` while
      yielding; preview recomputed on re-entering a pane body
- [ ] Regression: chat-row and timeline-link drags over a pane (including over the composer area)
      still preview and open or split

## Test / verification plan

- Tests next to the predicate's module (`external-drag.test.ts` or a new
  `use-external-pane-drop.test.ts` driving the exported predicate); `npx vitest run <file>`
- `npm run build:web-client`, `npm run typecheck`; `npx oxfmt` on changed files
- Manual regression on the dev stack (after task-005, or with a temporary marker)
