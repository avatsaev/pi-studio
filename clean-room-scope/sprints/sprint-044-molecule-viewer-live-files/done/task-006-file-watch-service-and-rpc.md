# Task 006 — `FileWatchService` + `file_watch_*` RPCs (the daemon's first real filesystem watcher)

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-005

## Goal
Give the daemon a real filesystem watcher and a per-session subscription RPC family, so clients can be
**pushed** a notification when a watched file **or directory** changes — covering both the molecule
viewer's live reload (task-007) and the live file tree (task-008).

## Background / why
There is **no filesystem watcher anywhere in the daemon or CLI today** — grepping
`chokidar|fs.watch|watchFile|FSWatcher` across `packages/server/src` and `packages/cli/src` returns
zero matches (re-verified). `workspace-git-service.ts:4-8`'s header comment claiming "Recomputation
is change-driven (a filesystem watcher calls `refresh()`)" is therefore stale in its *mechanism* — no
watcher exists — and gets corrected in task-010's docs sync.

Be precise about what already works, because that comment is only half wrong: `refresh(cwd)` has
**two** kinds of caller, not one.
1. `checkout_refresh_request` (`git-checkout-rpc.ts:71-78`), which the client fires
   (`files-changed.ts:46`) after a debounced guess that an agent tool touched something.
2. **Every mutating git RPC.** `git-operations.ts` wraps it in a private `refresh(cwd)` (lines
   252-254, calling `this.deps.gitService?.refresh(cwd)`) invoked from ~9 sites after
   commit/checkout/branch/merge/reset (lines 159, 173, 178, 189, 196, 199, 206, 227, 234).

So a **daemon-initiated** mutation already refreshes and pushes correctly — do not "fix" that path.
What is missing is exactly this sprint's target: changes the daemon did not itself perform (an
external editor, a shell command, a build step, `git` run inside a pi-studio terminal). Those
produce no `refresh()` and no push at all, and no client-side polling interval makes them prompt.

The push mechanism itself is well-precedented — `checkout_status_subscribe`
(`git-checkout-rpc.ts:29-42`) pushes to the *requesting* session via `session.send({ type: "session",
message: {...} })`, and these message types deliberately live outside `messages.ts`'s discriminated
union, validating through the `sessionMessageBaseSchema` passthrough (`messages.ts:882`, accepted by
`sessionEnvelopeSchema` at 894-898). This task reuses that shape exactly; **no change to
`packages/protocol` is required.**

Coalescing precedent: `TerminalManager`'s `coalesceMs` (`terminal/terminal-manager.ts:77`, default
resolved at 86; `flush()` at 235, wired through the timer at 232 and the close path at 246-248).

## Scope references
- `docs/molviewer-integration-scope.md` § 2.6 (absence, confirmed), § 2.7 (4-hop push precedent),
  § 2.8 (coalescing), § 3.2, § 4.4 (150 ms), § 4.5
- `clean-room-scope/features/file-explorer-transfer.md` § listings, § file preview
- `clean-room-scope/architecture/websocket-protocol.md` § subscription families, § passthrough
  fallback
- `packages/server/AGENTS.md` § files services, § daemon bootstrap

## What to build
- **`packages/server/src/files/file-watch-service.ts`** (new):
  ```ts
  export class FileWatchService {
    /** Watch one file OR one directory. Fires whenever the target changes; for a directory that
     *  includes children being created, deleted, or renamed. Returns an unsubscribe function. */
    subscribe(path: string, listener: () => void): () => void;
    /** Stop every watcher (daemon shutdown). */
    close(): void;
  }
  ```
  Implementation requirements:
  - **Resolve `~` server-side** before anything else — root `AGENTS.md` invariant 7; mirror
    `bootstrap.ts:465-491`'s `path.startsWith("~") ? join(homedir(), …)` handling.
  - **Always watch a directory, never a file handle.** For a file target, watch `dirname(path)` and
    filter callbacks by `basename`. This is deliberate: editors and agents commonly save via
    write-temp + atomic rename, which replaces the inode — a watcher bound to the original file stops
    firing after the first such save. For a directory target, watch it directly with no basename
    filter.
  - **One `fs.watch` per directory, ref-counted**, shared across every subscription rooted in that
    directory, torn down when its last subscriber leaves. A real project keeps trajectory + topology +
    log files side by side, and the file tree subscribes to many sibling directories at once.
  - **Debounce per subscription at 150 ms** (`FILE_WATCH_COALESCE_MS`, § 4.4): one `setTimeout` per
    key in the `TerminalManager` style, collapsing the write+rename burst into a single push. Chosen
    above terminal's latency-driven 4 ms and safely below `files-changed.ts`'s 500 ms client debounce
    so daemon pushes never race the client's own post-tool invalidation.
  - `fs.watch(..., { persistent: false })` so watchers never hold the event loop open.
  - **Failure handling:** a missing/unreadable directory must not throw out of `subscribe` — log at
    `debug`/`warn` and return a no-op unsubscribe. On a watcher `error` event (e.g. the watched
    directory is deleted), emit one final change notification (so the client refetches and observes
    the deletion) then drop the watcher.
- **`packages/server/src/files/file-watch-rpc.ts`** (new) —
  `registerFileWatchHandlers(registry, { fileWatchService, subscriptions })`, modelled directly on
  `registerGitCheckoutHandlers`:
  - `file_watch_subscribe` → resolve the path, `subscriptions.add(session, \`file_watch:${resolved}\`,
    service.subscribe(resolved, () => session.send({ type: "session", message: { type:
    "file_changed", path: resolved } })))`; reply
    `{ type: "file_watch_subscribe_response", path: resolved, ok: true }`.
  - `file_watch_unsubscribe` → `subscriptions.remove(session, \`file_watch:${resolved}\`)`; reply
    `{ type: "file_watch_unsubscribe_response", path: resolved, ok: true }`.
  - The push carries **only** `{ type, path }`. No content: a watched file may be a multi-MB
    trajectory, and the client already has the chunked binary download path (`file-transfer.ts`) for
    the bytes. `path` is the **resolved** path the client subscribed with, so client-side matching is
    a string compare.
  - Re-subscribing the same path replaces the previous subscription (that is `SessionSubscriptions.add`'s
    contract from task-005), so a client double-subscribe cannot double-push.
  - **Bound the subscription count per session** (`MAX_FILE_WATCHES_PER_SESSION`, 128). `fs.watch`
    consumes an inotify handle per directory and the kernel enforces a global
    `fs.inotify.max_user_watches`; a client that subscribes in a loop (a bug in a tree-expansion
    effect is the realistic case, not an attacker) would otherwise exhaust it and break watching for
    the whole machine, not just this daemon. Over the cap, reply
    `{ ok: false, error: "too_many_watches" }` and log at `warn` — do not throw, and do not silently
    succeed without watching. Note that `file_read_request` performs **no** path sandboxing either
    (`bootstrap.ts:465-491` resolves any absolute path), so watching an arbitrary path is consistent
    with the existing surface; the difference the cap addresses is that a watch is a *persistent*
    resource where a read is one-shot.
- **`packages/server/src/daemon/bootstrap.ts`** — instantiate `FileWatchService` and call
  `registerFileWatchHandlers` in the files section (next to `FileTransferService`/`FileExplorerService`
  at lines 429-434), passing the `SessionSubscriptions` from task-005. Call the service's `close()`
  from `DaemonHandle.close` (lines 792-797), alongside the existing `relayHandle?.close()` /
  `await wsHandle.close()` / HTTP-server close — that is the daemon's one teardown path.

## Out of scope
- `dev-bootstrap.ts`. It registers neither git-checkout nor file-transfer handlers (verified: only
  `FileExplorerService` at line 252 and an inline `file_read_request`), so the molecule viewer's
  download path doesn't work there anyway — the smoke test uses the production daemon (`npm start`).
  Do not add handlers to the dev bootstrap.
- Recursive/subtree watching. `fs.watch`'s `recursive` option is macOS/Windows-only and the tree only
  needs the directories currently expanded (task-008).
- Any client code (tasks 007-008).
- Adding these message types to `messages.ts`'s discriminated union (§ 2.7 hop 1: the sibling
  `checkout_*` family deliberately does not, and the passthrough fallback already accepts them).

## Acceptance criteria
- [ ] Subscribing to a **file** and modifying it in place pushes exactly one `file_changed` with that
      file's resolved path.
- [ ] Subscribing to a **file** and saving it via write-temp + `rename` (the atomic-save pattern) still
      pushes — and keeps pushing on a **second** such save (the regression this design exists for).
- [ ] Subscribing to a **directory** pushes on a child being created, deleted, and renamed.
- [ ] A modification to an *unrelated* sibling file does **not** notify a file subscriber.
- [ ] Two writes 10 ms apart produce **one** push (150 ms coalescing); writes 500 ms apart produce two.
- [ ] Unsubscribing stops pushes, and the underlying `fs.watch` handle is released once the last
      subscriber for that directory leaves.
- [ ] Subscribing to a nonexistent path neither throws nor kills the session; the returned
      unsubscribe is safe to call.
- [ ] A `~`-prefixed path is expanded server-side and echoed back resolved.
- [ ] Closing a socket without unsubscribing releases the watcher (via task-005's `onSessionClose`).
- [ ] Subscribing past `MAX_FILE_WATCHES_PER_SESSION` replies `error: "too_many_watches"` instead of
      opening an unbounded number of `fs.watch` handles, and the session keeps working.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- New `packages/server/src/files/file-watch-service.test.ts` using `mkdtempSync(join(tmpdir(), …))`,
  covering every acceptance bullet that doesn't need a socket: in-place modify, atomic-rename save
  (twice), directory create/delete/rename, sibling isolation, 10 ms-apart coalescing vs 500 ms-apart,
  unsubscribe, nonexistent path, `~` expansion, and handle release.
  Run: `npx vitest run packages/server/src/files/file-watch-service.test.ts`.
  Use event-driven waits (poll until the expected count or a bounded timeout) rather than long fixed
  sleeps, and keep the timing assertions tolerant — CI filesystems vary. Note in the summary if any
  `fs.watch` behavior differed from the design's assumptions on this platform.
- Socket-level: extend the existing bootstrap/ws test harness with a subscribe → write → assert-push
  round trip, and a close-without-unsubscribe leak check (pairs with task-005's).

## Notes
- `fs.watch` event semantics differ across platforms (`rename` vs `change`, duplicate events per
  save). The design deliberately treats **every** event as "something changed, refetch" rather than
  interpreting event types — that is what makes it portable. Do not build per-event-type logic.
- A directory subscriber also gets notified when a *file inside* it is modified (not just
  created/deleted). That is correct for the file tree, whose listings include size/mtime.
