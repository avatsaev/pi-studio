# Task 001 — Route grammar, app shell, provider stack, boot resolver

- **Sprint:** sprint-014-app-navigation-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-012, host runtime + session context); sprint-013 (chrome primitives)

## Goal
Implement the navigation skeleton: the route grammar, the root provider stack + app shell, route guards,
and the startup boot resolver.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Routing technology, § Route map, § Behavior
  (boot resolver, routing↔runtime wiring), § Global navigation shell
- `clean-room-scope/architecture/client-app-runtime.md`

## What to build
- The route grammar module (paths, slug enumerations, `?open=` intent, URL-safe encoders) and the file-
  based route tree for every documented path.
- The root provider stack (gesture/query/safe-area/keyboard/portal/bottom-sheet → runtime providers →
  app shell) and the single headerless stack.
- Route guards: `h/*` self-guard on store-ready + known-host validation; store-ready latch.
- Boot resolver at `/`: remembered workspace → online host → welcome (after give-up) → splash; startup
  splash + (desktop) splash error screen with logs/retry.
- Chrome gating (sidebar only on known-host routes) and the always-mounted overlay singletons host points.

## Out of scope
- Onboarding/pairing (task-002); home/sessions/new-workspace (task-003); settings/projects/sidebar
  (task-004).

## Acceptance criteria
- [ ] Every documented route resolves with correct params; unknown `serverId` redirects per the rules.
- [ ] The boot resolver routes to remembered workspace / online host / welcome and shows the splash
      meanwhile.
- [ ] `h/*` routes show the splash until store-ready; the store-ready flag latches.

## Test / verification plan
- Tests: route-grammar encode/decode + slug normalization; boot-resolver decision table; known-host
  guard redirect.

## Notes
- Exact compact give-up timeout is TODO(verify).
