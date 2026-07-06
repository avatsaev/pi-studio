# Task 001 — Vite + React app scaffold & build targets — Summary

- **Sprint:** sprint-017-app-runtime-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Transformed `packages/app` into a runnable React 19 + Vite DOM application with two build targets
(web, electron). Installed the full DOM stack (React 19, Vite 6, react-router 7, radix-ui, dnd-kit,
tanstack, zustand, framer-motion, lucide-react, react-markdown, floating-ui, clsx). Created
`index.html`, `src/main.tsx`, `src/app.tsx` as the React entry. Updated `getIsElectron()` to check
`import.meta.env.VITE_TARGET` build-time flag + runtime markers. Added `assertElectronContext()`
guard helper. Retired the old `web/` preview harness.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/index.html` | created — Vite HTML entry |
| `packages/app/vite.config.ts` | created — Vite config with react plugin, workspace aliases, build targets |
| `packages/app/src/main.tsx` | created — React root mount |
| `packages/app/src/app.tsx` | created — minimal App shell component |
| `packages/app/src/platform/gating.ts` | modified — `getIsElectron()` now checks VITE_TARGET + added `assertElectronContext()` |
| `packages/app/src/platform/index.ts` | modified — exports `assertElectronContext` |
| `packages/app/tsconfig.json` | modified — added DOM/DOM.Iterable libs, jsx: react-jsx, .tsx includes |
| `packages/app/package.json` | modified — new scripts (dev/build:web/build:electron/preview), new deps |
| `packages/app/web/` | **removed** — old preview harness replaced by `vite dev` |
| `packages/app/tsconfig.web-preview.json` | **removed** |

## How it satisfies the scope
- `design-system.md` § UI technology stack: all pinned libraries installed at matching version floors.
- `design-system.md` § Module-selection policy: `getIsElectron()` reads VITE_TARGET, guarded dynamic
  import pattern documented via `assertElectronContext()`.
- `client-app-runtime.md` § Platform rules: build-time flag + runtime marker + dynamic import pattern
  all implemented.

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
✓ success (0 errors)

$ npx vitest run
Test Files  88 passed (88)
     Tests  990 passed (990)

$ npm --workspace @av-pi-studio/app run build:web
✓ built in 443ms (194.71 kB JS)

$ npm --workspace @av-pi-studio/app run build:electron
✓ built in 423ms (194.71 kB JS)

$ grep -c 'electron' dist/web/assets/index-*.js
0 (electron-only code absent from web bundle)
```

## Acceptance criteria
- [x] `npm --workspace @av-pi-studio/app run dev` serves a React app that mounts `#root`.
- [x] `build:web` and `build:electron` both produce a bundle; `VITE_TARGET` selects the branch and
      Electron-only dynamic imports are absent from the web bundle.
- [x] `getIsElectron()` returns false on web; the existing `src/**` view-model tests still pass (990/990).
- [x] The old `web/` preview harness is removed and its role replaced by `vite dev`.

## Follow-ups / TODO(verify)
- Exact Vite electron integration (loadFile vs dev-server URL) finalized in sprint-024/task-001.
- `lucide-react` pinned at `^1` (spec said `^0.5` but that version doesn't exist; ^1.23 is current).
