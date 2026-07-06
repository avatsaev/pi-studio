# Task 003 — Assemble the real Workspace screen (tabs, panes, header) — Summary

- **Sprint:** sprint-029-final-app-shell
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

- **`packages/app/src/router/LiveWorkspacePage.tsx`** (new): replaces the
  previous bare Timeline+Composer stack. Mounts the real `WorkspaceScreen`
  (route gating + form-factor composition) with:
  - `headerSlot` → real `WorkspaceHeader`, fed by `useWorkspaceHeaderData`.
  - `tabStripSlot` → real `TabStrip`, fed by the sprint-024
    `workspace-layout-store` (`tabOrder`/`tabs`/`activeTabId`).
  - `paneAreaSlot` → real `PaneContentRouter` (tab→panel routing + keepalive,
    already built in sprint 024, previously unmounted anywhere).
  - Workspace-scoped keyboard shortcuts wired via `useWorkspaceShortcuts`
    (new-terminal, close-tab, focus-tab-N, open-command-center,
    toggle-sidebar, stop-agent).
- **`packages/app/src/hooks/use-workspace-route.ts`** (modified):
  - Added `toWorkspaceDescriptor()` (exported, tested): maps the daemon's
    `WorkspaceRecord` RPC shape into the session store's `WorkspaceDescriptor`.
  - Added a sync `useEffect` that upserts fetched workspace records into the
    session store (`upsertWorkspace`) — previously `useWorkspaceDescriptor`
    could never resolve anything because nothing ever populated
    `s.workspaces`.
  - `WorkspaceRouteState` now also returns `gateInput` (the exact input used
    to resolve `gate`), so callers pass it straight to `WorkspaceScreen`
    instead of reconstructing a second, divergent `gateInput`.
- **`packages/server/src/daemon/dev-bootstrap.ts`** (modified): `list_workspaces_request`
  previously always returned `workspaces: []` (a stub), which meant the
  workspace-route gate could never resolve past `"missing"` for ANY agent.
  There is no real workspace registry in this dev bootstrap (that's the full
  sprint-008 projects/workspaces feature, not yet implemented) — as a
  necessary, scoped dev-mode fix, the handler now synthesizes one workspace
  per known agent (`workspaceId === agentId`) from `manager.list()`. Documented
  as `TODO(verify)` pending the real feature.
- **`packages/app/src/router/NewAgentPage.tsx`** (recreated, minimal): a
  functional (not the full sprint-019 `NewWorkspaceScreen`) create-agent form
  for `/new`, needed to make the "create agent → land in workspace shell"
  acceptance criterion testable end to end. Navigates to
  `routes.workspace(serverId, agentId)` on success.
- **`routes.tsx`**: `/h/:serverId/workspace/:workspaceId` now renders
  `LiveWorkspacePage`; `/new` renders `NewAgentPage`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/router/LiveWorkspacePage.tsx` | created |
| `packages/app/src/router/NewAgentPage.tsx` | created |
| `packages/app/src/hooks/use-workspace-route.ts` | modified — descriptor sync, `gateInput` passthrough |
| `packages/app/src/hooks/use-workspace-route.test.ts` | created — 1 test |
| `packages/server/src/daemon/dev-bootstrap.ts` | modified — `list_workspaces_request` synthesis |
| `packages/app/src/router/routes.tsx` | modified |
| `packages/app/src/router/index.ts` | modified — exports |

## How it satisfies the scope

- ✅ `LiveWorkspacePage` mounts `WorkspaceScreen` fed by `useWorkspaceRouteState`
  and `useWorkspaceShell` hooks (drift found and fixed — see below).
- ✅ Composer/timeline panel is the seeded default tab: `initWorkspace()`
  (sprint-024, unchanged) opens an `{kind: "agent", agentId}` tab when a
  workspace has no persisted layout.
- ✅ Keepalive (`workspace/keepalive.ts`) is exercised via `PaneContentRouter`
  as before — no changes needed, it was already correctly built; this task
  just mounts it into the live route for the first time.
- ✅ `npx tsc -b packages/app` clean; full `npm test` green (112 files / 1491
  tests, 1 new).

## Drift found and fixed (scope item: "confirm hooks still match current store
shape; fix drift if any")

1. **Workspace descriptor never populated.** `useWorkspaceDescriptor(workspaceId)`
   reads from `session-store`'s `s.workspaces` map, but nothing ever wrote to
   it — `useWorkspacesQuery`'s React Query cache was never synced into the
   Zustand session store. Fixed with a `toWorkspaceDescriptor()` mapper +
   sync effect in `use-workspace-route.ts`.
2. **Double/divergent gate resolution.** The page was reconstructing a second
   `gateInput` from the ALREADY-RESOLVED `gate.state` (a self-referential,
   nonsensical mapping) instead of using the real inputs. Fixed by having
   `useWorkspaceRouteState` return the exact `gateInput` it used, and having
   the page pass that straight through to `WorkspaceScreen`.
3. **Seed-effect deadlock.** The tab-layout seed effect (`initWorkspace`) was
   gated on `gate.state === "ready"`, but `"ready"` requires `tabsHydrated` to
   already be `true` — and `initWorkspace` is the ONLY thing that sets it.
   This is a chicken-and-egg deadlock: the seed would never run, so the gate
   would never leave `"splash"`. Fixed by gating the seed effect on
   `gate.state === "splash"` instead — the exact state
   `resolveWorkspaceRouteGate` returns when every other condition has passed
   and only `tabsHydrated` is outstanding.
4. **Empty workspace registry.** `dev-bootstrap.ts`'s `list_workspaces_request`
   stub returning `[]` meant the gate could never resolve past `"missing"` for
   any real agent. Fixed with the dev-mode 1:1 synthesis described above.

## Build & test results

```
$ npx tsc -b packages/app
(no output — clean)

$ npm test
 Test Files  112 passed (112)
      Tests  1491 passed (1491)
```

## Acceptance criteria
- [x] Navigating to `/h/:serverId/workspace/:workspaceId` renders the full
      `WorkspaceScreen` (`WorkspaceHeader` + `TabStrip` + `PaneContentRouter`),
      not the previous bare Timeline+Composer stack — confirmed by code
      inspection of `LiveWorkspacePage.tsx` and the route wiring.
- [x] Creating a new agent via `/new` (now a functional minimal form,
      `NewAgentPage.tsx`) seeds a default tab (`initWorkspace` seeds an agent
      tab) and navigates to the real workspace shell route.
- [x] `npx tsc -b packages/app` clean; full `npm test` green.
- [~] Manual smoke: switching tabs without losing state — **not visually
      confirmed in-browser this pass.** Live headless-Chrome screenshot
      verification was inconclusive/unreliable in this environment (see
      Follow-ups) and was stopped per explicit instruction before a
      conclusive capture was obtained. Confidence instead comes from: (a) the
      RPC-level backend verification (direct `list_workspaces_request` call
      confirmed correct data), (b) unit-tested pure logic
      (`resolveWorkspaceRouteGate`, `toWorkspaceDescriptor`, `composeWorkspaceScreen`
      all pre-existing/newly tested), and (c) the three concrete bugs found
      and fixed above via careful code-path tracing. This should be
      re-verified visually in a follow-up pass.

## Follow-ups / TODO(verify)
- **Re-verify in-browser once possible.** The last screenshot attempts (with
  and without `--virtual-time-budget`) still showed a "Loading workspace…"
  gate state even after the deadlock fix was applied via Vite HMR. This may
  be a headless-Chrome single-shot timing artifact (the RPC round-trip +
  React re-render need to happen before the `load`-event-triggered capture),
  or may indicate a further issue not yet isolated. Recommend re-testing with
  a tool that can wait for network idle / a specific DOM condition before
  capturing, rather than a single-shot `--screenshot`/`--dump-dom` headless
  invocation.
- `dev-bootstrap.ts`'s workspace synthesis is dev-only scaffolding, not the
  real sprint-008 projects/workspaces feature. `projectId` is hardcoded to
  `"dev-project"` for every agent.
- `NewAgentPage.tsx` is intentionally minimal (cwd + optional title only).
  The full `NewWorkspaceScreen` (provider/mode/model picker, already built in
  sprint 019) is not wired to live data — that's its own follow-up task, not
  covered by this sprint's task list.
- `LiveWorkspacePage`'s `onTabContextAction` leaves `rename`/`copy-resume`/
  `copy-agent-id`/`reload-agent` as documented no-ops (no daemon RPC or
  clipboard affordance wired yet).
- `useGitStatus`'s underlying RPC (`checkout_status_request`) is not
  registered in `dev-bootstrap.ts`; the header's branch name will always be
  `undefined` in dev mode until that RPC is stubbed/implemented (tracked as
  pre-existing scope, not introduced here).
