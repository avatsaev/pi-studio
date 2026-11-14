# Task 001 — Host core: install mechanism, browser host, `app` and `storage`

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host), packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-092

## Goal
Introduce the host object, the way it is installed, a browser implementation, and its first two members: app identity and storage.

## Context / why
The host is the single seam between the application and its shell. It is a module-level singleton because most callers are not React code (stores, persistence helpers). Members are added one task at a time; each task adds the member, the browser implementation and the call-site migration together.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Shape, § Member contracts (`app`, `storage`), § Installation, § Browser host
- `packages/workbench/src/host/` (new)
- `packages/workbench/src/shell/WorkbenchProvider.tsx`
- `packages/workbench/src/features/connection/ConnectionBar.tsx` (`__BRAND_TITLE__`, `__APP_VERSION__`)
- `packages/workbench/src/lib/pane-layout-persistence.ts`, `packages/workbench/src/features/chat/todos/agent-todos-store.ts` (`localStorageKvStore`)
- `packages/web-client/src/{main.tsx,vite-env.d.ts}`

## What to build
- Create the host module: the `WorkbenchHost` type (members `app` and `storage` for now), `installHost(host)`, `getHost()` (falls back to a lazily created browser host when nothing is installed), and `createBrowserHost(overrides)`.
- `WorkbenchProvider` takes an optional `host` prop and installs it synchronously during its first render, before any child renders. A second, different host is ignored with one development-only warning. Installation is idempotent under StrictMode double rendering.
- `WorkbenchProvider` passes `host.storage` to `ThemeBoundary`'s `store` prop.
- `app`: `ConnectionBar` reads the title and version from `getHost().app`. Delete the workbench's ambient `__BRAND_TITLE__`/`__APP_VERSION__` declarations; they live only in `web-client`, which passes them through `createBrowserHost({ app })`.
- `storage`: pane-layout persistence and the agent-todos store read and write through `getHost().storage`. The todos store is created at module load, before a host is installed, so it must resolve the host at call time, not capture it.
- Tests: install semantics (first wins, same host twice is silent); pane-layout save and load round-trip through an in-memory host; the todos collapse state round-trips through it.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Other host members (tasks 002–006).
- Exporting host types from the package root (sprint 094).

## Acceptance criteria
- [ ] With no `host` prop the browser host is used and behaviour is unchanged.
- [ ] With an in-memory host, nothing is written to `localStorage` by pane layout, todos or appearance.
- [ ] Storage keys and value formats are unchanged (`pi-studio-pane-layout`, `pi-studio-agent-todos-ui`, `pi-studio-appearance`).
- [ ] The connection bar shows the title and version supplied by the host.
- [ ] No workbench source references `__APP_VERSION__` or `__BRAND_TITLE__`.
- [ ] All tests pass; `npm run build` passes.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/host packages/workbench/src/lib packages/workbench/src/features/chat/todos`
- `npm run build:web-client`; reload the page and confirm the saved layout and theme survive.

## Notes
- `KeyValueStore` is synchronous by contract. Do not make it asynchronous: stores read it during initialisation.
- The development-only warning must use an inline `process.env.NODE_ENV === "production"` check; a helper function did not fold away in a consumer production build (learned in sprint 089).
