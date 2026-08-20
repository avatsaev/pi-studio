# Task 005 — resolved dialog retention — Summary

- **Sprint:** sprint-067-extension-ui-sdk
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

Gave `agent-ui-state.ts` a `resolved` slice and `agent-ui-controller.ts` in-flight submission
tracking, per `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec(1).html` rev 2 §04/§05/§06
(resolved dialogs collapse in place and persist for the page's life; a pressed control shows a
spinner while its answer is in transit; the merged pending+resolved list never reshuffles).
Everything stays inside the module's existing contract: pure, no DOM, no timers, no I/O, no clocks.

1. **State (`agent-ui-state.ts`)**:
   - `AgentUiResolvedEntry` (`requestId`, `agentId`, `method`, `payload`, the **original**
     `createdAt`, `reason` forwarded verbatim, optional `answer`) and `AgentUiAnswer`
     (`{ value?, confirmed? }`).
   - `AgentUiState.resolved: Record<requestId, AgentUiResolvedEntry>`; `initialAgentUiState` updated.
   - `AgentUiPendingEntry.submitting?: boolean` / `.submittedAnswer?: AgentUiAnswer`.
   - Two new actions: `respond_sent { requestId, response }`, `respond_failed { requestId }`.
   - `reduceUiResolved` now moves the entry (not deletes it) into `resolved` via `addResolvedEntry`,
     which also enforces the per-agent `RESOLVED_HISTORY_LIMIT` (`50`) — eviction of the oldest
     entry by the same `createdAt`/`requestId` comparator the selectors use, scoped to one agent.
   - `buildSnapshotState` now takes a third `resolved` parameter and threads it through untouched —
     the daemon has no resolved history to re-serve, so `snapshot` must not wipe it.
   - `dropAgent` now also filters `resolved` for `agent_removed`.
   - `applyRespondSent`/`applyRespondFailed` handle the two new actions; `applyRespondFailed`
     rebuilds the entry explicitly (not spread-and-delete) so a lost first-answer-wins race clears
     the spinner without leaving stray fields.
   - `answerFromResponse(method, response)` — the one deliberate, narrow exception to "never inspect
     `method` outside routing": returns an answer **only** for `select`/`confirm`; `input`/`editor`
     (and any unrecognised method) always return `undefined`, so a submitted secret is
     unrepresentable in state, not merely unrendered by UI convention.
   - New selector `resolvedForAgent` — identical comparator/shape to `pendingForAgent`, so merging
     both by `createdAt` keeps a card's list index stable across resolution.

2. **Controller (`agent-ui-controller.ts`)**: `respond` is no longer a bare pass-through. It now
   dispatches `respond_sent` synchronously (before the RPC round-trips, so a spinner can render
   immediately), awaits `client.respondToUi`, and dispatches `respond_failed` only when the result
   is `{ ok: false }` — a successful RPC does **not** itself clear `submitting`; only the resulting
   `agent_ui_resolved` broadcast does, preserving the "no optimistic resolution" invariant task-003
   established.

## Files created / changed

| File | Change |
|---|---|
| `packages/client/src/agent-ui-state.ts` | `resolved` slice, `submitting`/`submittedAnswer`, `respond_sent`/`respond_failed` actions, `RESOLVED_HISTORY_LIMIT`, `resolvedForAgent`, `answerFromResponse` storage rule, module header updated |
| `packages/client/src/agent-ui-state.test.ts` | +17 tests: resolved retention (move, field preservation, no-op on unknown id, survives snapshot/disconnected, agent_removed prunes it), `respond_sent`/`respond_failed`, select/confirm-only answer retention (including a `JSON.stringify` secret-leak scan), cap eviction, `resolvedForAgent` ordering + merge-stability; referential-integrity seed/actions extended to cover the new shape and actions; hoisted a test helper to module scope to keep lint clean |
| `packages/client/src/agent-ui-controller.ts` | `respond` now dispatches `respond_sent`/`respond_failed` around the RPC |
| `packages/client/src/agent-ui-controller.test.ts` | fixed a pre-existing assertion for the now-three-key empty state shape; +2 tests: submitting flips synchronously and the resolved entry carries the confirm answer; a domain failure dispatches `respond_failed` and still returns the result rather than throwing |
| `packages/client/AGENTS.md` | Purpose item 7, source-layout row, full rewrite of the `## Extension UI state + controller` section's state-module and controller bullet lists to document `resolved`, `RESOLVED_HISTORY_LIMIT`, `resolvedForAgent`, the select/confirm-only storage rule, and the new `respond` wiring |
| `swe/features/extension-ui-client-sdk.md` | § Pure state module: new actions/state field/selector in the existing lists, new "Resolved retention (task-005)" paragraph; § Controller: `respond` paragraph rewritten; § Rehydration: fixed stale "deleting an absent key" wording for the no-tombstones no-op, now accurate under retention |

## Build & test results (full monorepo gates)

```
$ npm run clean && npm run build      # forced full rebuild
(success — all packages including web-client's Vite bundle)

$ npm run typecheck                   # tsc -b, forced clean beforehand
(success, zero errors)

$ npm run lint
exit 0, 0 errors, 0 warnings in any agent-ui-* file

$ npx oxfmt --check packages/client/src/agent-ui-state.ts packages/client/src/agent-ui-controller.ts \
    packages/client/src/agent-ui-state.test.ts packages/client/src/agent-ui-controller.test.ts \
    packages/client/AGENTS.md swe/features/extension-ui-client-sdk.md
All matched files use the correct format.

$ npm test                            # full monorepo suite
Test Files  175 passed (175)
     Tests  2266 passed (2266)        # +19 over pre-task-005 baseline (2247)
```

## Acceptance criteria

- [x] `ui_resolved` moves an entry to `resolved`, preserving `createdAt`/`method`/`agentId`/
      `payload`, forwarding `reason` verbatim.
- [x] The resolved entry has no `timeoutMs`, `receivedAt`, `answerable`, or `submitting`.
- [x] `resolved` survives `snapshot` and `disconnected`; `agent_removed` drops that agent's resolved
      entries and leaves other agents' untouched.
- [x] `ui_resolved` for an unknown id remains a no-op — no synthesised entry, no throw.
- [x] `respond_sent` leaves the entry in `pending` with `submitting: true` and emits no effects.
- [x] `submittedAnswer`/`answer` are set for `select` and `confirm` and absent for `input`/`editor`
      (and unrecognised methods) — verified with a `JSON.stringify(state)` scan, not just a
      field-presence check, per the honest-test requirement.
- [x] `respond_failed` clears `submitting`, so a lost first-answer-wins race cannot leave a permanent
      in-flight state; a no-op when the entry is no longer pending.
- [x] Cap eviction: past `RESOLVED_HISTORY_LIMIT` for one agent, the oldest `createdAt` is evicted
      and other agents' resolved entries are untouched.
- [x] `resolvedForAgent` ordering matches `pendingForAgent`'s comparator; merging both by `createdAt`
      keeps an entry's index stable across resolution (asserted before/after resolving the middle
      entry of a three-entry list).
- [x] Controller: `respond` returning `{ ok: false }` dispatches `respond_failed` and still returns
      the result rather than throwing; a `{ ok: true }` result leaves `submitting` alone (cleared
      only by the subsequent `ui_resolved`, never by the RPC's own success).
- [x] `dispose()` still tears down cleanly with the new state shape present (full controller suite
      green, including the pre-existing dispose tests, unmodified).
- [x] Sprint gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Notes

- No changes to `surfaces`, the protocol package, the wire, or the daemon — confirmed via `git
  status`: only `packages/client/src/agent-ui-*.ts`/`.test.ts`, `packages/client/AGENTS.md`, and
  `swe/features/extension-ui-client-sdk.md` touched by this task.
- No rendering, no React, no new dependency added by this task.
- The rendering half of `features/extension-ui-client-sdk.md` (dialog components, the resolved-card
  collapse animation, the pressed-control spinner UI itself) remains the unplanned sibling scope —
  this task only makes the state that scope will consume correct and tested.
