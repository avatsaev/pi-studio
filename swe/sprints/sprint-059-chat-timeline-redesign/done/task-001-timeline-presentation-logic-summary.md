# Task 001 — Timeline presentation logic: diff stats, output summary, kind badges, raw status — Summary

- **Sprint:** sprint-059-chat-timeline-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Four pure, unit-testable helpers the redesigned `ToolCard` (task-004) needs, plus the raw wire
status carried alongside the normalized enum:

1. **`toolBadge(tool)`** (`tool-mapping.ts`) — per-kind badge `{ label, token }`. `write` maps to
   `statusSuccess` (not `success`, which aliases the accent color on dark variants); `edit` maps to
   `statusWarning`; `shell`/`read`/`search`/`fetch` map to `accent`; `task` — and any unrecognized
   kind — falls back to `foregroundMuted`. Mirrors the file's existing `toolIcon` lookup-table
   pattern.
2. **`toolDiffStats(diff)`** — counts `+`/`-` body lines in a unified diff, skipping `+++`/`---`
   file headers. Empty/absent diff → `{ added: 0, removed: 0 }`.
3. **`toolOutputLineCount(output)`** — line count for the `output · N lines` strip. Strips exactly
   one trailing `\n` before counting so `"a\nb\n"` doesn't over-count; empty output → 0; `"\n"` → 1.
4. **`toolPrimaryField`** — explicit re-export of `toolDetailText` under a name that reads intent at
   the call site (full untruncated value, vs. `toolInlineDetail`'s basename/first-line truncation).

**`ToolRow.statusText?: string`** (`row-model.ts`) carries the wire's free-form `tool_call.status`
string. `onToolCall` (`reducer.ts`) sets it from `event.status` when present, else keeps the prior
row's value (never clears on a status-less event, e.g. the diff/output-only "completed" event).
The normalized `status: ToolCallStatus` enum and its merge logic are byte-for-byte unchanged.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/timeline/tool-mapping.ts` | added `toolBadge`, `toolDiffStats`, `toolOutputLineCount`, `toolPrimaryField` |
| `packages/web-client/src/timeline/row-model.ts` | added `ToolRow.statusText?: string` |
| `packages/web-client/src/timeline/reducer.ts` | `onToolCall` threads `event.status` into `statusText`, merge-preserving across upserts |
| `packages/web-client/src/timeline/tool-mapping.test.ts` | added tests for the four new helpers |
| `packages/web-client/src/timeline/reducer.test.ts` | added a `statusText` passthrough test suite |

## How it satisfies the scope

Maps 1:1 to the task's five "What to build" items and the design spec § 04 badge/status/diff/output
requirements. No component, CSS, or protocol change — `ToolCallDetail`/`tool_call.status` already
carry everything needed (`packages/protocol/src/messages.ts:225-289`). `ToolCallStatus` union and
`"canceled"` intentionally not touched — reserved for `sprint-058/task-005` per the task's Notes.

## Build & test results

```
$ npm run clean && npm run typecheck
tsc -b
(zero errors)

$ npx oxlint packages/web-client/src/timeline/{tool-mapping,row-model,reducer}.ts packages/web-client/src/timeline/{tool-mapping,reducer}.test.ts
(no output — clean)

$ npx oxfmt --check <same files>
All matched files use the correct format. (after one scoped `oxfmt` fix to the new test file)

$ npm run build:web-client
✓ built in 7.64s

$ npx vitest run packages/web-client/src/timeline
Test Files  7 passed (7)
     Tests  142 passed (142)

$ npm test   (full workspace suite)
Test Files  149 passed (149)
     Tests  1789 passed (1789)
```

## Acceptance criteria

- [x] Every `ToolCallDetail` kind maps to its documented label + tint token; unrecognized kind falls
      back to `task` without throwing — `toolBadge` tests.
- [x] No mapping returns `success`; `write` returns `statusSuccess` — explicit test + full-table
      assertion that no kind returns the bare `success` token.
- [x] Diff stats count `+`/`-` body lines, ignore `+++`/`---` headers; no-change diff, empty string,
      and `undefined` all yield `{ added: 0, removed: 0 }` — `toolDiffStats` tests.
- [x] Output line count: `"a\nb"` → 2, `"a\nb\n"` → 2, `""` → 0, `"\n"` → 1 — `toolOutputLineCount`
      tests, exact cases from the spec.
- [x] Primary-field helper returns the full path/command, not a basename/first line —
      `toolPrimaryField` test with a nested path and a multi-line command.
- [x] `applyStreamEvent` on `tool_call` with `status: "awaiting_approval"` yields `status: "running"`
      **and** `statusText: "awaiting_approval"` — reducer test.
- [x] A `tool_call` with no `status` yields no `statusText`; a later event carrying one sets it; the
      normalized `status` semantics are unchanged — three-part reducer test (no status → status set
      → status overwritten on next change), plus untouched pre-existing merge tests.
- [x] All new helpers are pure — no React/store/DOM imports; run under node-environment Vitest with
      no new test infrastructure — confirmed by file imports and the passing focused run.

## Follow-ups / TODO(verify)

- None. Task-004 (ToolCard rebuild) is the next consumer of `toolBadge`/`toolDiffStats`/
  `toolOutputLineCount`/`toolPrimaryField`/`statusText` and is unblocked.
