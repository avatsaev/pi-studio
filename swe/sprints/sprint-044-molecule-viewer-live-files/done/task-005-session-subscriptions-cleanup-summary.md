# Task 005 — Summary

## What was built
- **`packages/server/src/ws/session-subscriptions.ts`** (new) — `SessionSubscriptions` class,
  `WeakMap<Session, Map<string, () => void>>`. `add`/`remove`/`disposeSession` as specified; every
  disposer call (in `add`'s replace path, `remove`, and `disposeSession`) runs through a shared
  `disposeSafely` helper wrapping it in try/catch, so one throwing unsubscribe never strands its
  siblings.
- **`packages/server/src/ws/ws-server.ts`**:
  - `WebSocketServerDeps` gains `onSessionClose?: (session: Session) => void`.
  - The `ws.on("close")` handler calls it (guarded by the existing `if (session)` check, so it never
    fires for a connection that never completed the hello handshake) immediately after
    `sessions.delete(session)` and before the disconnect log line, wrapped in its own try/catch so a
    throwing callback can't break socket teardown or the `sessions` bookkeeping.
  - **Confirmed, not assumed**: `close()` (the handle's shutdown path) calls `session.close(...)` for
    every live session, which triggers the underlying `ws` library's own `"close"` event on that same
    socket, which is exactly the handler above — so daemon shutdown already sweeps every session
    through `onSessionClose` with no separate code path needed. Verified via the `ws-server.test.ts`
    additions (the throwing-callback test proves the handler body runs) rather than assumed from
    reading alone.
- **`packages/server/src/projects/git-checkout-rpc.ts`**:
  - `GitCheckoutRpcDeps` gains `subscriptions: SessionSubscriptions`.
  - The module-local `statusUnsubs` map is gone; `checkout_status_subscribe` calls
    `subscriptions.add(session, \`checkout_status:${cwd}\`, unsub)` and
    `checkout_status_unsubscribe` calls `subscriptions.remove(...)` — `SessionSubscriptions.add`'s
    own replace-on-resubscribe semantics (dispose-then-set) preserve the exact behavior the old
    same-key check gave.
  - `sessionKey` and its now-unused `Session` type import are deleted.
- **`packages/server/src/daemon/bootstrap.ts`** — one `SessionSubscriptions` constructed alongside
  `gitService`/`diffManager`, passed into `registerGitCheckoutHandlers`; `onSessionClose: (session)
  => subscriptions.disposeSession(session)` wired into the same `createWebSocketServer(...)` deps
  object that already sets `onMessage`/`onSession`.
- **Tests**:
  - `packages/server/src/ws/session-subscriptions.test.ts` (new, 8 tests, pure) — every case from
    the task's own test plan: single disposer called once, replace-on-resubscribe disposes the
    first before registering the second, `remove` no-ops for an unknown key (both no-session and
    wrong-key-on-a-known-session cases), `remove` disposes exactly the named key, `disposeSession`
    is safe twice, a throwing disposer doesn't strand its siblings during `disposeSession`, a
    throwing disposer during `add`'s replace path still lets the new one register, and subscriptions
    are isolated per session.
  - `packages/server/src/ws/ws-server.test.ts` (+3 tests) — `onSessionClose` fires exactly once for
    a real post-handshake disconnect; never fires for a socket closed before hello; a throwing
    callback still leaves `sessions.size` at 0 after close (teardown unaffected). All three use
    `Promise.withResolvers()`/real `close` events, not sleeps, per the repo's timer-free test
    convention — the throwing-callback test in particular resolves its synchronization promise
    *inside* the callback, immediately before the `throw`, so the awaited signal is only ever
    satisfied once the close handler has actually reached (and run past) `sessions.delete`.
  - `packages/server/src/daemon/bootstrap.test.ts` (+1 test, the leak regression this task exists
    for) — spies on the real `WorkspaceGitService.prototype.subscribe` (wrapping, not replacing, the
    implementation) to capture the unsubscribe function `checkout_status_subscribe` receives,
    subscribes over a real socket, drops the connection **without** sending
    `checkout_status_unsubscribe`, and asserts the captured unsubscribe was called — the exact
    scenario that leaked before this task.

## Verification
- `npx vitest run packages/server/src/ws/session-subscriptions.test.ts` — 8/8 pass.
- `npx vitest run packages/server/src/ws/ws-server.test.ts` — 7/7 pass (4 existing + 3 new).
- `npx vitest run packages/server/src/daemon/bootstrap.test.ts` — 12/12 pass (11 existing + 1 new).
- `npx vitest run packages/server` — full suite, **398/398 pass** (was 395 before this task's 3 new
  test files/cases).
- `npm run build:server` and `npm run typecheck` — both pass, no new errors.
- `npx oxlint` on all seven touched/new files — the one warning present
  (`bootstrap.ts:187`, `lastAssistantText` not capturing outer scope) is a **pre-existing** warning
  on an unrelated function, confirmed via `git show HEAD:...` — not introduced by this change.

## Acceptance criteria
- [x] `SessionSubscriptions` exists with `add`/`remove`/`disposeSession`, keyed by `Session` object
      identity, and a throwing disposer does not prevent the others from running.
- [x] `add` with an already-present key disposes the previous subscription first.
- [x] `ws-server.ts` invokes `onSessionClose` exactly once per closed post-handshake session, and a
      throwing callback does not break socket teardown or the `sessions` bookkeeping.
- [x] `git-checkout-rpc.ts` no longer owns a subscription `Map` and no longer contains `sessionKey`.
- [x] Subscribing to checkout status then dropping the socket without unsubscribing leaves no
      `WorkspaceGitService` listener registered (bootstrap.test.ts regression test).
- [x] `npm run build:server`, `npm run typecheck`, and the server test suite (including
      `bootstrap.test.ts`) pass.

## Out-of-scope items carried forward (per the task's own scope)
- `checkout_diff_subscribe`'s `CheckoutDiffManager` subscriptions (`git-checkout-rpc.ts`, unmodified)
  are keyed by a manager-issued `subscriptionId`, not per-session, and have their own unsubscribe
  RPC. **The same disconnect-leak likely applies to them** — `CheckoutDiffManager` is never told a
  session died either. `TODO(verify)` left as a note here (no code comment added, since the file
  wasn't otherwise touched for this concern) for a future task to migrate; not fixed in this pass,
  per the task's explicit scope boundary.
- `dev-bootstrap.ts` — confirmed (grep) it registers neither git-checkout handlers nor any
  `SessionSubscriptions` consumer; left untouched.
