# Task 001 — Daemon `moveEntry` + `file_move_request` handler

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Add the one daemon primitive this whole sprint consumes: a `fs.rename`-shaped move/rename operation
on `FileExplorerService`, exposed as the `file_move_request` RPC, with every rejection decided
server-side.

## Background / why
There is **no** move, rename, or copy operation anywhere in the daemon today — `FileExplorerService`
exposes only `listOrPreview`, `deleteFile`, `createEntry`, `writeFile`, and `directorySuggestions`.
`createEntry` is the template to copy for validation order, error-string style, and handler shape.

One deliberate divergence from its four siblings: they all `realpath()` the **full** path. A move
must resolve only the **parent** and re-join the basename, because `realpath`-ing the full source
would relocate a symlink's *target* instead of the link — `mv` semantics move the link. Parent-only
resolution still normalizes `..` and symlinked ancestors server-side, so the trust-boundary posture
is unchanged.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § Public Contract → RPCs, § Behavior &
  Algorithms, § Error Handling & Edge Cases
- `clean-room-scope/features/file-explorer-transfer.md` § Behavior & Algorithms (trust boundary),
  § Live Directory & File Watching

## What to build
Modify: `packages/server/src/files/file-explorer.ts`

Add a public method, placed directly after `createEntry` and before `listOrPreview`:

```ts
async moveEntry(
  inputPath: string,
  inputDestination: string,
): Promise<{ ok: true; path: string; destination: string } | { ok: false; error: string }>
```

Checks in exactly this order, each returning before the next runs:

1. `!inputPath || !inputDestination` → `empty_path`
2. Resolve **parents only**: `realpath(resolve(dirname(x)))` for source and destination, then
   re-join `basename(x)`. Source parent unresolvable → `not_found`; destination parent unresolvable
   → `not_found`.
3. Destination basename validation, reusing `createEntry`'s exact rule set: empty after `trim()`,
   `"."`, `".."`, contains `"/"`, or contains `"\0"` → `invalid_name`
4. `lstat(source)` fails → `not_found`. (`lstat`, not `stat` — a symlink or broken symlink is still
   movable.) Capture `isDirectory()` for check 7.
5. `stat(destinationParent)`; `!isDirectory()` → `not_a_directory`
6. `source === destination` → `same_path`
7. source is a directory and `destination.startsWith(source + "/")` → `into_descendant` (guards
   dropping a folder into its own subtree, which `fs.rename` reports as an opaque `EINVAL`)
8. `lstat(destination)` succeeding → `exists`. **Required** — `fs.rename` silently overwrites an
   existing *file*.
9. `await rename(source, destination)` → `{ ok: true, path: source, destination }`
10. `catch`: `(err as NodeJS.ErrnoException).code === "EXDEV"` → `cross_device`; otherwise
    `err instanceof Error ? err.message : "move_failed"`

Register the handler inside the existing `registerHandlers` block, next to `file_create_request`:

```ts
registry.register("file_move_request", async (ctx) => ({
  type: "file_move_response",
  ...(await this.moveEntry(
    String(ctx.message.path ?? ""),
    String(ctx.message.destination ?? ""),
  )),
}));
```

Import additions to that file: `rename` and `lstat` from `node:fs/promises` (it already imports
`rm`, `stat`, `realpath`, `open`, `mkdir`, `readdir`, `writeFile as writeFileFs`); `dirname` is
already imported from `node:path`.

Do **not** call `expandHome` — none of the four sibling methods do; the web client resolves `~`
before calling (`resolveTildePath` in `packages/web-client/src/stores/explorer-store.ts`).

No `packages/protocol` change: `file_explorer_request` / `file_create_request` /
`file_delete_request` / `file_write_request` have no Zod schema either — they are plain
`HandlerRegistry.register` handlers reading `ctx.message.<field>`. Adding a schema for move alone
would create a second convention.

Bootstrap wiring is automatic — `packages/server/src/daemon/bootstrap.ts` (~line 439) and
`dev-bootstrap.ts` (~line 252) both already call
`new FileExplorerService(...).registerHandlers(registry)`.

## Out of scope
- Cross-filesystem emulation via copy+delete (rejected as `cross_device` by design).
- Overwrite, merge-into-directory, or auto-deduplicated destination names.
- Any client-side code (tasks 002–006).

## Acceptance criteria
- [ ] Moving a file into a sibling directory succeeds; the old path is gone and the new path has the
      original bytes.
- [ ] A same-parent destination renames the entry (proves a future Rename affordance needs no server
      change).
- [ ] Moving a directory carries its nested contents.
- [ ] An existing destination returns `exists` and leaves **both** paths untouched.
- [ ] `dir → dir/sub/dir` returns `into_descendant`.
- [ ] Identical source and destination returns `same_path`.
- [ ] Missing source and missing destination parent both return `not_found`; a destination parent
      that is a regular file returns `not_a_directory`; a `".."` basename returns `invalid_name`;
      `("", "/x")` and `("/x", "")` return `empty_path`.
- [ ] Moving a symlink moves the **link**: `lstat(newPath).isSymbolicLink()` is true and the link's
      target still exists at its original path.
- [ ] `file_move_request` is a registered RPC in the production bootstrap (no `rpc_error` for an
      unknown type).

## Test / verification plan
- Unit: append a `describe("FileExplorerService.moveEntry")` block to
  `packages/server/src/files/file-explorer.test.ts`, matching that file's existing style exactly
  (module-scope `let dir`, `mkdtemp` in `beforeEach`, `rm` in `afterEach`, `expect(result.ok)` then
  `if (result.ok) throw new Error("unreachable")` before reading `result.error`). One case per
  acceptance-criteria bullet above.
- RPC surface: add one probe to the existing `probes` array in
  `packages/server/src/daemon/bootstrap.test.ts` (~line 109, which asserts `res.type !== "rpc_error"`):
  `{ type: "file_move_request", path: "", destination: "" }` — an `empty_path` result still proves
  the handler is registered.
- Run: `npx vitest run packages/server/src/files/file-explorer.test.ts packages/server/src/daemon/bootstrap.test.ts`
- Build: `npm run build:server` and `npm run typecheck` pass.

## Notes
- The TOCTOU race between check 8 and the rename is **accepted** (single-user local daemon). Note it
  in `moveEntry`'s doc comment; do not add locking.
- Live refresh needs nothing here: the existing `FileWatchService` already pushes
  `{ type: "file_changed", path }` for each watched *directory*, so both sides of a move notify
  subscribed clients without a dedicated "moved" event.
