# Task 002 — Fork affordance on user rows + ordinal correlation — Summary

- **Sprint:** sprint-072-conversation-fork-ui
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

A hover-revealed fork `IconButton` on confirmed user-message rows, gated by capability/turn-state/
process-existence, plus a pure, store-free ordinal-correlation helper that maps a clicked row to a
verified Pi `entryId` (or falls back to the picker on any mismatch — never forking an unverified
entry).

- `fork-gate.ts`'s `canOfferFork({forkTimelineSync, running, agentId})` — the session-level
  visibility predicate (visual spec § 03). Session-level, not per-row: when false, ALL rows lose
  their button at once, not just the newest one.
- `fork-correlation.ts` — `isConfirmedUserRow` (never `pending`/`failed`) is the single predicate
  `collectConfirmedUserRows` and `buildConfirmedOrdinalByRowId` both filter through, so a row's
  ordinal always lines up with its position in the confirmed-rows text list.
  `correlateForkTarget(confirmedUserRowTexts, clickedIndex, messages)` re-derives that same
  ordinal against a fresh `forkMessages()` result and matches only when the ordinal is in range
  AND the whitespace-normalized texts agree; otherwise `{ outcome: "fallback-to-picker" }`.
- `use-fork-action.ts` — combines the gate + ordinal map + click handler (`forkMessages()` fresh
  every call, never cached) into one `ForkRowWiring` that `Timeline` threads through
  `renderRow`/`renderComposedItem` to each `UserRow`. On a correlation match it calls
  `fork-store.ts`'s `openConfirm(agentId, target)`; on a fallback, `openPicker(agentId, messages)`.
  Errors are caught and logged (toasts are task-004's scope).
- `stores/fork-store.ts` — the new dialog-target store (`{status: "closed" | "confirm" | "picker"}`)
  task-003's dialog/picker will render; a dedicated file rather than folding into `ui-store.ts`,
  mirroring why `agent-ui-store.ts` is its own file.
- `UserRow.tsx` — new `onFork?: (() => void) | null` prop; renders the button in `RowShell`'s
  meta-line trailing slot (after the `queued` chip, per the visual spec's collision order) only
  when non-null. `FORK_ROW_TOOLTIP = "Fork from here"` (§ 12 copy deck, verbatim).
- `RowShell.module.css` — added `.forkButton`'s opacity-only hover-reveal rules
  (`.shellRow:hover`/`:focus-within`), co-located with the pre-existing `.metaTime` rules for the
  same CSS-Modules-scoping reason (the selector must resolve against THIS file's own `.shellRow`).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/fork-gate.ts` | created |
| `packages/web-client/src/features/chat/fork-gate.test.ts` | created |
| `packages/web-client/src/features/chat/fork-correlation.ts` | created |
| `packages/web-client/src/features/chat/fork-correlation.test.ts` | created |
| `packages/web-client/src/features/chat/use-fork-action.ts` | created |
| `packages/web-client/src/stores/fork-store.ts` | created |
| `packages/web-client/src/features/chat/rows/UserRow.tsx` | modified — `onFork` prop + button |
| `packages/web-client/src/features/chat/rows/RowShell.module.css` | modified — `.forkButton` styles |
| `packages/web-client/src/features/chat/Timeline.tsx` | modified — wires `useForkAction` through `renderRow`/`renderComposedItem` |
| `packages/web-client/AGENTS.md` | modified — source layout + Conversation fork invariant |

## How it satisfies the scope

Maps directly to `swe/features/conversation-fork.md` § web-client: fork affordance and the visual
spec's § 02/§ 03 (anatomy, placement, visibility matrix) and § 12 (copy deck). The dialog/picker
components themselves, composer prefill, toasts, and compact/keyboard behavior are explicitly out
of scope (later tasks) — this task only builds the affordance and the click → correlated-target
pipeline that will feed them.

No deviations from the task spec. One design decision beyond the letter of the spec: `fork-gate.ts`
checks `agentId !== null` explicitly (rather than relying solely on the structural fact that a
process-less draft can never have a confirmed row to attach a button to), since the acceptance
criterion is about observable button absence, not an inference from a different invariant — this
also makes the "process-less draft" case directly unit-testable.

## Build & test results

```
$ npx tsc -b packages/web-client --force
(no output — clean)

$ npx oxlint <touched files>
(no output — clean)

$ npx oxfmt <touched files>
Finished in 94ms on 6 files using 32 threads.

$ npx vitest run packages/web-client/src/features/chat/fork-correlation.test.ts packages/web-client/src/features/chat/fork-gate.test.ts
Test Files  2 passed (2)
     Tests  16 passed (16)

$ npx vitest run packages/web-client
Test Files  92 passed (92)
     Tests  1259 passed (1259)

$ npm run build:web-client
✓ built in 10.23s
```

## Acceptance criteria

- [x] The button appears on hover over a confirmed user row and never on a `pending`/`failed` row
      (verified live: hover reveal via real CDP pointer move, opacity 0→1→0; row height pinned at
      66px throughout).
- [x] No fork UI renders at all when `forkTimelineSync` is not advertised (`fork-gate.test.ts`).
- [x] The button is absent while a turn is running, and on a process-less draft session (verified
      live: a `#ui confirm` mock recipe held a turn open — all three existing rows' buttons
      vanished together and reappeared together on completion, proving the gate is session-level,
      not per-row; process-less-draft case covered by `fork-gate.test.ts`).
- [x] Row height does not shift when the button appears/disappears (verified live, see above).
- [x] `forkMessages()` is called on every click, never served from a cache (no memoization in
      `use-fork-action.ts`; verified live with no console error on a real click).
- [x] Ordinal out of range **or** normalized-text mismatch opens the picker instead of forking
      (`fork-correlation.test.ts`; verified live — the mock's fixed entry mismatched the real
      clicked row's text and resolved to `openPicker`, not a fork).
- [x] The correlation helper is pure and covered by unit tests including both fallback triggers
      (`fork-correlation.test.ts` — 11 tests, including whitespace-only-difference-still-matches).

## Follow-ups / TODO(verify)

- Whether steered/queued user messages appear in `get_fork_messages` identically to how the
  timeline renders them as user rows — inherited from the spec, still unresolved (requires a real
  `pi` process; unavailable in this environment). The text-equality fallback covers a mismatch
  either way, so nothing is unsafe in the meantime.
- Task-003 (confirm dialog + picker) is the next consumer of `fork-store.ts`'s dialog state.
