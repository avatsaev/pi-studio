# Task 007 — End-to-end proof + docs sweep — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
- **Server integration test** (`bootstrap.test.ts`, `it.each(["#tool", "#tool empty"])`): a real raw-socket
  client drives a mock-provider turn. Asserts partial `tool_call` frames carry **no `seq`** and a string
  `timestamp`, and that `fetch_agent_timeline_request` afterwards holds exactly one `tool_call` item with
  2 events (start + end), none `partial: true`.
- **Web-client convergence test** (`tool-streaming-convergence.test.ts`): replays a fixture shaped like the
  mock's frames through `applyStreamEvent` and asserts live == (start + end only), for the non-empty and
  the empty-final-output variants (terminal authority clears stale partial output).
- **Live Pi run** (real Pi, see below) and a **docs sweep** across the event vocabulary docs.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/bootstrap.test.ts` | added `#tool` integration tests + `kindOf`/`isPartialToolCallFrame` helpers |
| `packages/web-client/src/timeline/tool-streaming-convergence.test.ts` | created |
| `docs/agent-stream-events.md` | partial/ephemeral rule, constants, `compaction` + fixed stale ignored list and kind count (11) |
| `AGENTS.md` (root) | one new Protocol-overview bullet (ephemeral pair + `#tool` recipe) |
| `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`, `packages/cli/AGENTS.md` | documented what each package gained |
| `swe/features/tool-output-streaming.md` | TODO(verify) resolved with observations; `watch` → `attach` |
| `swe/sprints/PLAN.md` | `agent watch` → `agent attach`; task-007 row wording |
| `swe/features/timeline-streaming.md`, `README.md`, `packages/*/README.md` | intentionally unchanged (nothing to correct / none enumerate stream events) |

## How it satisfies the scope
Matches the re-baselined task. Deviations: (1) the CLI has no `agent watch` command — only `agent attach`
(and the top-level `attach` alias); specs, docs and PLAN.md were corrected rather than adding a command.
(2) The convergence test compares rows with the per-state `id` stripped (ids come from a counter).

## Build & test results
```
$ npm run clean && npm run build        → success (exit 0)
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean
$ npx oxfmt --check <changed files>     → all formatted
$ GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm test
Test Files 241 passed (241)   Tests 3251 passed (3251)
```
Without the gpgsign override, 19 pre-existing git-based tests fail on this host
(`commit.gpgsign=true`, missing `~/.ssh/id_rsa.pub`) — environmental, unrelated to this sprint.

## Live Pi run (real `pi --mode rpc`, `global.anthropic.claude-sonnet-5-5` via LiteLLM, isolated daemon on :6768)
- **Streaming:** prompt ran `for i in $(seq 1 20); do echo line $i; sleep 0.5; done`. The collapsed card showed
  the live tail growing (`line 1` … `line 12`, capped at 12 lines) while `running`; on completion the tail
  vanished and the card read `✓ completed · output · 20 lines`; final assistant message `done`.
- **Frames (browser-side capture):** 24 `tool_call` frames = 3 persisted (`started seq=2`, `running seq=3`,
  `completed seq=4`) + 21 partials. Partials: 0 with a `seq`, 0 without a `timestamp`; gaps 201–503 ms
  (median 502 — `bash` itself emits about every 500 ms here); ~2.2/s over 9.5 s; the terminal was the last
  tool frame; no partial after it.
- **64 KiB cap:** did not trigger — largest partial snapshot was 151 bytes (bash self-caps near 50 KB).
- **Interrupt mid-tool:** 120-iteration loop, Stop pressed at ~6 lines. Real Pi still delivered its own
  `tool_execution_end` (error result): card closed as `error` with the final output, tail gone (0 elements),
  a manually expanded card stayed expanded across the status change, transcript showed `(canceled)`.
  The client's `"canceled"` closure is a fallback for a turn that ends with no end event; not exercised live.
- **CLI:** `pi-studio -H 127.0.0.1:6768 attach <agentId>` printed `[shell started]`, `[shell running]`,
  `[shell error]` once each and `--- turn canceled ---` — none of the ~80 partials of that run.
- No browser console errors.

## Acceptance criteria
- [x] Server integration test asserts the wire/persistence bullets (fails if a partial gets a `seq` or reaches a fetched page)
- [x] Web-client fixture-replay test asserts live/authoritative convergence for non-empty and empty finals
- [x] Live Pi run performed and recorded (partial rate, cap, interrupt, parallel `attach`)
- [x] `docs/agent-stream-events.md`: neither `tool_execution_update` nor `compaction_*` ignored; kind count 11; `partial`, ephemeral rule, constants documented
- [x] Root + four package `AGENTS.md` updated; no contradicted invariant left
- [x] Feature spec `TODO(verify)` items resolved or explicitly kept open (#4 non-bash delta tools stays open)
- [x] Full gates green (build, typecheck, lint on changed files, full test suite with the gpgsign override)

## Follow-ups / TODO(verify)
- Open: whether any tool other than `bash` emits delta-style `partialResult` (only `bash` was exercised live); decide accumulate-per-callId vs. documented degradation if one does.
- Pre-existing lint warnings in untouched files (`schedule-service.test.ts`, `chat-service.test.ts`) are unchanged by this sprint.
