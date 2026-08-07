# Task 002 — Replace throwaway pages with the real screen components — Summary

- **Sprint:** sprint-029-final-app-shell
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Note: by the time this task started, `LivePages.tsx` had already been deleted
(as part of a separate cleanup pass removing hasty sprint-023/024
scaffolding), so this task **creates** the real live pages fresh rather than
replacing an existing throwaway file — same end goal, simpler starting point.

- **`packages/app/src/router/screen-adapters.ts`** (new): pure adapter
  functions mapping live daemon hooks into the prop contracts of the real,
  already-built screen components:
  - `toOpenProjectContext(host)` → `HomeScreen`'s `OpenProjectContext`.
  - `toHostSessions(agents, host)` → `SessionsScreen`'s `HostSessions[]`
    (single-host projection, empty array when disconnected).
  - `scheduleToRecord(schedule)` + `toHostSchedules(schedules, agents, host,
    loading)` → `SchedulesScreen`'s `HostSchedules[]`. Maps the nav-hooks
    `Schedule` RPC shape (`cron`/`everyMs`, `target.type: "agent"|"new_agent"`)
    to the cross-host screen model's `ScheduleRecord` (`cadence: {type: cron|
    every|once}`, `target.type: "agent"|"new-agent"`, derived `status`).
  - `detectOsFamily(userAgent?)` → `SettingsScreen`'s `os: OsFamily`.
- **`packages/app/src/router/LivePages.tsx`** (new): `LiveHomePage`,
  `LiveSessionsPage`, `LiveSchedulesPage`, `LiveSettingsPage` — each renders
  the real screen component (`HomeScreen`/`SessionsScreen`/`SchedulesScreen`/
  `SettingsScreen`), fed by the adapters above plus existing live hooks
  (`useConnectionStatus`, `useAgentDirectory`, `useSchedulesQuery`,
  `useClient`), with real `react-router` navigation callbacks
  (`onTilePress`, `onSelectSession`, `onNewSchedule`, `onNavigate`).
  A small local `useViewportWidth()` hook (resize-listening) feeds the
  width-dependent tile/settings layouts.
- **`routes.tsx`**: swapped the `PlaceholderScreen` entries for `/`,
  `/open-project`, `/sessions`, `/schedules`, `/settings`, `/settings/:section`,
  and `/h/:serverId` to the new `Live*Page` components. `/new` and the
  workspace/agent routes remain placeholders (task-003/out of scope).
- **`index.ts`**: re-exported the four new pages.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/router/screen-adapters.ts` | created |
| `packages/app/src/router/screen-adapters.test.ts` | created — 16 tests |
| `packages/app/src/router/LivePages.tsx` | created |
| `packages/app/src/router/routes.tsx` | modified — real pages wired in |
| `packages/app/src/router/index.ts` | modified — exports |

## How it satisfies the scope

- ✅ Adapter functions colocated in `screen-adapters.ts` with dedicated Vitest
  tests (16 tests: empty/connecting/online/error host states, agent→row
  mapping, schedule cadence/target/status mapping, OS detection).
- ✅ `toHostRuntimeSnapshots` was **not** duplicated — `LiveSettingsPage`
  imports `connectionToHostSnapshots` from task-001's `shell-adapters.ts`.
- ✅ Router renders the real screen components — verified by grep (no
  `PlaceholderScreen` markup remains for Home/Sessions/Schedules/Settings).
- ✅ `npx tsc -b packages/app` clean; full `npm test` green (111 files / 1490
  tests, 16 new).
- ✅ Visual smoke check (Docker Chrome screenshots against the live dev
  server + daemon): Home shows the real tile grid ("Add a project"/"Import
  session"/"Setup providers", "Pair device" correctly hidden for a
  non-local-embedded host); Sessions shows the real empty state ("No
  sessions yet"); Schedules shows the real Active/Ended filter + "New
  schedule" button + empty state; Settings shows the real sidebar
  (General/Appearance/Diagnostics/About — desktop-only sections correctly
  excluded since `isDesktop={false}`) and the General section content.

## Build & test results

```
$ npx tsc -b packages/app
(no output — clean)

$ npm test
 Test Files  111 passed (111)
      Tests  1490 passed (1490)
```

## Acceptance criteria
- [x] Router renders the real screen components; grep confirms no remaining
      hand-rolled placeholder markup for these four screens.
- [x] Adapter functions have dedicated Vitest test files covering
      empty/populated/error connection states — `screen-adapters.test.ts`,
      16 passing tests.
- [x] `npx tsc -b packages/app` clean; full `npm test` green.
- [x] Visual smoke check: Home/Sessions/Schedules/Settings show the polished
      UI, driven by live connection/session-store state — verified via
      screenshots.

## Follow-ups / TODO(verify)
- `LiveSessionsPage.onSelectSession` navigates to `routes.agent(serverId,
  agentId)`, which currently resolves to a `PlaceholderScreen` (task-003 will
  make this land in the real workspace). The `WorkspaceOpenIntent` value is
  constructed but not yet consumed — left as a documented no-op pending
  task-003's workspace-open-intent wiring.
- `LiveSchedulesPage.onSelect`/`onNewSchedule` are stubs — no schedule
  detail/creation UI exists yet anywhere in the built component set; out of
  scope for sprint-029 (not listed in any task file). `onNewSchedule`
  currently redirects to `/new` as a placeholder action.
- `LiveSettingsPage` hardcodes `isDesktop={false}`/`isElectron={false}` (this
  app currently only targets the web/browser build; Electron-specific
  sections will need real detection once the sprint-033 desktop shell
  exists) and `daemonMode="remote-only"` (no "embedded daemon" concept exists
  in this single-connection dev setup yet).
- `scheduleToRecord`'s cadence mapping defaults to `{ type: "once" }` when a
  schedule has neither `cron` nor `everyMs` set, using `nextRunAt` (or "now")
  as the `at` timestamp — a reasonable fallback per the `Schedule`/
  `ScheduleRecord` shapes, but daemon-side schedule creation doesn't
  currently exercise this path (schedules RPCs are still stubs returning
  empty arrays in `dev-bootstrap.ts`).
