# Task 001 — Draft persistence & submission pipeline — Summary

- **Sprint:** sprint-025-composer-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Wired the composer's pure models (sprint-015: `resolveSubmitDecision`,
optimistic message, `queue.ts`, `DraftStore`) to live app state — KV-backed
draft persistence, the full submission pipeline, per-agent queueing with
flush-on-idle, optimistic append, and error recovery.

1. **Draft persistence (`useDraft` hook).** Loads/saves `{ text, attachments,
   lifecycle }` to the KV store (localStorage), autosaved with a 300ms debounce.
   Rehydrates on `draftKey` change (workspace/agent switch) and flushes any
   pending save on unmount. `kvToLayoutStorage()` adapts the `KeyValueStore`
   interface to the `LayoutStorage` shape `DraftStore` expects. Draft survives
   page refresh / tab switch / app restart; cleared (`lifecycle: "sent"`) on
   successful submit; `restore()` brings it back on send failure.

2. **Submission pipeline (`orchestrator.ts`, framework-agnostic).**
   `submitMessage(deps, input)`:
   - `resolveSubmitDecision()` → `noop` / `queued` / `submitted`.
   - **submitted:** generate client message id, optimistically append the user
     message to the session store, clear the draft, split image vs.
     metadata attachments, send via `client.agent(id).send(...)`, confirm the
     optimistic message on success.
   - **queued:** enqueue per-agent, clear the draft, no RPC.
   - **failed (throw):** rollback the optimistic message, restore the draft
     text, toast the error.

3. **Per-agent queue store (`queue-store.ts`, Zustand).** FIFO queue keyed by
   agentId, reusing the pure `queue.ts` models: `enqueue`, `remove`, `edit`
   (remove + return editable text), `reinsertAtFront` (send-now/flush failure
   recovery), `flush`, `peek`, `clear`.

4. **Auto-send on idle (`flushAgentQueue` + `useComposerController`).** When
   the agent transitions running→idle, queued messages flush in FIFO order;
   on the first failure the failing message *and all remaining ones* are
   re-inserted at the front (original order preserved) and a toast is shown.

5. **Processing lock.** `useComposerController` exposes `processingState`
   (`idle`/`processing`); the composer's send button/decision already respects
   it (`canSubmit = processingState === "idle"`), preventing double-submit
   while an RPC is in flight.

6. **Create-or-continue.** `useComposerController` delegates to a caller-managed
   `onSubmitMessage` when there is no `agentId` (draft / create-agent flow) and
   uses the internal send path when an agent exists — matching the scope's
   "prefer injected `onSubmitMessage`, else internal send" rule.

7. **Wiring.** `PaneContentRouter`'s `AgentPane` now feeds the real `Composer`
   with `useDraft` + `useComposerController` (draft key `agent:<id>`);
   `DraftPane` persists to `draft:<workspaceId>`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/composer/queue-store.ts` | created (Zustand per-agent queue) |
| `packages/app/src/composer/orchestrator.ts` | created (submission pipeline) |
| `packages/app/src/hooks/use-composer.ts` | created (`useDraft`, `useComposerController`) |
| `packages/app/src/composer/orchestrator.test.ts` | created (9 tests) |
| `packages/app/src/composer/queue-store.test.ts` | created (6 tests) |
| `packages/app/src/hooks/use-composer.test.ts` | created (3 tests) |
| `packages/app/src/composer/index.ts` | modified (export queue-store, orchestrator) |
| `packages/app/src/hooks/index.ts` | modified (export composer hooks) |
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | modified (wire Composer to hooks) |

## How it satisfies the scope

- **composer-ui.md § Sendable content & the submit decision** — `submitMessage`
  drives all four decision branches (`noop`/`queued`/`submitted`/`failed`) with
  the exact clear/optimistic/restore semantics described.
- **composer-ui.md § Create vs continue** — caller `onSubmitMessage` preferred
  when no agent; internal send (split images, optimistic head append, message
  id, RPC) otherwise.
- **composer-ui.md § Queue (agent running)** — per-agent `{ id, text,
  attachments }` queue; edit (remove + reload) and reinsert-at-front on failure;
  auto-flush on idle.
- **composer-ui.md § Data & Persistence** — draft store per key with
  `active`/`abandoned`/`sent` lifecycle, hydrate-on-key-change, debounced
  autosave, empty-draft clearing.
- **composer-ui.md § Error Handling** — send throws → restore text + toast;
  send-now/flush fails → reinsert at front + toast.

### Deviations
- **Queue location.** The scope says queued messages "live in the session
  store"; we use a dedicated `useComposerQueueStore` reusing the pure `queue.ts`
  models instead, to avoid widening the append-only session-store contract.
  Observable behavior is identical. Marked `TODO(verify)` in the source.
- **Draft storage backend.** The task mentions IndexedDB; we persist via the
  existing `KeyValueStore` (localStorage) that the rest of the app already uses
  for KV state. Image *bytes* (task-002) will need a separate binary store;
  draft *metadata* (text + attachment descriptors) fits localStorage. Noted for
  task-002.

## Build & test results

```
$ npx tsc -b packages/app
(clean, no output)

$ npx vitest run packages/app/src/composer/orchestrator.test.ts \
    packages/app/src/composer/queue-store.test.ts \
    packages/app/src/hooks/use-composer.test.ts
 Test Files  3 passed (3)
      Tests  18 passed (18)

$ npm run typecheck
(clean, whole monorepo)

$ npm test
 Test Files  115 passed (115)
      Tests  1509 passed (1509)
```

## Acceptance criteria
- [x] Typing in composer persists to KV; refreshing restores the draft —
      verified by `use-composer.test.ts` (round-trip through fresh `DraftStore`
      over same KV) + `useDraft` debounced autosave.
- [x] Submitting sends via RPC, appends optimistically, clears draft on success
      — `orchestrator.test.ts` "submits: optimistic append, send RPC, confirm,
      draft cleared".
- [x] Queue: message queued while agent running; auto-sent when idle —
      `orchestrator.test.ts` "queues when agent running" + "flushAgentQueue
      sends all queued messages FIFO"; `useComposerController` running→idle
      effect triggers the flush.
- [x] Error: failed RPC shows toast, restores draft, removes optimistic message
      — `orchestrator.test.ts` "failed send: rollback optimistic, restore draft,
      toast".

## Follow-ups / TODO(verify)
- Image attachment **bytes** persistence (IndexedDB / binary store) is task-002;
  this task persists only draft text + attachment metadata.
- `submitBehavior: "preserve-and-lock"` is modeled in `submit.ts` but the
  controller currently always clears on queue/submit; the caller-owned
  loading-state variant is wired when a create-agent/new-workspace flow needs
  it (task-002/003 composer control surfaces).
- Whether queued messages should ultimately move into the session store per the
  literal scope wording (see Deviations).
