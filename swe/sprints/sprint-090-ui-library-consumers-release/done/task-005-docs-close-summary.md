# Summary — sprint-090 task-005 docs-close (written by subagents NovelLadybug and EnormousMollusk; parent verified)

## What was done
- `git mv packages/web-client/DESIGN_SYSTEM.md packages/ui-library/DESIGN_SYSTEM.md` and rewrote what moved: paths, appearance (`storageKey`, `localStorageKvStore`, `useAppearanceControls`), accent-only brand API, `piui-` prefix + two-file CSS split, `findTokenProblems` guard section, new dev-warnings section, `Menu` Radix note.
- New: `packages/ui-library/AGENTS.md`, `packages/ui-gallery/{README,AGENTS}.md`. `packages/ui-library/README.md` gained the Menu note and a theme-switcher example outside the smoke-fenced block.
- web-client: `AGENTS.md` (new "Design system lives in @av-pi-studio/ui-library" section, layout tree, moved-path invariants, `@web-client/*` alias, `design-tokens.test.ts`) and `README.md`.
- Root `AGENTS.md` (layout, dependency graph, 7-package publish order, ui-gallery private, first-publish step → RELEASING.md, package index), `docs/build-layering.md`, `swe/MAIN-SCOPE.md` (one entry each for ui-library and ui-gallery).
- Not changed (nothing to correct): root `README.md` (no package list/build order), `docker/README.md`, tech-stack table.

## Verification
- Every `packages/ui-library|ui-gallery/...` path named in the touched docs exists (checked with a loop).
- `@pi-studio-ui` remains only in one sentence of `packages/web-client/AGENTS.md` that explains the rename, and in historical `swe/` documents.
- Not verified: sprint-history prose in `packages/web-client/AGENTS.md` (≈ lines 1500–1530, 2629) that still mentions `toast-store`/`announcer-store` by name (left as history).

## Acceptance criteria
- [x] Docs per D23 updated. [x] README quickstart is the exact snippet the pack smoke builds (AC10).
