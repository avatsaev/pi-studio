# Task 008 — Live file tree: expanded directories refresh on create/delete/rename

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-006

## Goal
Make the workspace file tree reflect the filesystem in real time — a file created, deleted, or renamed
by **anything** (terminal command, external editor, git checkout, build step, agent) appears or
disappears without a manual refresh.

## Background / why
Today the tree only refreshes reactively from the client's own guess:
`invalidateAfterToolCompletion(queryClient, client, cwd, toolFilePath)`
(`lib/connection/files-changed.ts:34-49`) invalidates the `["file"]` and `["explorer"]` query families
after a **500 ms debounce**, and it is only called when an **agent tool** completes. Anything that
touches the filesystem outside an agent tool call is invisible until something else happens to
invalidate the cache. Its own header comment (lines 7-10) is explicit that the daemon pushes nothing
here.

The fit with task-006 is exact, which is why this is cheap:
- `FileWatchService` already watches **directories** internally (that is how it survives atomic-rename
  saves), so a directory subscription is the same watcher with the basename filter skipped.
- The tree already fetches **one query per expanded directory**: `useExplorerTree(expanded)`
  (`hooks/use-explorer-tree.ts:26`) over `explorer-store`'s `expanded: Set<string>` of absolute paths
  (`explorer-store.ts:20-21`), each keyed `rpcKeys.explorer(path)` (`rpc-keys.ts:12`).
- So "subscribe to every expanded directory, invalidate that one key on push" is a 1:1 mapping onto
  existing state — no new data model, no tree-diffing, and invalidation stays surgical (one directory,
  not the whole `["explorer"]` family).

## Scope references
- `docs/molviewer-integration-scope.md` § 2.5 (what invalidation does today), § 2.6, § 3.2
  (directory subscriptions)
- `clean-room-scope/features/file-explorer-transfer.md` § directory listings, § tree expansion
- `clean-room-scope/features/workspace-ui.md` § files panel
- `packages/web-client/AGENTS.md` § hooks, § stores

## What to build
- **`packages/web-client/src/hooks/use-explorer-watch.ts`** (new):
  ```ts
  /** Keeps the tree live: subscribes each expanded directory to daemon `file_changed` pushes and
   *  invalidates that directory's listing query when it fires. */
  export function useExplorerWatch(expanded: Set<string>): void;
  ```
  - Reuse the `file_watch_subscribe`/`file_watch_unsubscribe` RPCs from task-006 (directories are
    just another target — no new RPC).
  - **Diff the set across renders**: subscribe newly expanded paths, unsubscribe collapsed ones, leave
    unchanged ones alone. Do **not** tear down and re-subscribe the whole set on every render — a
    single `Set` identity change would otherwise churn every watcher on the daemon. Derive a stable
    key yourself — `Array.from(expanded).sort().join("\0")` — and memoize over it. Note that
    `use-explorer-tree.ts:28` is **not** a precedent for this: its `Array.from(expanded)` preserves
    `Set` insertion order and is not sorted, so two logically identical sets can produce different
    arrays there. Sorting is this hook's own requirement.
  - One `onSessionMessage` handler for the hook (not one per path), matching pushes by `path` against
    the currently-subscribed set and calling
    `queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(path) })`.
  - Handle task-006's `error: "too_many_watches"` reply (the per-session watcher cap) as a **soft**
    failure: log once, leave that directory unsubscribed, and let the existing
    `invalidateAfterToolCompletion` path continue to cover it. A user with a pathologically expanded
    tree must get a slightly less live tree, never a broken one or a retry loop.
  - Full cleanup on unmount: unsubscribe every path and detach the handler (the leak
    `use-checkout-status.ts`'s header calls out).
- **`packages/web-client/src/features/files/FileExplorer.tsx`** — call `useExplorerWatch(expanded)`
  next to the existing `useExplorerTree(expanded)` (line 68). One line; the hook owns everything else.
- Update `files-changed.ts`'s header comment to record that daemon-pushed directory watching now covers
  non-agent filesystem changes, and that this debounced post-tool invalidation remains as the
  belt-and-braces path (it also invalidates `["file"]` content queries, which directory watching does
  not).

## Out of scope
- Changing or removing `invalidateAfterToolCompletion`. It is a superset in one respect (it invalidates
  file **content** queries too) and harmless overlap otherwise; the daemon's 150 ms coalescing sits well
  under its 500 ms debounce (§ 4.4) so they cannot thrash each other. Leave it in place.
- Watching collapsed/unexpanded directories, or recursive subtree watching (task-006 § out of scope).
- Live-refreshing an open **text** file's contents when it changes on disk (`rpcKeys.fileRead`). That is
  the same primitive and an obvious follow-up, but it needs its own unsaved-editor-state thinking —
  exactly the question § 3.3 answers for the molecule viewer. Do not extend into it here.
- Preserving scroll position/expansion across a refresh beyond what TanStack Query's cached-data
  re-render already gives (expansion lives in `explorer-store`, not in the query, so it survives
  invalidation for free — confirm this holds and note it).

## Acceptance criteria
- [ ] With the tree open, `touch newfile.txt` in an expanded directory from an external shell makes the
      row appear within ~1 s, with no manual refresh and no full-tree reload.
- [ ] `rm` of a visible file removes its row; `mv`/rename shows the new name and drops the old one.
- [ ] Changes in a **collapsed** directory cause no fetch (nothing is subscribed there).
- [ ] Expanding a directory subscribes exactly it; collapsing unsubscribes exactly it; other
      directories' subscriptions are untouched (verifiable from daemon logs or a spy on
      `connection.request`).
- [ ] Switching workspace tabs (which swaps `expanded` wholesale via `explorer-store.setRoot`)
      unsubscribes the old root's directories and subscribes the new one's, with no orphans.
- [ ] Expansion state and scroll position are not visibly disturbed by a refresh.
- [ ] Only the changed directory's query is invalidated, not the whole `["explorer"]` family.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/web-client/src/hooks/use-explorer-watch.test.ts` with a fake client + a real
  `QueryClient`: asserts subscribe-on-expand, unsubscribe-on-collapse, **no** churn for an unchanged
  set (re-render with an equal-content `Set` issues zero new RPCs — the regression that matters most
  here), invalidation of exactly `rpcKeys.explorer(path)` on a matching push, ignoring non-matching
  paths, and full cleanup on unmount.
  Run: `npx vitest run packages/web-client/src/hooks/use-explorer-watch.test.ts`.
- Manual (real proof, also in task-010): production daemon + web-client dev server, tree open on a
  workspace; from a separate shell run `touch`, `rm`, `mv`, and `git checkout` of a branch that adds
  and deletes files; watch rows update live. Also confirm from the daemon logs that collapsing a
  directory releases its watcher.

## Notes
- This is the answer to "does the tree update in real time too": today **no** (see Background), and
  after this task **yes**, for every expanded directory, from any writer — not just agent tools.
- Watchers cost one `fs.watch` handle per expanded directory, ref-counted and shared by task-006's
  service. A user with a deeply expanded tree holds a handful of handles; that is the same order as any
  editor's file watcher.
