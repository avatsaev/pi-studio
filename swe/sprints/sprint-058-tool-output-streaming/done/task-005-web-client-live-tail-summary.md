# Task 005 — web-client live tail, turn-terminal tool closing, terminal-output authority — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
- `ToolCard` renders a distinct live-tail block (last 12 lines, own height cap, `overflow: hidden`)
  while a tool is `running` with non-empty output, even when collapsed; it disappears on a terminal
  status and the existing `output · N lines` strip is untouched.
- `closeRunningTools` (shaped like `cancelStartedCompactions`) runs from `onTurnCanceled` (→ `"canceled"`)
  and `onTurnFailed` (→ `"error"`) only, never from `onTurnCompleted`. `"canceled"` is a new
  client-local `ToolCallStatus` with muted trailing text, no spinner, and a border modifier.
- A terminal (`completed`/`error`) `tool_call` takes `output` verbatim (absent/empty clears earlier
  partials) via `mergeToolForStatus`; other fields still merge, so live view equals post-reload view.
- Partials need no reducer case: `onToolCall`'s existing upsert + `mergeTool` replace-semantics apply.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/timeline/live-tail.ts` | created — pure `liveTail` helper, `LIVE_TAIL_LINES = 12` |
| `packages/web-client/src/timeline/live-tail.test.ts` | created |
| `packages/web-client/src/timeline/reducer.ts` | modified — `closeRunningTools`, `mergeToolForStatus` |
| `packages/web-client/src/timeline/row-model.ts` | modified — `"canceled"` in `ToolCallStatus` |
| `packages/web-client/src/timeline/reducer.test.ts` | added tests |
| `packages/web-client/src/features/chat/rows/ToolCard.tsx` | modified — tail block, `canceled` branch |
| `packages/web-client/src/features/chat/rows/rows.module.css` | modified — `.toolLiveTail`, `.toolCardBodyCanceled` (tokens only) |

## How it satisfies the scope
Matches § Client reducer / `ToolCard` live tail and § Error Handling. `partial` is not stored on
`ToolRow`. No server/protocol change. No deviation.

## Build & test results
```
$ npm run clean && npm run build        → success (incl. web-client Vite build)
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean
$ npx oxfmt --check <changed files>     → all formatted
$ npx vitest run packages/web-client/src/timeline packages/web-client/src/theme → passed (incl. font-scale, token-integrity)
$ npm test  (gpgsign override)          → 240 files / 3247 tests passed
```

Manual browser check (headless Chromium, `dev-main.js` mock daemon + Vite, `#tool`):
- Raw WS frames received by the page: start `tool_call` `seq=2`; three `partial: true` frames with
  `seq=undefined` and a `timestamp` and growing output (`A` / `A,B` / `A,B,C`); end `completed`
  `seq=3` with the 4-line output; then `assistant_message`, `turn_completed`.
- With the terminal frame held in the page, the card showed `running` with the live-tail `<pre>`
  (`> running suite A/B/C`, 75.5 px tall, class `toolLiveTail`) above `output · 3 lines`, card collapsed.
- After release: 0 live-tail elements, `✓ completed`, `output · 4 lines`; identical to the card
  rebuilt from fetched history; no console errors.

## Acceptance criteria
- [x] Partial merges by `callId`; `"a"`,`"ab"`,`"abc"` → `"abc"`; status/`statusText` stay `running`
- [x] Partial for unknown `callId` creates a row
- [x] Partial never clears command/path/query from the start event
- [x] `partial` not on `ToolRow`
- [x] Partial does not trigger `invalidateAfterToolCompletion` (it fires only on `completed`; reducer-level by construction, no test added)
- [x] `turn_canceled` → `"canceled"`, `turn_failed` → `"error"`, terminal rows untouched, `turn_completed` changes none; compaction-cancel tests pass untouched
- [x] Terminal with absent/empty output clears partial output; with output replaces it; other fields survive
- [x] Tail helper: last 12 lines / whole text / no blank last line / deterministic
- [x] Design-token tests pass for the new CSS
- [~] Manual browser check: tail while collapsed+running, tail gone on completion, `output · N lines` present, no errors — done. **Not exercised live:** the cancel visual and manual-expand-survives-transition (the mock completes the turn instantly, so there is nothing to interrupt); both are covered at reducer level, the expand state is untouched local `useState`.

## Follow-ups / TODO(verify)
- Cancel and expand-across-transition are worth one look during task-007's live Pi run (a real long `bash`).
