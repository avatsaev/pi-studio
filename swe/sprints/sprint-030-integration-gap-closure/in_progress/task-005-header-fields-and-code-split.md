# Task 005 — Workspace header live fields & bundle code-splitting

- **Sprint:** sprint-030-integration-gap-closure
- **Status:** in_progress
- **Estimated size:** M
- **Depends on:** task-001..004; sprint 031 (setup panel data), sprint 009 (service proxy)

## Goal
Replace the hardcoded workspace-header inputs in `LiveWorkspacePage.tsx`
(`scriptsCount: 0`, `setupAvailable: false`, `isElectron: false`) with live values, and address
the single-705kB bundle warning from `npm run build:web` by code-splitting.

## Scope references
- `swe/features/workspace-ui.md` § header
- `swe/features/service-proxy.md` (scripts count / setup availability)
- `swe/architecture/client-app-runtime.md` § electron marker (`getIsElectron()`)

## What to build
- **Live header fields**: derive `scriptsCount` and `setupAvailable` from project/service-proxy
  data (see sprint 031 setup-panel data); set `isElectron` from the runtime `getIsElectron()` marker.
- **Code-splitting**: lazy-load heavy panes (terminal/xterm, browser pane, diff viewer, markdown)
  behind `React.lazy` + Suspense; add `manualChunks` in `vite.config.ts` for vendor bundles
  (react-markdown, xterm, framer-motion). Target: main chunk under the 500 kB warning threshold.

## Acceptance criteria
- [ ] Header shows real scripts count / setup availability / electron state.
- [ ] `npm run build:web` no longer emits the >500 kB chunk warning for the main entry.
- [ ] Lazy panes render via Suspense fallback (skeleton) without regressions.

## Test / verification plan
- Unit: header input derivation from project/proxy data.
- Build: `npm run build:web` → confirm chunk sizes and no warning.
- `npx vitest run`; manual smoke of lazy-loaded panes.

## Progress (completed, verified green)
The two independently-unblocked parts of this task are implemented and passing:
- **Bundle code-splitting** — `packages/app/vite.config.ts` now uses `rollupOptions.output.manualChunks`
  to split vendor libs (react, radix/floating-ui, react-markdown/remark, framer-motion, tanstack,
  dnd-kit, lucide). Heavy panes (Terminal/Browser/FilePreview/Git) are `React.lazy` in
  `PaneContentRouter.tsx` (and `DemoPage.tsx`) under the existing `<Suspense>` fallbacks.
  Result: main entry chunk **705 kB → ~200 kB**, and `npm run build:web` no longer emits the
  >500 kB warning (verified) and shows no dynamic/static mixed-import advisories.
- **Real `isElectron`** — `LiveWorkspacePage` header now uses `getIsElectron()` instead of `false`.
- Full suite green: `npx vitest run packages/app` → 75 files / 1286 tests passing.

## Blocker
The acceptance criterion **"Header shows real scripts count / setup availability"** cannot be
honestly satisfied within sprint-030. `scriptsCount` / `setupAvailable` require per-workspace
scripts/setup data exposed to the client, which is **sprint-031 task-003 ("Setup panel & workspace
scripts surface")** — explicitly listed in this task's `Depends on:`.

Investigation confirmed there is no existing client-facing source:
- `ProjectRecord` (from `list_projects_request`) does not include `scripts`/`setup`.
- The completed sprint-009 service-proxy only tracks *running* service scripts in an in-memory
  port registry; it exposes no "list configured scripts for a workspace" RPC.
- The scripts config lives in per-project `pi-studio.json` (sprint-003); surfacing it over the
  wire is precisely s031/t003. Implementing it here would mean building another sprint's task,
  which the clean-room-implement rules forbid ("Do not implement future tasks").

**Resolution:** run sprint-031 (task-003 in particular) first, then finish this task by deriving
`scriptsCount`/`setupAvailable` from that new data source. `scriptsCount: 0` / `setupAvailable: false`
remain the correct current values until then.

Leaving this task in `in_progress/` per the loop rules.
