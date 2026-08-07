# Task 003 — Open-project screen & new-workspace screen — Summary

- **Sprint:** sprint-013-app-navigation-screens
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented pure models for the open-project/home screen and new-workspace creation flow: tile gating,
local-host detection, desktop sidebar-on-mount behavior, responsive tile layout, query parsing,
project/ref picker filtering, create-agent preference defaults, and empty-vs-prompt submit branching.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/screens/open-project.ts` | created open-project tile model and layout/sidebar helpers |
| `packages/app/src/screens/new-workspace.ts` | created query parser, project/ref picker helpers, create-agent defaults, submit branching |
| `packages/app/src/screens/index.ts` | created screens barrel export |
| `packages/app/src/screens/open-project-new-workspace.test.ts` | added 16 tests |
| `packages/app/src/index.ts` | exports screens module |

## How it satisfies the scope

- Open-project is one parameterized model for global `/open-project` and per-host
  `/h/[serverId]/open-project` contexts.
- Tile catalog includes Add project, Import session, Setup providers, and Pair device; Pair device is
  visible only for a local embedded/localhost host.
- Desktop non-compact open-project mount returns `true` for opening the sidebar.
- New-workspace reads host from `?serverId=` query params, never from a path segment.
- Worktree-capable project filtering and ref search cover the picker behavior.
- New-agent defaults are derived from create-agent preferences (provider/model/mode/thinking/features,
  favorites, isolation default).
- Submit empty creates an empty worktree and navigates to workspace; submit with text/attachments ensures
  a worktree, stages a pending draft, and navigates to a draft tab.

## Build & test results

```
$ npx vitest run packages/app/src/screens/open-project-new-workspace.test.ts
 ✓ packages/app/src/screens/open-project-new-workspace.test.ts (16 tests) 3ms

$ npm --workspace @av-pi-studio/app run typecheck
 success
```

## Acceptance criteria

- [x] Open-project shows tile set with Pair device only on local hosts and opens sidebar on desktop.
- [x] Global and per-host route forms use the same parameterized model.
- [x] New-workspace resolves `serverId` from query params, creates a worktree, stages draft when needed,
      and navigates correctly.
- [x] Pickers filter worktree-capable projects/refs; new-agent defaults come from preferences.

## Follow-ups / TODO(verify)

- Composer footer rendering is stubbed until sprint-015 provides the composer surface.
- Actual image-drop plumbing is deferred to composer/runtime integration.
