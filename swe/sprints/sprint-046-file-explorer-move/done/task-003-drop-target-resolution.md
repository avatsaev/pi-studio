# Task 003 — Pure `resolveMoveTarget` drop-legality decision + tests

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Put the entire "is this drop legal, and where does it land" decision in one pure, exhaustively tested
function, so no legality rule ever lives inside a drag event handler.

## Background / why
The web-client test setup has **no jsdom environment**, so anything reachable only through a DOM
event is effectively untestable — the same reason `createExplorerWatcher` was extracted out of its
hook. Every rule that decides whether a drop is allowed is therefore a pure function here, and
task-006's handlers become thin call sites.

Reuse `dirOf` from `@pi-studio-ui/lib/paths.js`; do not re-derive parent paths inline.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § UI Behavior (legal/illegal drop targets),
  § Behavior & Algorithms (directory-into-descendant rejection)

## What to build
Create: `packages/web-client/src/features/files/move-target.ts`

```ts
export interface MoveTarget {
  /** Directory the drop lands in. */
  destinationDir: string;
  /** Full destination path — `destinationDir` + "/" + basename(sourcePath). */
  destination: string;
}

/**
 * Where a drag of `sourcePath` dropped on `row` would land, or null when the drop is illegal.
 * `rootPath` is the tree root: a drop resolving above it is rejected (the explorer is
 * workspace-scoped).
 */
export function resolveMoveTarget(
  sourcePath: string,
  row: { kind: string; path: string },
  rootPath: string,
): MoveTarget | null;
```

Rules — each returns `null`:

- `row.kind` is neither `"file"` nor `"directory"` (loading/error/draft rows are not drop targets).
- `destinationDir` = `row.kind === "directory" ? row.path : dirOf(row.path)` — dropping onto a file
  means "into the folder that contains it". This also fixes the pre-existing OS-upload behavior where
  dropping onto a file row fell through to `rootPath`.
- `destinationDir === dirOf(sourcePath)` → `null` (already there — no round trip, no error toast).
- `destinationDir === sourcePath` → `null` (folder onto itself).
- `destinationDir.startsWith(sourcePath + "/")` → `null` (folder into its own descendant).
- `destinationDir !== rootPath && !destinationDir.startsWith(rootPath + "/")` → `null`.
- Otherwise `{ destinationDir, destination: `${destinationDir}/${basename}` }`, where `basename` is
  `sourcePath.split("/").pop()`.

## Out of scope
- Any React, event, or `dataTransfer` handling (tasks 005–006).
- Auto-expand-on-hover timing (task-006) — this function is stateless.

## Acceptance criteria
- [ ] A file dropped on a directory row returns that directory plus the joined destination path.
- [ ] A file dropped on a **file** row lands in that file's parent directory.
- [ ] A drop whose resolved directory already contains the source returns `null` (no request is ever
      issued for a no-op move).
- [ ] A directory dropped on itself, or on any row inside itself, returns `null`.
- [ ] A row kind other than `file`/`directory` returns `null`.
- [ ] A resolved directory outside `rootPath` (and not `rootPath` itself) returns `null`.
- [ ] The module imports only `dirOf` from `@pi-studio-ui/lib/paths.js` — no React, no stores.

## Test / verification plan
- Unit: `packages/web-client/src/features/files/move-target.test.ts`, in the style of the sibling
  `file-tree.test.ts` (`import { describe, expect, it } from "vitest"`, plain object fixtures, no
  mocks) — one case per acceptance-criteria bullet.
- Run: `npx vitest run packages/web-client/src/features/files/move-target.test.ts`
- Build: `npm run build:web-client` and `npm run typecheck` pass.

## Notes
- Legality is decided **twice** by design: here (for the hover highlight) and again on the actual drop
  row in task-006. Keep the function cheap and side-effect free so re-resolving costs nothing.
- The daemon re-validates everything independently (task-001) — this function exists for UX, not
  security.
