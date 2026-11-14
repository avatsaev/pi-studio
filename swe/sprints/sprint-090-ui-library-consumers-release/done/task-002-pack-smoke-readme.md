# Task 002 — Pack smoke in a scratch app outside the workspace + README bootstrap

- **Sprint:** sprint-090-ui-library-consumers-release
- **Status:** done
- **Type:** test
- **Area:** packages/ui-library
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The `npm pack` tarball works in a fresh Vite + React 19 app outside the monorepo exactly as the README says.

## Context / why
D1/D5 real proof (AC3) and AC10's snippet check. Written as a repeatable script so the release can re-run it.

## Scope references
- `swe/grills/ui-library.md` D1, D5, D12, D13, D30; AC3, AC10
- `packages/ui-library/README.md` (new)

## What to build
- `packages/ui-library/README.md`: install, peer deps, the two CSS imports (library CSS before your own — D26), `<ThemeBoundary>` usage incl. `storageKey`/`brandConfig`, mounting toast/announcer hosts, subpath list, "one copy per app" + "one ThemeBoundary per document", no SSR/RN.
- `packages/ui-library/scripts/pack-smoke.sh` (or `.mjs`): `npm pack` into a temp dir outside the repo, scaffold a minimal Vite+React 19+TS app there, install the tarball, paste the README snippet, `tsc --noEmit`, `vite build`, and assert: a deep import `@av-pi-studio/ui-library/src/index.ts` fails to resolve; built CSS contains `.piui-`.
- Runtime check: serve the scratch build and confirm in a browser that a `<Button>` has resolved `--pi-*` values (computed style).

## Out of scope
- Publishing (t003).

## Acceptance criteria
- [x] AC3 and AC10 pass via the script + one browser check; script output recorded in the summary.
- [x] Scratch dir is outside the repo and removed afterwards.

## Test / verification plan
- `bash packages/ui-library/scripts/pack-smoke.sh` exits 0.
- Browser: computed `background-color` of the smoke button equals the theme accent.
