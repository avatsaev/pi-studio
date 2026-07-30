# Task 004 — `explorer-store.repathAfterMove` + tests

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Make the explorer's tree state survive a move: expanded paths and the selection follow the moved
subtree to its new prefix instead of pointing at paths that no longer exist.

## Background / why
`packages/web-client/src/stores/explorer-store.ts` holds `expanded` (plus its `expandedByRoot` mirror
for the current root) and `selected` as absolute path strings. After a move, any of those inside the
moved subtree are stale, and the tree would keep requesting listings for dead paths. One store action
fixes all of it; the existing `toggle` action is the shape to follow.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § UI Behavior (the moved item is visible where it
  landed)
- `clean-room-scope/features/file-explorer-transfer.md` § Live Directory & File Watching (expanded
  directories are the watch/refresh unit)

## What to build
Modify: `packages/web-client/src/stores/explorer-store.ts` — add one action:

```ts
/** Rewrite tree state after a move: any expanded path equal to `from` or nested under it becomes
 *  the same path under `to`, and `selected` follows the same rewrite. Also expands `toParent` so
 *  the moved item is visible where it landed. */
repathAfterMove(from: string, to: string, toParent: string): void;
```

Follow `toggle`'s existing shape — copy `expanded` into a new `Set`, mirror into a new
`expandedByRoot` `Map` keyed by `s.rootPath`, return both:

- rewrite rule: `p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p`
- add `toParent` to the rewritten `expanded` set
- `selected`: apply the same rewrite to `selected.path`, preserving `isDirectory`; leave `null` as
  `null`
- leave `draft` untouched

## Out of scope
- Query invalidation and tab handling (task-006).
- Any change to `toggle`, `setRoot`, or the draft flow.

## Acceptance criteria
- [ ] A moved expanded directory carries its expanded descendants to the new prefix (e.g. `a/b` and
      `a/b/c` expanded, `a` moved to `x/a` → `x/a/b` and `x/a/b/c` expanded, `a/b*` gone).
- [ ] An expanded path unrelated to the move is left byte-identical.
- [ ] `selected` pointing at the moved item follows it, keeping its `isDirectory` flag; a `null`
      selection stays `null`.
- [ ] `toParent` is expanded after the call even if it was collapsed before.
- [ ] `expandedByRoot` for the current `rootPath` matches the new `expanded` set.
- [ ] `draft` is unchanged.

## Test / verification plan
- Unit: add cases to the existing `packages/web-client/src/stores/explorer-store.test.ts` — one per
  acceptance-criteria bullet.
- Run: `npx vitest run packages/web-client/src/stores/explorer-store.test.ts`
- Build: `npm run build:web-client` and `npm run typecheck` pass.

## Notes
- `from`/`to` are absolute paths as the daemon returned them; the store does no `~` resolution here
  (`resolveTildePath` already ran before the RPC).
- Prefix matching must use `from + "/"`, never a bare `startsWith(from)`, or a sibling named
  `notes-old` would be rewritten when `notes` moves.
