# Task 001 — Daemon: `moveEntry` must create the name it validated (trimmed basename)

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** bugfix
- **Area:** server / files
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** none

## Goal
`FileExplorerService.moveEntry` validates the *trimmed* destination basename but renames to the
*untrimmed* one. Make both use the same trimmed value so what is validated is what lands on disk.

## Context / why
In `packages/server/src/files/file-explorer.ts`:

- line 190 — `destination = join(destinationParent, basename(inputDestination))` → **untrimmed**
- line 195 — `const destName = basename(inputDestination).trim()` → **trimmed**, and this is what
  the `invalid_name` guard on lines 196-204 inspects

So a destination of `/dir/foo.txt ` (trailing space) validates as `foo.txt`, passes every guard, and
then `rename()` creates a file literally named `foo.txt ` on disk. Whitespace-*only* names are still
correctly rejected (`destName` becomes `""` → `invalid_name`), so this is specifically the
"validated one name, created another" case.

Today this is only reachable by a caller that sends an untrimmed destination, and the sole caller
(drag-and-drop) derives the basename from an existing path. Sprint 047 puts a **free-text input**
on this RPC, which makes it directly reachable. Fix it at the source rather than relying on every
present and future client to pre-trim.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § Public Contract → RPCs,
  § Error Handling & Edge Cases
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename
  (the untrimmed-basename caveat)
- `packages/server/src/files/file-explorer.ts` — `moveEntry`, lines 174-241
- `packages/server/src/files/file-explorer.test.ts` — existing `moveEntry` coverage

## What to build
Modify: `packages/server/src/files/file-explorer.ts` (`moveEntry` only).

Compute the trimmed basename **once** and use it for both the guard and the join:

```ts
const destName = basename(inputDestination).trim();
// …existing invalid_name guard on destName, unchanged…
const destination = join(destinationParent, destName);
```

Sequencing constraint — **the existing rejection precedence must not change.** Today
`destinationParent = await realpath(...)` runs inside a `try` that yields `not_found` *before* the
`invalid_name` guard. Keep that resolution where it is; only the `join` moves below the guard (a
`join` cannot throw, so nothing else shifts). Sprint 046 task-001 pinned this eight-code order and
`file-explorer.test.ts` asserts it.

Consequence worth noting in the tests: `same_path`, `exists`, and `into_descendant` are all derived
from `destination`, so they now compare against the trimmed path. Renaming `foo.txt` → `foo.txt `
therefore reports `same_path` instead of silently creating a second, near-identical file.

## Out of scope
- Any other `moveEntry` behavior: the eight rejection codes, their order, parent-only symlink
  resolution, and the `{ ok, path, destination }` response shape all stay exactly as they are.
- Client-side trimming — task-005 does that independently; this task makes the daemon correct on
  its own rather than dependent on it.
- `createEntry` / `writeFile` / `file_delete_request`: not touched.

## Acceptance criteria
- [ ] Given a destination whose basename has leading or trailing whitespace, when the move
      succeeds, then the on-disk name is the trimmed one and the response's `destination` echoes
      that trimmed path.
- [ ] Given a whitespace-only destination basename, then the result is still
      `{ ok: false, error: "invalid_name" }`.
- [ ] Given a rename of `x` to `x ` (same name plus whitespace) in the same directory, then the
      result is `{ ok: false, error: "same_path" }` and no second file is created.
- [ ] Given a destination whose trimmed name collides with an existing entry, then the result is
      `{ ok: false, error: "exists" }` and neither file is modified.
- [ ] The existing eight-rejection precedence order is unchanged — every pre-existing `moveEntry`
      test passes with no edits to its expectations.

## Test / verification plan
- Tests: extend `packages/server/src/files/file-explorer.test.ts` with the four whitespace cases
  above (trailing-space success, whitespace-only rejection, `same_path`-via-trim, `exists`-via-trim).
  Run `npx vitest run packages/server/src/files/file-explorer.test.ts` — all pass.
- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- The fix is deliberately "normalize", not "reject". The guard already validated the *trimmed* form,
  which means trimmed is what the code always intended to create; rejecting untrimmed input instead
  would be a new wire-visible error for input the daemon currently accepts.
- `join()` does not trim its segments — that is why the two lines diverge in the first place.
