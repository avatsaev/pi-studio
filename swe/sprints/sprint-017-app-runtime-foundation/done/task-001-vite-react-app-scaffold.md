# Task 001 — Vite + React app scaffold & build targets

- **Sprint:** sprint-017-app-runtime-foundation
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-012 (UI foundation logic), sprint-016 (feature-panel view models)

## Goal
Turn `packages/app` into a runnable **React 19 + Vite** DOM application with two build targets (web,
electron), replacing the throwaway `web/` preview harness with a real app entry.

## Scope references
- `clean-room-scope/architecture/design-system.md` § UI technology stack, § Module-selection policy
- `clean-room-scope/architecture/client-app-runtime.md` § Platform rules
- `clean-room-scope/features/desktop-app.md` (Electron loads the `VITE_TARGET=electron` bundle)

## What to build
- `packages/app/index.html`, `src/main.tsx` (React root), `vite.config.ts` with `@vitejs/plugin-react`.
- Install the DOM stack: `react`/`react-dom` 19, `vite` ^6, `@vitejs/plugin-react`, `react-router` ^7,
  `clsx`, `lucide-react`, `@floating-ui/react`, `@radix-ui/react-*` (dialog/dropdown-menu/tooltip/
  popover), `@dnd-kit/*`, `@tanstack/react-virtual`, `react-markdown`+`remark-gfm`, `zustand`,
  `@tanstack/react-query`. (Ask before installing; pin per design-system stack table.)
- Two build modes via `import.meta.env.VITE_TARGET` = `"web" | "electron"`; scripts `dev`, `build:web`,
  `build:electron`, `preview`. Keep `getIsElectron()` reading `VITE_TARGET`/`window` markers.
- A `getIsElectron()` helper + a guarded dynamic-import helper `loadElectronModule(path)` that no-ops
  (throws/returns null) on web so `*.electron.ts(x)` modules never enter the web chunk.
- Retire `web/serve.mjs` + `tsconfig.web-preview.json`; the Vite dev server replaces the preview.
- `tsconfig.json` updated for DOM libs + bundler resolution; keep the existing pure-TS `src/**` modules
  compiling (they are framework-agnostic and consumed by components in later sprints).

## Out of scope
- Theme→CSS bridge (task-002). Providers/stores (task-003). Router shell (task-004). Any screen UI.

## Acceptance criteria
- [ ] `npm --workspace @av-pi-studio/app run dev` serves a React app that mounts `#root`.
- [ ] `build:web` and `build:electron` both produce a bundle; `VITE_TARGET` selects the branch and
      Electron-only dynamic imports are absent from the web bundle.
- [ ] `getIsElectron()` returns false on web; the existing `src/**` view-model tests still pass.
- [ ] The old `web/` preview harness is removed and its role documented as replaced by `vite dev`.

## Test / verification plan
- `npx vitest run` (existing view-model suites stay green).
- Build both targets; grep the web bundle to confirm no electron-only module is inlined.

## Notes
- Do not rewrite the pure-TS view models; components in sprints 018–022 import them.
- TODO(verify): exact Vite electron integration (loadFile vs dev-server URL) is finalized in
  sprint-024/task-001; here only the build output + flag contract are needed.
