# Task 002 — Replace throwaway pages with the real screen components

## Why this task exists

`packages/app/src/router/LivePages.tsx` currently defines `LiveHomePage`,
`LiveSessionsPage`, `LiveSchedulesPage`, `LiveSettingsPage` as small hand-rolled
inline-styled components written quickly during sprint 023/024 to prove data
flow. The REAL screens already exist, fully built and tested, from sprints
012–016/019:

- `packages/app/src/components/screens/HomeScreen.tsx`
- `packages/app/src/components/screens/SessionsScreen.tsx`
- `packages/app/src/components/screens/SchedulesScreen.tsx`
- `packages/app/src/components/screens/SettingsScreen.tsx`

These expect Paseo-shaped multi-host props (`HostSessions[]`, `HostSchedules[]`,
`OpenProjectContext`, `HostRuntimeSnapshot[]`). This task writes the adapter
layer that maps our live daemon hooks (session store, nav hooks) into those
shapes, and swaps the router to render the real screens instead of the
placeholders.

## Reference

- `clean-room-scope/features/app-navigation-screens.md`
- Prop contracts: read each screen file's `*Props` interface directly.
- Live hooks already available: `packages/app/src/hooks/use-session-hooks.ts`,
  `use-nav-hooks.ts`, `use-explorer-hooks.ts`.

## Scope

1. Write pure adapter functions (one per screen, colocated in a new
   `packages/app/src/router/screen-adapters.ts`, each with Vitest tests):
   - `toHostSessions(agents, connectionState): HostSessions[]`
   - `toHostSchedules(schedules, connectionState): HostSchedules[]`
   - `toOpenProjectContext(...)` for `HomeScreen`
   - `toHostRuntimeSnapshots(connectionState): HostRuntimeSnapshot[]` (reuse from
     task-001 if already extracted; do not duplicate — import it).
2. Replace `LiveHomePage`/`LiveSessionsPage`/`LiveSchedulesPage`/`LiveSettingsPage`
   in `LivePages.tsx` (or split into per-screen files under `router/`) to render
   the REAL `HomeScreen`/`SessionsScreen`/`SchedulesScreen`/`SettingsScreen`,
   fed via the new adapters and existing live hooks, with real navigation
   callbacks (`onTilePress`, `onSelect`, `onNavigate`, etc.) wired to
   `react-router`'s `useNavigate()`.
3. Remove now-dead inline-styled placeholder JSX from `LivePages.tsx`.

## Out of scope

- Workspace screen (task-003).
- Boot gating (task-004).

## Acceptance

- Router renders the real screen components; `grep` confirms no remaining
  hand-rolled placeholder markup for these four screens.
- Adapter functions have dedicated Vitest test files covering empty/populated/
  error connection states.
- `npx tsc -b packages/app` clean; full `npm test` green.
- Visual smoke check: Home/Sessions/Schedules/Settings show the polished,
  previously-only-demo-tested UI, now driven by the live mock-provider agent
  created earlier in this session.
