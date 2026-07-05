# Task 002 — Pane/split model, layout store & web DnD splits — Summary

- **Sprint:** sprint-014-workspace-shell
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented a pure workspace split tree, tab operations, focus/focus-restore behavior, per-client layout
persistence abstraction, mounted-tab keepalive LRU, and web-only drag/drop split helpers.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/workspace/layout.ts` | created pane/group tree types and split/tab/focus/resize operations |
| `packages/app/src/workspace/layout-store.ts` | created per-client persisted layout store abstraction |
| `packages/app/src/workspace/keepalive.ts` | created mounted-tab LRU and mounted-hidden state helpers |
| `packages/app/src/workspace/dnd.ts` | created web-only split support and drop-position helpers |
| `packages/app/src/workspace/layout.test.ts` | added 12 tests |
| `packages/app/src/workspace/index.ts` | exports task 002 modules |

## How it satisfies the scope

- The split model supports panes/groups, focused pane, parent-tab map, single-pane default, active-tab
  derivation, tab open/child/background/close/focus/retarget/reorder operations, split/move/collapse, and
  clamped persisted resize proportions.
- Split depth is capped at 4 and split support is gated to non-compact web; non-web/compact callers can hide
  split actions from `supportsPaneSplits`.
- Empty splits can seed a draft tab.
- Focus restoration uses an explicit token for modal/popover transient unfocus.
- Mounted-tab LRU caps warm mounted tabs at 3 and models active/mounted-hidden/unmounted states.
- Drag/drop helpers classify edge drops as pane splits and center drops as reorder/move previews.

## Build & test results

```
$ npx vitest run packages/app/src/workspace/layout.test.ts
 ✓ packages/app/src/workspace/layout.test.ts (12 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success

$ npm run build
 success
```

## Acceptance criteria

- [x] Web split helpers support reorder/move/edge split decisions up to depth 4; non-web/mobile split support is false.
- [x] Mounted-tab LRU keeps ≤3 tabs warm with hidden pointer-events disabled.
- [x] Focus restoration token clears after a matching restore; resize proportions persist via the layout store.

## Follow-ups / TODO(verify)

- The actual recursive React/Web split container and visual drag overlay will consume these pure contracts in
  the UI runtime; this task provides node-testable split/store behavior.
- Exact focus-mode pane rendering remains TODO(verify) per scope.
