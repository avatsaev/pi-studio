# Task 003 — Workspace screen composition, headers & actions — Summary

- **Sprint:** sprint-014-workspace-shell
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented pure composition/header/action models for the workspace screen, desktop tab strip sizing/menu
helpers, scripts/open-in-editor models, middle-click close detection, and bulk-close planning.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/workspace/composition.ts` | created screen composition, primary header, scripts, open-in-editor, screen shell helpers |
| `packages/app/src/workspace/tab-strip.ts` | created width distribution, tab context menu, trailing action helpers |
| `packages/app/src/workspace/bulk-close.ts` | created bulk close classification/confirmation/plan helpers |
| `packages/app/src/workspace/composition.test.ts` | added 9 tests |
| `packages/app/src/workspace/index.ts` | exports task 003 modules |

## How it satisfies the scope

- Top-level screen composition models primary header visibility, explorer-sidebar placement, tab-strip mode,
  pane content, and root import/rename modals.
- Header model includes sidebar toggle, title/branch/subtitle, workspace menu items, scripts, open-in-editor,
  git/non-git explorer action, mobile/narrow icon-only behavior, and diff-stat badges.
- Scripts model distinguishes Start vs View and desktop split vs mobile ghost presentation.
- Open-in-editor model is web-only with absolute cwd and includes editor/GitHub/active-file targets.
- Desktop tab strip distributes widths between icon-min and 200px, enables scroll below the minimum, builds
  desktop/mobile context menus, exposes trailing new/split/browser actions, and supports web middle-click close.
- Bulk close classifies root agents for archive, subagent tabs for local close, terminals for server close,
  and local-only tabs; confirmation wording reflects archive vs close semantics.

## Build & test results

```
$ npx vitest run packages/app/src/workspace/composition.test.ts
 ✓ packages/app/src/workspace/composition.test.ts (9 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success

$ npm run build
 success
```

## Acceptance criteria

- [x] Header shows branch switcher/menu/right-cluster actions per git/non-git and form factor.
- [x] Desktop tab strip width distribution, context menu, middle-click close, and trailing actions are modeled.
- [x] Bulk close archives agents, closes terminals server-side, and uses correct confirmation wording.

## Follow-ups / TODO(verify)

- Scripts-start RPC and service-URL resolution remain TODO(verify) per scope; this task models the UI action
  rows and target outcomes that later client integration will call.
- Actual React Native rendering will consume these pure view models in a later UI layer.
