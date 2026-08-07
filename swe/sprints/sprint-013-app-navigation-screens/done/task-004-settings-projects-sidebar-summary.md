# Task 004 — Settings IA, projects screens, left-sidebar shell — Summary

- **Sprint:** sprint-013-app-navigation-screens
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented settings view-model resolution, sidebar groups/items, host picker ordering, daemon-mode toggle
warning model, permissions/shortcuts/diagnostics helpers, projects list/settings models, and left-sidebar
shell behavior.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/screens/settings.ts` | created settings layout/view resolver, app/host sidebar items, host picker, daemon toggle, permission/shortcut/diagnostic helpers |
| `packages/app/src/screens/projects-settings.ts` | created projects list states, editable project resolution, revision-preserving config edit helpers |
| `packages/app/src/screens/sidebar.ts` | created sidebar mode, edge-swipe gating, workspace grouping, footer actions |
| `packages/app/src/screens/settings-sidebar.test.ts` | added 18 tests |
| `packages/app/src/screens/index.ts` | exports settings/projects/sidebar modules |

## How it satisfies the scope

- Settings root resolves differently for wide vs compact: wide defaults to General with replace-nav and
  320px sidebar; compact resolves to root list with push-nav.
- Desktop-only sections are filtered off non-desktop; host picker lists local embedded host first and
  always includes Add host.
- Host settings items include Provider Usage when the host advertises `providerUsageList`.
- Settings → Daemon toggle model warns before switching from embedded to remote-only when the embedded
  daemon is the only host.
- Permissions map OS permission states to request/open-settings/no-op actions.
- Shortcuts are listed from the registry and formatted per OS.
- Diagnostics report bundles app version, route, and host connection summaries.
- Projects list handles loading/empty/list plus per-host error banners; per-project config edits retain
  revision and update metadata/lifecycle sections.
- Sidebar chrome is gated by known host + store-ready, pinned on wide, overlay on compact, hidden in focus
  mode; edge-swipe uses leftmost 32px and horizontal drag; host switching preserves equivalent route.

## Build & test results

```
$ npx vitest run packages/app/src/screens/settings-sidebar.test.ts
 ✓ packages/app/src/screens/settings-sidebar.test.ts (18 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success
```

## Acceptance criteria

- [x] Settings wide/compact layouts and desktop-only filtering implemented.
- [x] Projects list + revision-based per-project config edit helpers implemented.
- [x] Sidebar gating, compact edge-swipe, wide pinning, focus-mode hide, and host-switch preservation tested.
- [x] Language/shortcuts/permissions/diagnostics/provider-usage view-model support implemented.
- [x] Settings → Daemon toggle warns before disabling the only embedded host.

## Follow-ups / TODO(verify)

- Full project-settings toolbar/menu actions and host connection-row actions remain TODO(verify).
- Actual Settings UI rendering will consume these view models when the React Native screen layer lands.
