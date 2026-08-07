# Task 002 — Extract + correct the shared post-move sequence (`applyMove`)

- **Sprint:** sprint-047-file-explorer-rename
- **Status:** done
- **Type:** refactor + bugfix
- **Area:** web-client / files
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Turn `moveDropped`'s post-move reconciliation into one helper that drag-move and rename both call,
and fix the two defects in it: discard of the daemon-echoed destination, and silent closing of diff
tabs.

## Context / why
`packages/web-client/src/features/files/FileExplorer.tsx:168-198` currently inlines the whole
sequence into the drag handler: status line → invalidate both affected `rpcKeys.explorer(...)` →
`repathAfterMove` → tab close/reopen → final status. Rename needs the identical sequence, so it is
extracted here **before** a second caller exists, and single-sourced so the two affordances can
never drift.

Two defects to fix while extracting:

1. **The daemon's destination is discarded.** `moveEntry` returns the resolved destination
   (`move-entry.ts:36` — `response.destination ?? destination`), but `moveDropped` uses its own
   client-computed `target.destination` for invalidation, `repathAfterMove`, and the reopen. Today
   the two agree, so it is merely redundant. After task-001 the daemon may legitimately return a
   **different** (trimmed) path — at which point the client would repath and reopen a path that
   does not exist on disk. Honour the echo.

2. **Diff tabs close silently.** `closeByPathPrefix` (`tab-store.ts:205-212`) matches
   `file` | `diff` | `molecule`, but the reopen check (`FileExplorer.tsx:181-187`) tests only
   `file` | `molecule`. A diff tab on the moved path therefore vanishes with no trace.
   **Recorded decision (`features/file-explorer-improvements.md` § 9):** it *stays* closed — after a
   rename git reports ` D old` + `?? new`, so a per-path `git diff` on the new name returns empty
   and the daemon's `--no-index` fallback renders the entire file as added lines; reopening would
   replace the user's real "what did I change" view with an all-green whole-file diff. The defect is
   the **silence**, so report the count in the status line instead.

## Scope references
- `clean-room-scope/features/file-explorer-improvements.md` § 9 (remaining) — Rename, both
  **Decision (2026-08-03)** blocks and the destination-echo caveat
- `clean-room-scope/features/file-explorer-move.md` § UI Behavior (status line, tab reopen)
- `packages/web-client/src/features/files/FileExplorer.tsx` — `moveDropped`, lines 168-198
- `packages/web-client/src/features/files/move-entry.ts` — returns the resolved destination
- `packages/web-client/src/stores/tab-store.ts` — `closeByPathPrefix`, lines 205-212

## What to build

**1. Create `packages/web-client/src/features/files/move-status.ts`** — one pure, unit-testable
formatter for the status suffix:

```ts
/** Append a closed-diff-tab count to a move/rename status line. */
export function withClosedDiffs(text: string, closedDiffs: number): string;
```

`0` returns `text` unchanged; otherwise append `` — closed N diff tab`` with correct
singular/plural (`1 diff tab`, `2 diff tabs`).

**2. Add a local `applyMove` helper in `FileExplorer.tsx`**, beside `moveDropped`:

```ts
/** Issue the move, then reconcile caches, tree state, and tabs. Returns the daemon-resolved
 *  destination and how many diff tabs were closed. */
async function applyMove(
  source: string,
  requestedDestination: string,
): Promise<{ destination: string; closedDiffs: number }>;
```

Body, in this order:

1. `const destination = await moveEntry(client, source, requestedDestination)` — the **echo** is
   authoritative from here on.
2. `const destinationDir = dirOf(destination)` — derived, not passed in, so a trimmed echo cannot
   leave the caller's directory stale. (For drag this equals `resolveMoveTarget`'s
   `destinationDir`, so no behavior changes.)
3. Invalidate `rpcKeys.explorer(dirOf(source))` and `rpcKeys.explorer(destinationDir)`.
4. `repathAfterMove(source, destination, destinationDir)`.
5. **Before** closing anything, partition the tabs using the *same* predicate `closeByPathPrefix`
   uses (`path === source || path.startsWith(`${source}/`)`):
   - reopen-eligible: an exact-path `file` or `molecule` tab;
   - `closedDiffs`: the count of matching `diff` tabs — prefix-matched, so descendants under a
     renamed directory are included (per the recorded decision, "the same count covers them").
6. `closeByPathPrefix(source)`.
7. Reopen via `handleOpenFile(destination)` when eligible.
8. Return `{ destination, closedDiffs }`.

Keep it a local function rather than a new module: both callers live inside `FileExplorer.tsx` and
it closes over `client`, `queryClient`, and `handleOpenFile` — a standalone module would need four
injected dependencies for zero gain. `withClosedDiffs` is extracted precisely because it is the part
that *can* be pure.

**3. Rewrite `moveDropped` to use it**, preserving its observable behavior:

```ts
const { destination, closedDiffs } = await applyMove(source, target.destination);
setStatus({
  text: withClosedDiffs(`Moved to ${dirOf(destination).split("/").pop() || "/"}`, closedDiffs),
  error: false,
});
```

The leading `Moving <basename>…` status and the `catch` writing `err.message` stay as they are.

## Out of scope
- Any rename-specific code — state, rows, components, menu (tasks 003-006).
- Reopening diff tabs, repathing tab ids, or an `openDiffTab` helper: all three are explicitly
  rejected by the recorded decision.
- `resolveMoveTarget` and drop-legality: untouched.

## Acceptance criteria
- [ ] `moveDropped` uses the destination returned by `moveEntry` — not its own computed one — for
      invalidation, `repathAfterMove`, and the reopen.
- [ ] Given a daemon that echoes a trimmed destination (task-001), when a move completes, then the
      **trimmed** path is what gets repathed and reopened.
- [ ] Given an open diff tab on the moved path, when the move completes, then the tab is closed and
      the status line reports the count.
- [ ] `withClosedDiffs(text, 0) === text`; `1` renders `diff tab` and `2` renders `diff tabs`.
- [ ] Given a renamed directory with diff tabs on descendant files, then those are counted too.
- [ ] Drag-move behaviour is otherwise unchanged: exact-path `file`/`molecule` tabs still reopen,
      both directories are still invalidated, and a failure still writes `err.message` to the
      status line.

## Test / verification plan
- Tests: new `packages/web-client/src/features/files/move-status.test.ts` covering zero / singular /
  plural and that the base text is never mutated. Run
  `npx vitest run packages/web-client/src/features/files/move-status.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Browser verification of the drag path is deferred to task-006, which exercises drag and rename
  through the same helper.

## Notes
- Counting must happen **before** `closeByPathPrefix` — afterwards the tabs are gone and the count
  is always 0. This is the ordering bug in miniature, so keep the two steps adjacent and commented.
- Deriving `destinationDir` inside the helper deliberately drops it from the signature; passing both
  a destination and a directory invites exactly the staleness this task exists to fix.
