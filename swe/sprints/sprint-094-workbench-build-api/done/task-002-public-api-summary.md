# Task 002 — Public API: entry exports, region guards and shell hooks — Summary

- **Sprint:** sprints/sprint-094-workbench-build-api
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`src/index.ts` is now the documented API: `Workbench`, `WorkbenchProvider` (+ props type), `WorkbenchBoot`, `WorkspaceShell`, regions `ConnectionBar`, `SessionList`, `PaneArea` (wraps `TabPanelHost`), `RightSidebar`, `StatusBar`, `OpenWorkspaceDialog`, `SettingsDialog` (lazy, own chunk); hooks `useConnection`, `useShellLayout` (`{left,right}` each `collapsed/width/toggle/resize`), `useSettingsDialog`; `createBrowserHost` and all host types. New `shell/context.ts` (`WorkbenchContext`, `useRequireWorkbench`, dev-only `warnOnce`); `WorkbenchProvider` provides the context; `shell/regions.tsx` guarded region wrappers; `shell/hooks.ts`. `WorkbenchBoot` now runs the boot hooks only in the first mounted instance (token released on unmount, so StrictMode re-claims) and warns once for a second; `Workbench` warns once when two are mounted.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/index.ts` | public API |
| `packages/workbench/src/shell/{context.ts,regions.tsx,hooks.ts}` | created |
| `packages/workbench/src/shell/{WorkbenchProvider,WorkbenchBoot,Workbench}.tsx` | context, single-boot, multi-instance warning |
| `packages/workbench/src/shell/public-api.test.ts` | created (11 tests) |
| `packages/workbench/AGENTS.md` | docs |

## How it satisfies the scope
`workbench-package.md` § Root entry (components, hooks, host) and § Error handling rows for "region outside provider", "WorkbenchBoot twice", "two Workbench instances". Region names `PaneArea`/`WorkspaceShell` used as specced; **still to be confirmed by the user before the first publish** (spec TODO).

Hook shape is covered by the type exports + typecheck rather than a render test: SSR in the Node test environment cannot drive zustand selectors (`getServerSnapshot` missing).

## Build & test results
```
$ npx vitest run packages/workbench/src/shell -> 11 passed
  (exact value-export list; 7 components and 3 hooks each throw "<name> must be rendered inside <WorkbenchProvider>" when rendered outside it)
$ npm run build -> OK; check-dist: dist 510 files, 2.21 MB, dynamic imports 17 (src 17); chunks/SettingsDialog-*.js separate
$ npm run typecheck -> OK; npm run lint -> exit 0; npm test -> 267 files / 3582 tests passed

Browser (web-client dev, dev daemon :6790, StrictMode): fresh load with ?connect=1#agent=<id> connects, boot ran once (deep link consumed, hash stripped), Settings dialog opens from its lazy chunk; no workbench warnings.
```

## Acceptance criteria
- [x] Every documented export exists; nothing undocumented is exported as a value (test).
- [x] Regions/hooks outside the provider throw a named error (test).
- [x] Second `WorkbenchBoot` is a no-op with one dev warning; two `Workbench` instances warn once.
- [x] `SettingsDialog` export keeps its own chunk.
- [x] web-client unchanged in behaviour (live check).
- [x] `docs/desktop-client-handoff.md`: final API rewrite is sprint 095 task-002; nothing it states became wrong here.

## Follow-ups / TODO(verify)
- Confirm the public names `PaneArea` and `WorkspaceShell` with the user before the first publish.
