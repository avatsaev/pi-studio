# Task 003 Summary — Pure `resolveMoveTarget` drop-legality decision + tests

## What was built
- `packages/web-client/src/features/files/move-target.ts` — `resolveMoveTarget(sourcePath, row,
  rootPath)`: pure, side-effect-free legality decision returning `{ destinationDir, destination }`
  or `null`, per the rule order in the task spec (row-kind gate, drop-onto-file→parent-dir
  resolution, no-op-already-there, self-drop, into-own-descendant, outside-root).
- Reuses `dirOf` from `@pi-studio-ui/lib/paths.js` — no re-derived parent-path logic.

## Files changed
- `packages/web-client/src/features/files/move-target.ts` (new).
- `packages/web-client/src/features/files/move-target.test.ts` (new) — 8 cases, one per
  acceptance-criteria bullet plus an explicit "drop on root itself is legal" case.

## Commands run + results
- `npx vitest run packages/web-client/src/features/files/move-target.test.ts` → 8/8 passed.
- `npm run build:web-client` → clean.
- `npm run typecheck` → clean.

## Acceptance criteria status
All satisfied: directory-drop join, file-drop→parent-dir resolution, no-op null, self/descendant
null, non-file/dir row kind null, outside-rootPath null. Module imports only `dirOf` — no React, no
stores.

## Notes / follow-ups
- None. Legality is intentionally re-checked in task-006 against the actual drop row (not reused
  from hover state) — this function is cheap enough that re-resolving costs nothing.
