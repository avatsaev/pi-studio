# Task 001 Summary — Daemon `moveEntry` + `file_move_request` handler

## What was built
- `FileExplorerService.moveEntry(inputPath, inputDestination)` in
  `packages/server/src/files/file-explorer.ts`: an `fs.rename`-shaped move/rename with every
  rejection decided server-side, in the exact check order specified in the task (empty path →
  parent-only resolution → destination basename validation → `lstat(source)` → destination-parent
  `stat` → same-path → into-descendant → destination-exists → `rename`, with `EXDEV` mapped to
  `cross_device`).
- Registered `file_move_request` → `file_move_response` in `registerHandlers`, directly after
  `file_create_request`.
- Added `lstat` to the `node:fs/promises` import list (kept `rename`, already imported for
  `writeFile`'s atomic-rename step).

## Files changed
- `packages/server/src/files/file-explorer.ts` — added `moveEntry` + handler registration.
- `packages/server/src/files/file-explorer.test.ts` — added `describe("FileExplorerService.moveEntry")`
  with one case per acceptance-criteria bullet (11 tests), plus `lstat` to the test file's import list.
- `packages/server/src/daemon/bootstrap.test.ts` — added `{ type: "file_move_request", path: "",
  destination: "" }` to the RPC-surface probe list.

## Commands run + results
- `npx vitest run packages/server/src/files/file-explorer.test.ts packages/server/src/daemon/bootstrap.test.ts`
  → 63/63 passed (38 in file-explorer.test.ts, 25 in bootstrap.test.ts).
- `npm run build:server` → clean.
- `npm run typecheck` → clean (whole-repo `tsc -b`).

## Acceptance criteria status
All satisfied — see the 11 test cases in `file-explorer.test.ts`'s new `describe` block: sibling-dir
move, same-parent rename, directory-with-nested-contents move, exists-leaves-both-untouched,
into_descendant, same_path, not_found (missing source / missing destination parent), not_a_directory,
invalid_name, empty_path (both positions), and symlink-moves-the-link (verified via
`lstat(...).isSymbolicLink()` plus the link target's content unchanged). The bootstrap RPC-surface
probe confirms `file_move_request` is wired in the production bootstrap.

## Notes / follow-ups
- No `packages/protocol` schema added, per the task's explicit call-out (matches the plain
  `HandlerRegistry.register` convention the other three file-explorer RPCs already use).
- Bootstrap wiring needed no change — `bootstrap.ts`/`dev-bootstrap.ts` already call
  `new FileExplorerService(...).registerHandlers(registry)`, which now also registers the new RPC.
- No TODO(verify) items.
