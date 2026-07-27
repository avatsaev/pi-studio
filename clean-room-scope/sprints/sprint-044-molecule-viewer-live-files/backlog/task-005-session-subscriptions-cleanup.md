# Task 005 — `SessionSubscriptions` registry + session-close cleanup (fixes an existing leak)

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Give the daemon one place to hold per-session push subscriptions and one hook that disposes them when
a socket closes — then migrate the existing git-checkout status subscriptions onto it, fixing two
real bugs before the new file-watch subscriptions (task-006) can inherit them.

## Background / why
Two confirmed defects in today's only per-session subscription implementation
(`packages/server/src/projects/git-checkout-rpc.ts`):

1. **Never cleaned up on disconnect.** `statusUnsubs` (line 27) is only cleared by an explicit
   `checkout_status_unsubscribe` (lines 47-48) or a same-key re-subscribe (line 33).
   `ws-server.ts:157-159`'s close handler does nothing but `sessions.delete(session)`, and
   `WebSocketServerDeps` (lines 29-46) exposes `onSession`/`onMessage` but **no** close hook — so a
   handler module cannot learn a session died. A dropped connection (lid closed, crashed tab, network
   drop) leaks that session's `WorkspaceGitService` listener permanently.
2. **Session keys can collide.** `sessionKey(session)` (lines 81-83) is
   `(session as { id?: string }).id ?? String(session)`. `Session` **does** have a real
   `readonly id: string` (`packages/server/src/ws/session.ts:9-10`), so the fallback is dead — but it
   is also a silent footgun: were `id` ever absent, `String(session)` yields `"[object Object]"` for
   every session and all sessions would share one key, so one client's unsubscribe would kill
   another's. Keying by the `Session` object removes the failure mode entirely.

A leaked file-watch subscription is strictly worse than a leaked git listener, because it also pins an
OS-level `fs.watch` handle — so this is fixed before task-006, not after.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.7 (push precedent), § 4.5 (this decision, in full)
- `clean-room-scope/architecture/websocket-protocol.md` § session lifecycle, § push/subscription
  families
- `clean-room-scope/features/git-checkout.md` § Status & diff
- `packages/server/AGENTS.md` § ws layer

## What to build
- **`packages/server/src/ws/session-subscriptions.ts`** (new):
  ```ts
  export class SessionSubscriptions {
    /** Register `unsub` under `key` for `session`, disposing any existing entry for that key. */
    add(session: Session, key: string, unsub: () => void): void;
    /** Dispose and forget one key. Safe when absent. */
    remove(session: Session, key: string): void;
    /** Dispose every subscription this session holds. Safe to call twice. */
    disposeSession(session: Session): void;
  }
  ```
  Backed by a `WeakMap<Session, Map<string, () => void>>` — nothing more. Each disposer runs inside
  `try/catch` so one throwing unsubscribe cannot strand the rest.
- **`packages/server/src/ws/ws-server.ts`**:
  - `WebSocketServerDeps` gains `onSessionClose?: (session: Session) => void`, documented next to the
    existing `onSession`/`onMessage` (lines 40-45).
  - Call it from the `ws.on("close")` handler (line 157) alongside `sessions.delete(session)`, guarded
    by the existing `if (session)` check and wrapped so a throwing callback cannot break socket
    teardown.
  - `close()` (lines 176-179) closes every live session; the per-session close handlers fire from
    that, so no extra sweep is needed there — confirm this during implementation and note it.
- **`packages/server/src/projects/git-checkout-rpc.ts`**:
  - `GitCheckoutRpcDeps` gains `subscriptions: SessionSubscriptions`.
  - Replace the module-local `statusUnsubs` map with
    `subscriptions.add(session, \`checkout_status:${cwd}\`, unsub)` and the unsubscribe handler with
    `subscriptions.remove(...)`.
  - Delete the now-unused `sessionKey` helper (lines 81-83) and its `Session` type import if that
    leaves it unused.
- **`packages/server/src/daemon/bootstrap.ts`**:
  - Construct one `SessionSubscriptions` and pass it into `registerGitCheckoutHandlers`
    (call site at lines 410-414).
  - Wire `onSessionClose: (session) => subscriptions.disposeSession(session)` into the
    `createWebSocketServer(...)` deps (the same object literal that sets `onMessage` at line 619).

## Out of scope
- `checkout_diff_subscribe`'s `CheckoutDiffManager` subscriptions (`git-checkout-rpc.ts:52-69`). They
  are keyed by a manager-issued `subscriptionId` rather than per session and have their own
  unsubscribe RPC; migrating them is a larger change with its own risk. **Note the same
  disconnect-leak likely applies** and leave a `TODO(verify)` comment plus a line in the task summary
  — do not silently expand this task.
- `dev-bootstrap.ts` — it does not register git-checkout handlers at all (verified), so it needs no
  `SessionSubscriptions`. Leave it untouched.
- Any behavioral change to what `checkout_status_update` computes or when it is sent.

## Acceptance criteria
- [ ] `SessionSubscriptions` exists with `add`/`remove`/`disposeSession`, keyed by `Session` object
      identity, and a throwing disposer does not prevent the others from running.
- [ ] `add` with an already-present key disposes the previous subscription first (preserving
      `checkout_status_subscribe`'s existing replace-on-resubscribe semantics, line 33).
- [ ] `ws-server.ts` invokes `onSessionClose` exactly once per closed post-handshake session, and a
      throwing callback does not break socket teardown or the `sessions` bookkeeping.
- [ ] `git-checkout-rpc.ts` no longer owns a subscription `Map` and no longer contains `sessionKey`.
- [ ] Subscribing to checkout status then dropping the socket without unsubscribing leaves **no**
      `WorkspaceGitService` listener registered.
- [ ] `npm run build:server`, `npm run typecheck`, and the existing server test suite pass —
      specifically `packages/server/src/daemon/bootstrap.test.ts` (it exercises real sessions).

## Test / verification plan
- New `packages/server/src/ws/session-subscriptions.test.ts` (pure): `add` → `disposeSession` calls
  the disposer once; `add` twice on one key disposes the first; `remove` is a no-op for an unknown
  key; `disposeSession` twice is safe; a throwing disposer still lets siblings run.
  Run `npx vitest run packages/server/src/ws/session-subscriptions.test.ts`.
- Leak regression test (the point of this task): drive a real socket through
  `checkout_status_subscribe`, then close the socket **without** unsubscribing, and assert the
  `WorkspaceGitService` has no remaining listener for that cwd (via a spy on the `subscribe` return,
  or the service's own listener bookkeeping). Place it next to the existing ws/bootstrap tests, in
  whichever harness already builds a real session (`bootstrap.test.ts` does).
- `npx vitest run packages/server` for the wider server suite.

## Notes
- Keep `SessionSubscriptions` free of any domain knowledge (no cwd/path semantics) — key strings are
  namespaced by their caller (`checkout_status:<cwd>`, later `file_watch:<path>`), which is what lets
  one registry serve both families.
- A `WeakMap` means a closed-and-forgotten `Session` cannot keep its map alive even if a future caller
  forgets to dispose — belt and braces, not a substitute for the close hook.
