# Task 002 — `agent-ui-state.ts`: pure reducer, predicate routing, effects, selectors — Summary

- **Sprint:** sprint-067-extension-ui-sdk
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

`packages/client/src/agent-ui-state.ts` — a framework-free, side-effect-free reducer plus
selectors that owns the entire extension-UI state machine: predicate-driven routing (dialog /
surface-upsert / surface-clear / transient), wholesale snapshot replacement, disconnect/reconnect
`answerable` round-trip, agent-lifecycle pruning, and a pure, never-acted-on `remainingMs` countdown.

Routing (`reduceUiRequest`) is driven strictly by `expectsResponse` / `surfaceKey` / `removed` —
`method` is read only inside `buildTransientEffects`, the one place the scope permits it, to decide
which effect shape to build within the already-decided transient category. An unrecognised
fire-and-forget method therefore returns zero effects with no state change (the caller's own
"unknown method" signal); an unrecognised dialog method still enters `pending` with `method` stored
verbatim and no unknown/fallback flag, since a flag would require exactly the known-methods table
this module refuses to keep.

`reduce()` never mutates its input: every branch builds new objects (`{ ...state, ... }` / fresh
`Record` builds for wholesale rebuilds). `snapshot` replaces `pending`/`surfaces` wholesale rather
than merging — verified with a test where a snapshot's surface has an *older* `updatedAt` than the
pre-existing entry and still wins, proving there is no newest-wins comparison anywhere in the
snapshot path. `disconnected` only flips `answerable: false`; only a following `snapshot` sets it
back `true` — the one-way-door round-trip is asserted explicitly. `remainingMs` is a pure read with
no companion action anywhere in the module that could dismiss/expire an entry on timeout; only a
real `ui_resolved` action ever removes one.

## Files created / changed

| File | Change |
|---|---|
| `packages/client/src/agent-ui-state.ts` | created — types, `reduce`, `surfaceMapKey`, four selectors |
| `packages/client/src/agent-ui-state.test.ts` | created — 34 tests covering every acceptance criterion |
| `packages/client/src/index.ts` | added `export * from "./agent-ui-state.js"` (matches the existing barrel-export convention for every other `src` module) |

## How it satisfies the scope

Implements `swe/features/extension-ui-client-sdk.md` § Pure state module, § Routing taxonomy,
§ Rehydration, § Timeout display, § Unknown methods, § Transient effects, § Disconnect,
§ Agent lifecycle, and task-002's own § What to build verbatim — the exported type/function
signatures match the task's `ts` block exactly. No deviations.

One judgment call not pinned down by the task: `notify`'s default `level` when the field is absent
from `payload` (the spec only says the value is "forwarded verbatim" when present). Defaulted to
`"info"`, matching the rest of the codebase's presentation-event convention
(`ProviderAuthNotifyEvent`'s `kind: "info"`). Not exercised by an acceptance criterion; documented
here as the one place this task made a choice the scope left open.

## Build & test results

```
$ npx tsc -b --force
(no output — clean)

$ npx oxlint packages/client/src/agent-ui-state.ts packages/client/src/agent-ui-state.test.ts packages/client/src/index.ts
(no output — clean; two initial Array#sort warnings fixed by switching to Array#toSorted)

$ npx oxfmt --check packages/client/src/agent-ui-state.ts packages/client/src/agent-ui-state.test.ts packages/client/src/index.ts
All matched files use the correct format.

$ npx vitest run packages/client/src/agent-ui-state.test.ts packages/client/src/pistudio-client.test.ts
 Test Files  2 passed (2)
      Tests  77 passed (77)
```

## Acceptance criteria

- [x] All nine documented Pi methods land in the correct category, asserted per method, driven only
      by wire predicates (`it.each` over `select`/`confirm`/`input`/`editor` and
      `setStatus`/`setWidget`/`setTitle`, plus explicit `notify`/`set_editor_text` tests; a
      dedicated test also proves a made-up method name routes purely on `expectsResponse`/
      `surfaceKey`, never on the string itself).
- [x] An unknown dialog method enters `pending` verbatim with no unknown/fallback flag; an unknown
      fire-and-forget method changes no state and returns zero effects.
- [x] Two agents may hold the same `surfaceKey` without collision; an upsert to one leaves the other
      untouched.
- [x] `removed: true` for a never-seen `surfaceKey` is a no-op; upsert-then-clear leaves no surface.
- [x] A later surface upsert replaces an earlier one for the same `(agentId, surfaceKey)` despite a
      different `requestId` (last-write-wins, not `requestId`-deduped).
- [x] `ui_resolved` for an unknown `requestId` returns state unchanged and does not throw.
- [x] `snapshot` replaces wholesale: an entry absent from the snapshot is gone afterwards; an
      "older" snapshot surface still wins over a "newer" pre-existing one.
- [x] `disconnected` → `answerable: false` on all pending, nothing removed; a following `snapshot`
      restores `answerable: true` (round-trip explicitly asserted).
- [x] `agent_removed` drops that agent's surfaces and pending entries, other agents' state untouched.
- [x] `set_editor_text` produces exactly one `replace_composer_text` with `{ agentId, text }`;
      `notify` with `level: "warning"` forwards `"warning"` verbatim.
- [x] `remainingMs` returns `null` without `timeoutMs`; anchors on `receivedAt` when present; accepts
      a snapshot entry's `createdAt` as both epoch ms and ISO string; clamps at `0`.
- [x] No exported function dismisses/expires/mutates an entry on timeout — a test advances `now` to
      `999_999_999` and shows the entry still present in `state.pending` with `answerable: true`.
- [x] `pendingByAgent` omits agents with zero pending dialogs.
- [x] Every reducer call leaves its input `state` object untouched — asserted by deep-freezing the
      seed state and running all six action types against it without a throw.
- [x] Tests run under Node with no jsdom (root Vitest config's default `node` environment; no jsdom
      import anywhere in the new test file).

## Follow-ups / TODO(verify)

- The `notify` default `level` ("info") is an unpinned judgment call noted above — not a defect, but
  worth a one-line confirmation from whoever builds the rendering scope (sprint-068) if they want a
  different default.
- task-003 (controller) consumes `reduce`/selectors/`initialAgentUiState` directly; no further
  changes anticipated here.
