# Task 004 — Pure presentation modules: outcome line, option layout, prompt text, deadline — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 09:23 UTC
- **Status:** done

## What was implemented

Four pure modules under `packages/web-client/src/features/agent-ui/`, each with a colocated test,
following the `onboarding-nudge.ts`/`format-meta-time.ts` convention (no React, no DOM, no timers):

- **`outcome-line.ts`** — `outcomeLine(entry: AgentUiResolvedEntry) → { tone, glyph, text, truncate }`.
  Never echoes a typed value for `input`/`editor` (fixed "answered"/"submitted" strings,
  unconditionally — those two methods never retain an `answer` on the SDK side regardless of who
  answered, so there is no "answered elsewhere" variant to distinguish for them). For
  `select`/`confirm`, `answer === undefined` on a `reason: "answered"` entry means another client
  won the race → "no longer pending"; a local answer renders the chosen value (`select`) or a fixed
  "Yes"/"declined" (`confirm` — no destructive variant exists on the wire). `cancelled` → "declined"
  (same copy as a confirm "no" — § 04's explicit unification); `timeout` → "expired"; anything else
  (e.g. `"aborted"`) prints the raw reason string verbatim, muted, never relabelled.
- **`option-layout.ts`** — `optionLayout(options) → { mode: "row" | "stack", scrolls }`. Stacks at
  5+ options or any label over ~40 chars (§ 12's own worked "EXACT STACKING THRESHOLD" example);
  scrolls past 6 options (§ 12's nine-option case). No ordinals, no dedup — a pure pass-through of
  the layout decision.
- **`prompt-text.ts`** — `promptLines(text) → string[]` (hard breaks on `\n`, consecutive blank
  lines collapsed to one, bracketed prefixes preserved verbatim) and
  `confirmPromptParts(title, message?) → { title, message? }` (message key entirely absent, not an
  empty array, when none was sent).
- **`deadline.ts`** — `deadline(entry: AgentUiPendingEntry, now) → { show, fraction, approximate }`.
  Deliberately **reuses** the SDK's own `remainingMs` selector (`@av-pi-studio/client`) rather than
  recomputing the `receivedAt`-vs-`createdAt` anchor logic a second, divergent time — per the task's
  own "consume those; do not recompute them" instruction. `approximate` is `receivedAt === undefined`
  verbatim; `editor` needs no special case since it never carries `timeoutMs` on the real wire, and
  absent `timeoutMs` already yields `show: false`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/outcome-line.ts` + `.test.ts` | created (11 tests) |
| `packages/web-client/src/features/agent-ui/option-layout.ts` + `.test.ts` | created (9 tests) |
| `packages/web-client/src/features/agent-ui/prompt-text.ts` + `.test.ts` | created (9 tests) |
| `packages/web-client/src/features/agent-ui/deadline.ts` + `.test.ts` | created (7 tests) |

## How it satisfies the scope

- **outcome-line**: "never returns a value string for input/editor" proven by feeding a
  secret-looking payload/prefill and asserting `JSON.stringify(line)` never contains it (the module
  doesn't even read `payload` for those methods — the test proves the stronger claim). Unrecognised
  reasons printed verbatim (`"aborted"`, `"some-future-reason"`).
- **option-layout**: § 03 live-captured stacking payload is represented via the § 12 "EXACT
  STACKING THRESHOLD" worked example (see Notes — a documented judgment call on which fixture
  actually demonstrates the length-based rule); nine-option case returns `scrolls: true`; empty
  array handled without throwing; duplicate labels produce identical, unmodified output.
- **prompt-text**: § 03's live-captured multi-line `input` title renders as separate lines with the
  blank-line run collapsed and `[Color]` intact, verbatim.
- **deadline**: `show: false` with no `timeoutMs`; `approximate: true` when `receivedAt` is absent;
  fraction strictly decreases as `now` advances for a fixed entry, clamped at `0`.
- Every module is pure: no React/DOM imports (grep-verified — only type imports from
  `@av-pi-studio/client`, no framework imports anywhere).

## Build & test results

```
$ npx vitest run packages/web-client/src/features/agent-ui/
 ✓ option-layout.test.ts (9 tests)
 ✓ prompt-text.test.ts (9 tests)
 ✓ outcome-line.test.ts (11 tests)
 ✓ deadline.test.ts (7 tests)
 ✓ agent-ui-store.test.ts (10 tests)   # task-003, unaffected — full directory suite green
 Test Files  5 passed (5) · Tests  46 passed (46)

$ npm run build:web-client
(clean)

$ npm run typecheck
(clean)

$ npx oxlint packages/web-client/src/features/agent-ui/
(clean)

$ npx oxfmt packages/web-client/src/features/agent-ui/{outcome-line,option-layout,prompt-text,deadline}{,.test}.ts
Finished in 89ms on 8 files using 32 threads.

$ npx oxfmt --check … (same files)
All matched files use the correct format.
```

## Acceptance criteria

- [x] `outcome-line` never returns a value string for `input`/`editor`, proven by a test that feeds
      a resolved entry whose payload contains a secret-looking string and asserts it appears nowhere
      in the output.
- [x] An unrecognised `reason` is returned verbatim in the muted tone.
- [x] `option-layout` stacks the § 03 live-captured payload (self-numbered, long labels) and returns
      `scrolls: true` for the nine-option case; an empty array is handled without throwing.
- [x] Duplicate identical labels produce identical output with no ordinal and no synthetic key.
- [x] `prompt-text` renders the § 03 live-captured multi-line `input` title as separate lines with
      the blank-line run collapsed and `[Color]` intact.
- [x] `deadline` returns `show: false` with no `timeoutMs`; `approximate: true` when `receivedAt` is
      absent; a fraction that only ever decreases for a fixed entry as `now` advances.
- [x] Every module is pure: no imports from React, the DOM, or the store.

## Follow-ups / TODO(verify)

- **Documented judgment call on the "§ 03 live-captured" stacking fixture.** The live-captured
  select payload quoted in § 03 ("[Color] Which color do you pick?" / three self-numbered options,
  longest 30 characters) is prose-described as clearing "the ~40-character stacking threshold," but
  by literal character count none of its three options exceed 40, and the array itself is short of
  the 5-option count threshold — so it would render `mode: "row"` under the numeric rule this task
  states explicitly ("stack when five or more options, or when any label exceeds the § 12
  threshold"). Rather than inventing a lower, unstated threshold to force that specific fixture into
  `"stack"`, this task takes § 12's own **worked, explicitly-threshold-pinning example** ("EXACT
  STACKING THRESHOLD" — one 95-character option) as the authoritative numeric test case, since § 12
  states outright "this mock exists to pin the exact threshold." `TODO(verify)`: flag this
  discrepancy to the designer alongside task-009's other three filed spec corrections — either § 03's
  descriptive text is imprecise (most likely, given § 12 exists specifically to pin the number), or
  the real threshold is narrower than "~40" and should be restated.
