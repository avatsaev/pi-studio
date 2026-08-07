# Task 004 Summary — `explorer-store.repathAfterMove` + tests

## What was built
- `repathAfterMove(from, to, toParent)` action on `useExplorerStore`
  (`packages/web-client/src/stores/explorer-store.ts`), following `toggle`'s existing
  copy-into-new-`Set`/mirror-into-new-`expandedByRoot`-`Map` shape:
  - rewrites every `expanded` path equal to `from` or nested under `from + "/"` to the same
    suffix under `to`,
  - adds `toParent` to the rewritten set so the moved item is visible where it landed,
  - applies the same rewrite to `selected.path` (preserving `isDirectory`), leaving `null`
    untouched,
  - leaves `draft` untouched.

## Files changed
- `packages/web-client/src/stores/explorer-store.ts` — added the `repathAfterMove` interface
  member + implementation.
- `packages/web-client/src/stores/explorer-store.test.ts` — added a
  `describe("explorer store — repathAfterMove")` block, one case per acceptance-criteria bullet
  (7 tests).

## Commands run + results
- `npx vitest run packages/web-client/src/stores/explorer-store.test.ts` → 17/17 passed (10
  pre-existing + 7 new).
- `npm run build:web-client` → clean.
- `npm run typecheck` → clean.

## Acceptance criteria status
All satisfied: moved-subtree descendants carried to the new prefix with the old prefix gone,
unrelated paths (including a `notes`/`notes-old` sibling-prefix trap) left byte-identical,
`selected` following the rewrite with `isDirectory` preserved (and staying `null` when already
`null`), `toParent` expanded regardless of its prior state, `expandedByRoot` kept in sync for the
current `rootPath`, and `draft` left unchanged (checked via reference equality).

## Notes / follow-ups
- Prefix matching uses `from + "/"` exclusively (never a bare `startsWith(from)`), verified by the
  `notes`/`notes-old` test case.
- None outstanding.
