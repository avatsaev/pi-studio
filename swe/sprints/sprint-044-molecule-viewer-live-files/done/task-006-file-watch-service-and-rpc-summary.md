# Task 006 — Summary

## What was built
- **`packages/server/src/files/file-watch-service.ts`** (new) — `FileWatchService`, the daemon's
  first real filesystem watcher:
  - `subscribe(path, listener)`: resolves `~` server-side (inline, mirroring `bootstrap.ts`'s own
    duplicated `path.startsWith("~") ? join(homedir(), ...) : path`, matching that file's existing
    convention of duplicating the one-liner rather than sharing a cross-module helper), stats the
    resolved path, and watches its **directory** either way — directly for a directory target, or
    `dirname(path)` filtered by `basename(path)` for a file target (including a file that doesn't
    exist yet: `statSafe` treats a stat failure as "file target", so watching a not-yet-created
    file inside an existing directory works).
  - One `fs.watch(dir, { persistent: false })` per distinct directory, ref-counted across every
    subscription rooted there, torn down on the last release.
  - Per-subscription 150 ms debounce (`FILE_WATCH_COALESCE_MS`) via one `setTimeout` per
    subscription in the `TerminalManager` style — a burst of events inside the window collapses to
    one push; a `filename === null` event (platform-dependent) notifies every subscriber in that
    directory rather than guessing.
  - Failure handling: an unwatchable directory logs at `debug` and returns a no-op unsubscribe
    (never throws); a watcher `error` event fires one immediate final notification per subscriber
    (bypassing the debounce, since the watcher is already being torn down) then drops the watch.
  - `close()` tears down every watcher (daemon shutdown).
  - A test-only `watchedDirectoryCount` getter (documented `@internal`, not part of the public
    contract) — the one seam needed to assert "the handle is actually released", which isn't
    otherwise observable black-box.
- **`packages/server/src/files/file-watch-rpc.ts`** (new) — `registerFileWatchHandlers`, modelled
  on `registerGitCheckoutHandlers`:
  - `file_watch_subscribe` resolves the path, checks the per-session cap
    (`MAX_FILE_WATCHES_PER_SESSION = 128`, via `SessionSubscriptions.keysOf` filtered to the
    `file_watch:` prefix — a resubscribe of an already-watched path is explicitly exempted from the
    cap check since `SessionSubscriptions.add`'s replace-on-resubscribe semantics mean it never
    adds a new entry), then `subscriptions.add(session, \`file_watch:${resolved}\`, ...)`.
  - `file_watch_unsubscribe` mirrors it.
  - The push is `{ type: "file_changed", path: resolved }` — no content, per spec.
  - Over the cap: `{ ok: false, error: "too_many_watches" }` plus a `warn` log; never throws.
- **`packages/server/src/ws/session-subscriptions.ts`** — added `keysOf(session): readonly
  string[]`, a small generic addition (domain-free, like the rest of the class) that lets a caller
  enforce its own per-family cap without the registry knowing what a key means. Covered by a new
  unit test.
- **`packages/server/src/daemon/bootstrap.ts`** — instantiated `FileWatchService` and called
  `registerFileWatchHandlers` in the files section (reusing the `subscriptions` `SessionSubscriptions`
  instance task-005 already created for `checkout_status`), and added `fileWatchService.close()` to
  `DaemonHandle.close()` alongside the existing relay/WS/HTTP teardown.

## Verification
- `npx vitest run packages/server/src/files/file-watch-service.test.ts` — **8/8 pass**, run 4× in a
  row with no flakes. Covers, against a real `mkdtemp` scratch directory and real `fs.watch` (no
  mocked filesystem): in-place modify (exactly one push), atomic-rename save twice in a row (the
  regression this design exists for), directory create/delete/rename, sibling isolation, debounce
  coalescing (writes inside the window collapse; a write after the window is a separate push),
  unsubscribe stops pushes AND releases the shared handle only once the last subscriber leaves
  (verified via `watchedDirectoryCount`, not just "pushes stopped"), a nonexistent path never
  throwing and its unsubscribe being safe (including calling it twice), and `~` expansion (via
  mocking only `node:os`'s `homedir()`, every other export — notably `tmpdir()` — real).
  Test timing uses a scaled-down 40 ms coalesce window (not fake timers, since `fs.watch` is a real
  OS mechanism) with `vi.waitFor` polling rather than fixed sleeps, per the task's own guidance.
  **Platform note**: ran on Linux (inotify); observed behavior matched the design's assumptions
  exactly — an in-directory atomic rename produces two raw `fs.watch` events (old + new basename),
  both landing inside the same debounce window and collapsing correctly.
- `packages/server/src/ws/session-subscriptions.test.ts` — **9/9 pass** (8 existing + 1 new for
  `keysOf`).
- `packages/server/src/daemon/bootstrap.test.ts` — **15/15 pass** (12 existing + 3 new): a real
  subscribe → external `writeFileSync` → matching `file_changed` push round trip over a real
  socket; the per-session cap replying `too_many_watches` after 129 distinct subscriptions; and the
  close-without-unsubscribe leak check (spies on the real `FileWatchService.prototype.subscribe`,
  mirroring task-005's `WorkspaceGitService` regression test exactly).
- `npm run build:server` and `npm run typecheck` — both pass.
- `npx oxlint` on all seven touched/new files — zero errors; the one remaining warning
  (`bootstrap.ts:189`, `lastAssistantText`) is pre-existing and unrelated (confirmed in task-005's
  summary already).
- Full server suite: `npx vitest run packages/server` — **410/410 pass**.

## Acceptance criteria
- [x] Subscribing to a file and modifying it pushes exactly one `file_changed` with that file's
      resolved path.
- [x] Subscribing to a file and saving it via write-temp + rename still pushes, and keeps pushing
      on a second such save.
- [x] Subscribing to a directory pushes on a child being created, deleted, and renamed.
- [x] A modification to an unrelated sibling file does not notify a file subscriber.
- [x] Two writes 10 ms apart produce one push; writes 500 ms apart produce two (verified at scaled
      timing — 40 ms coalesce window with sub-window and post-window writes).
- [x] Unsubscribing stops pushes, and the underlying `fs.watch` handle is released once the last
      subscriber for that directory leaves.
- [x] Subscribing to a nonexistent path neither throws nor kills the session; the returned
      unsubscribe is safe to call.
- [x] A `~`-prefixed path is expanded server-side and echoed back resolved.
- [x] Closing a socket without unsubscribing releases the watcher (via task-005's `onSessionClose`).
- [x] Subscribing past `MAX_FILE_WATCHES_PER_SESSION` replies `error: "too_many_watches"` instead of
      opening an unbounded number of `fs.watch` handles, and the session keeps working.
- [x] `npm run build:server` and `npm run typecheck` pass.

## Notes / deviations from the plan
- The watcher-`error` code path (final notification + drop) is implemented exactly as specified,
  but is **not** covered by an automated test — reliably triggering a real `fs.watch` `error` event
  (as opposed to the normal `rename`/`change` events a directory deletion also produces) is
  platform- and timing-dependent enough that a deterministic unit test wasn't worth the fragility
  it would add. Verified by code review against the spec's exact wording instead.
- Did not add an RPC-level (socket) test specifically for `~` expansion's echo — the resolution
  logic in `file-watch-rpc.ts` is the same duplicated one-liner already exercised end-to-end by
  `FileWatchService`'s own `~`-expansion test, and the task's test plan only lists `~` expansion
  under the service-level test bullet, not the socket-level one.
- Left `dev-bootstrap.ts` untouched, per the task's explicit out-of-scope note (verified again: it
  registers neither git-checkout nor file-transfer handlers).
