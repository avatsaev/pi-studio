# Task 001 — Host core: install mechanism, browser host, `app` and `storage` — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
New `packages/workbench/src/host/`: `WorkbenchHost` type (`app`, `storage`), `installHost`/`getHost`/`onHostInstalled`/`resetHostForTests`, `createBrowserHost({ app })` (storage = `localStorageKvStore`). `WorkbenchProvider` takes `host?`, installs it in a `useState` initializer (synchronous, first render, idempotent under StrictMode; a later different host triggers the one dev-only warning via `installHost`) and passes `host.storage` to `ThemeBoundary`; `Workbench` forwards `host`. `ConnectionBar` reads title/version from `getHost().app` (empty version hidden). Pane-layout persistence reads/writes `getHost().storage` at call time; the agent-todos store gets a call-time storage proxy and re-reads its collapse state from the installed host through `onHostInstalled` (it is created at module load, before installation). The workbench's `__APP_VERSION__`/`__BRAND_TITLE__` declarations moved to a new `web-client/src/vite-env.d.ts`; `main.tsx` passes them via `createBrowserHost({ app })`. Added `src/env.d.ts` (`process.env.NODE_ENV`, inline dev check).

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,install,browser-host,index}.ts` | created |
| `packages/workbench/src/host/host.test.ts` | created (5 tests) |
| `packages/workbench/src/env.d.ts` | created |
| `packages/workbench/src/shell/{Workbench,WorkbenchProvider}.tsx` | host prop + install |
| `packages/workbench/src/features/connection/ConnectionBar.tsx` | app identity from host |
| `packages/workbench/src/lib/pane-layout-persistence.ts` | storage via host |
| `packages/workbench/src/features/chat/todos/agent-todos-store.ts` | storage via host + reload on install |
| `packages/workbench/src/vite-env.d.ts` | identity constants removed |
| `packages/workbench/src/index.ts` | exports createBrowserHost + host types |
| `packages/web-client/src/{main.tsx,vite-env.d.ts}` | builds the browser host |
| `packages/workbench/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § Shape (`app`, `storage`), § Member contracts, § Installation, § Browser host. Deviation: `createBrowserHost` and the host types are exported from the package root now (task said sprint 094) because `web-client` must construct the host with its build-time identity; sprint 094 keeps them in the public API anyway.

## Build & test results
```
$ npx vitest run packages/workbench/src/host packages/workbench/src/lib packages/workbench/src/features/chat/todos
16 files / 122 tests passed
$ npm run build -> OK; npm run typecheck -> OK; npx oxlint -> exit 0; oxfmt --check changed files -> clean
$ npx vitest run packages/workbench packages/web-client -> 110 files / 1458 tests passed

Browser (vite dev :5394 + dev daemon :6790): connection bar shows "Pi-Studio" + "v0.0.117" from the host;
pane layout (two panes, file tabs) restored after reload; appearance read through host storage:
localStorage pi-studio-appearance={"mode":"light"} -> --pi-color-surface0 #ffffff after reload, removed -> #181B1A.
```

## Acceptance criteria
- [x] No `host` prop → browser host, behaviour unchanged (fallback path; web-client passes a browser host).
- [x] In-memory host: pane layout and todos write nothing to `localStorage` (tests assert `setItem` never called); appearance reads/writes go to `host.storage` via `ThemeBoundary store`.
- [x] Storage keys and formats unchanged.
- [x] The connection bar shows the host's title and version.
- [x] No workbench source references `__APP_VERSION__` or `__BRAND_TITLE__`.
- [x] All tests pass; `npm run build` passes.
- [x] `docs/desktop-client-handoff.md`: host section now names the two existing members, the synchronous-storage rule and how the host is installed.

## Follow-ups / TODO(verify)
- The todos store still performs one `localStorage` *read* at module load (through the fallback host) before the real host is installed; it is discarded on install. No write ever reaches `localStorage` with a non-browser host.
