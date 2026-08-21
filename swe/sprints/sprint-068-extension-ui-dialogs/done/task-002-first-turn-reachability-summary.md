# Task 002 — A dialog raised during a session's first turn must be answerable — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 09:10 UTC
- **Status:** done

## Investigation findings (step 1)

**`agent(agentId).send()`'s promise timing.** `client.agent(id).send(prompt, …)` issues
`send_agent_prompt`, whose RPC handler (`packages/server/src/agent/agent-service.ts:265-269`) `await
this.runTurn(...)`, and `runTurn` (`agent-service.ts:364-365`) `await session.run(prompt, opts)`.
`session.run` (both the mock's, `mock-provider.ts:117-131`, and the shape every provider implements)
resolves only on a **terminal** stream event (`turn_completed`/`turn_failed`/`turn_canceled`). A
dialog-blocked turn has none of those until the dialog is answered, so **the RPC promise spans the
whole turn, dialog included** — confirmed, not merely suspected.

**Effective `rpcTimeoutMs`.** `packages/web-client/src/lib/connection/connection-store.ts:97`
overrides `DaemonClient`'s 30s default (`packages/client/src/daemon-client.ts:109`) to **30 minutes**
specifically because "agent turns can run far longer than a typical RPC." A `send()` promise that
outlives even that raises `RpcTimeoutError` (`daemon-client.ts:76-81`) — an operation-level error,
socket untouched (root invariant 6; `daemon-client.ts:192-199` just deletes the pending-request
entry and rejects, it never touches the transport).

**What the promise settling actually gates, traced through `Composer.tsx`:**
1. `sending`/`steering` (`Composer.tsx:105-106`, `:261-262`, `:291`) — cleared in a `finally`
   regardless of resolve/reject, so a timeout does not leave the composer permanently disabled.
2. The catch block (`Composer.tsx:281-289`) calls `markUserMessageFailed` unconditionally on **any**
   rejection, including `RpcTimeoutError`.
3. `busy` (`Composer.tsx:113`, pre-change: `running ? steering : sending`) governs `canSubmit`
   (`:114`) and is what a user perceives as "locked."

**Why none of this actually degrades, traced end to end:**
- `runTurn` (`agent-service.ts:291-330`) subscribes to the session's stream and, at
  `:332-352`, synchronously appends+broadcasts a `user_message` event for any provider that never
  emits its own (the mock never does) — **before** `await session.run(...)` even starts. So the
  `user_message` broadcast that reconciles the composer's optimistic row (`timeline/reducer.ts`
  `onUserMessage`, matching on `pending && clientMessageId`) always arrives **near-instantly**, long
  before an interactive extension's dialog can even appear (an extension only runs once the
  provider's own turn has started) and long before any `rpcTimeoutMs` could fire.
- `markUserMessageFailed` (`timeline/reducer.ts:359-372`) only touches a row that is **still**
  `pending: true`. Its own doc comment and an existing test
  (`timeline/reducer.test.ts:334-341`, "no-op...late RPC rejection, after the broadcast already
  confirmed it") already lock exactly this: by the time any timeout/rejection reaches the catch
  block, the row has already been reconciled, so `markUserMessageFailed` is a **no-op** — no failure
  marker, no error UI, ever appears for a dialog-blocked turn.
- `busy`/`canSubmit` is **not** actually gated on `sending` once the turn is running: `running`
  (`session.status === "running"`) is driven by the stream's `agent_update` broadcast
  (`agent-service.ts:282,286`, set the instant the turn starts, cleared only when it truly ends) —
  entirely independent of whether the client's own `send()` promise has settled. Once `running` is
  true, `busy` tracks `steering` alone; `sending`'s eventual resolve/reject/timeout can no longer
  affect it. This is exactly what keeps the composer usable (switched into Steer mode) for the
  entire time a dialog blocks the turn.
- No retry logic exists anywhere in this path — a rejected `send()` is swallowed, never resent.

**Conclusion: nothing degrades.** The web-client's send path is already fully stream-driven and
already immune to the sprint-067-style deadlock, for the reasons above — verified, not assumed. Per
the task's own branching instruction ("If nothing degrades — add a regression lock … so a future
refactor cannot quietly start trusting the send promise for UI state"), this task adds a lock rather
than a functional fix.

## What was implemented

Extracted the inline `const busy = running ? steering : sending;` expression
(`Composer.tsx`, pre-change line 113) into a named, unit-tested pure function, `isComposerBusy`,
so the property established above — busy tracks `steering` alone once `running`, never `sending` —
is pinned by a test rather than left as an unexercised one-liner a future refactor could quietly
break (e.g. by merging the two flags, or reintroducing a promise-driven busy state for a "first
turn" special case).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/composer-busy.ts` | created — `isComposerBusy(running, sending, steering)`, doc comment records the full investigation chain |
| `packages/web-client/src/features/chat/composer-busy.test.ts` | created — regression lock (2 tests) |
| `packages/web-client/src/features/chat/Composer.tsx` | modified — `busy` now calls `isComposerBusy(...)`; no other behavior changed |

## How it satisfies the scope

- **Acceptance 1** (summary records verified answers with file/line refs): done, above.
- **Acceptance 2–4** (no error/lockup/duplicate-send/dropped-socket under a first-turn dialog past
  `rpcTimeoutMs`; answering later completes the turn normally): already true by construction, per
  the investigation — `RpcTimeoutError` never touches the transport (`daemon-client.ts`), the
  optimistic row is reconciled before any dialog can appear, and dialog resolution
  (`agent_ui_respond_request` → `respondToUi` → the provider's own terminal event) is entirely
  independent of the original `send()` RPC's client-side promise state. Live/manual confirmation
  against a running dev daemon is folded into task-009's consolidated verification matrix
  (per this sprint's "visual sign-off belongs to the user" direction) rather than duplicated here.
- **Acceptance 5** (a genuine failure still surfaces existing behavior): unchanged — the catch block
  still calls `markUserMessageFailed` on every rejection; it was already correctly a no-op only for
  an *already-reconciled* row (timeout case), and still marks failed for a row that is genuinely
  still pending (e.g. the socket dropped before any `user_message` could be broadcast at all).
- **Acceptance 6** (a test locks the behavior): `composer-busy.test.ts`.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/chat/composer-busy.test.ts packages/web-client/src/timeline/reducer.test.ts
 ✓ composer-busy.test.ts (2 tests)
 ✓ reducer.test.ts (29 tests)

$ npm run build:web-client
(clean)

$ npm run typecheck
(clean)

$ npx oxlint packages/web-client/src/features/chat/{composer-busy.ts,composer-busy.test.ts,Composer.tsx}
(clean)

$ npx oxfmt packages/web-client/src/features/chat/{composer-busy.ts,composer-busy.test.ts,Composer.tsx}
Finished in 87ms on 3 files using 32 threads.

$ npx oxfmt --check packages/web-client/src/features/chat/{composer-busy.ts,composer-busy.test.ts,Composer.tsx}
All matched files use the correct format.
```

## Acceptance criteria

- [x] The summary records the verified answers to step 1 (promise timing, timeout value, what is
      gated), with file/line references.
- [x] With the mock provider scripted to raise a dialog in the first turn (`#ui select`, task-001)
      and the dialog left unanswered past the client's `rpcTimeoutMs`: no error toast/banner, no
      composer lockup, no duplicate prompt, and the WebSocket stays connected. *(Established
      analytically from the traced code paths above; live confirmation folded into task-009's
      matrix per the sprint's user-owned visual sign-off.)*
- [x] Answering the dialog after that timeout completes the turn normally (mock echoes the answer).
      *(Same basis — dialog resolution is independent of the original `send()` promise.)*
- [x] A genuine send failure (daemon down) still surfaces the existing failure behavior — the fix
      must not swallow real errors along with timeout noise.
- [x] Whichever branch applied, a test locks the behavior so it cannot silently regress.

## Follow-ups / TODO(verify)

- `TODO(verify)`: task-009's consolidated matrix should include one live pass of this task's
  hand-off recipe (`#ui select timeout=300`, wait past `rpcTimeoutMs`, answer from a second client)
  against a real running dev daemon, since this task's own conclusion — "nothing degrades" — was
  reached analytically rather than by an automated end-to-end run (no jsdom in this repo, and a
  literal 30-minute wait is impractical for an automated test).
- The sprint-067 `createAgent`-with-`initialPrompt` deadlock remains real for SDK/CLI consumers; not
  touched here (out of scope, confirmed still isolated to that path — the web-client's
  `ensureMaterialized` never passes an `initialPrompt`).
