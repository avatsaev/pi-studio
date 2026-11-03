# Task 007 — End-to-end proof + docs sweep

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** done
- **Type:** test + docs
- **Area:** packages/server, docs, AGENTS.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006
- **Spec re-baselined:** 2026-11-03 against the current tree

## Goal

Prove the whole path start-to-finish with one offline integration test plus one live Pi run, and bring
every document that describes the event vocabulary back in line with the code.

## Context / why

Each earlier task proves its own layer. What none of them proves is the **composition**: mapper →
coalescer → ephemeral broadcast → client merge, with the ordering guarantee holding across all four.
The failure mode this catches is a partial escaping into persisted history, or a trailing partial
landing after `completed`, only when the real layers are stacked.

The docs sweep is not optional bookkeeping here, and it is **wider than this sprint's own changes**:
`docs/agent-stream-events.md` is already stale on two counts independent of streaming. Its "Ignored
Pi events" list (≈ L92–97) names `tool_execution_update` (false after task 002) **and**
`compaction_start`/`compaction_end` (false since sprint-074 — both are mapped), it says "10 kinds"
(≈ L105, L135; there are 11 since `compaction`), and its producer/consumer tables have no
`compaction` row. A stale statement about which events exist is exactly the kind of doc error that
makes the next person re-derive the mapping from scratch, so the sweep fixes all of it, not just the
streaming lines.

## Scope references

- `swe/features/tool-output-streaming.md` § Acceptance Criteria, § TODO(verify)
- `docs/agent-stream-events.md` — producer mapping table, ignored list, consumer tables, kind count
- Root `AGENTS.md` § Protocol overview — the push-family bullets (note: there is **no** existing
  "ephemeral" note to extend; the nearest neighbour is the `agent_todos_*` bullet at ≈ L488–492,
  whose per-agent `seq` is a different thing — a new bullet is added, not an existing one edited)
- `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`,
  `packages/cli/AGENTS.md`
- `packages/server/src/daemon/bootstrap.test.ts` — the raw-socket in-process integration idiom:
  `describe("broadcast() session envelope")` ≈ L852+ opens a raw `ws://127.0.0.1:<port>` socket and
  collects `rawFrames`; the shared `connect()`/`rpc` helper ≈ L61+; the opt-in mock-provider agent
  test ≈ L244+
- Modify: the docs above; add the integration test

## What to build

**1. Offline in-process integration test** (mock provider `#tool` recipe from task 004, raw-socket
idiom): drive a turn whose tool call emits partials, and assert across layers in one test —

- the client-visible raw frame stream contains partial `tool_call` frames with no `seq` and a
  `timestamp`;
- the persisted timeline (`fetch_agent_timeline_request`) holds only the start + end rows for that
  call — no partials — and one `tool_call` projected item;
- feeding the captured frames through the web-client reducer (`applyStreamEvent`) converges on the
  same final output as applying the fetched start + end rows alone (live and authoritative paths
  agree — `timeline-streaming.md`'s convergence invariant, now exercised for a streamed call and
  enforced by task 005's terminal-output-authority rule). Run it for both `#tool` and `#tool empty`.

The reducer-convergence half can import `@av-pi-studio/web-client`'s reducer only if the server test
already depends on web-client (it does not — `server` must not depend on `web-client`). Put the
convergence assertion in a **web-client** test that replays a fixture of the captured frames
instead, and keep the server test to the three wire/persistence bullets. Two tests, one fixture.

**2. Live Pi run** (documented steps + observed result, not automated): run the production daemon
against a real `pi`, issue a prompt whose `bash` call prints for ≥ 10 s (e.g. `for i in $(seq 1 20);
do echo line $i; sleep 0.5; done`), and confirm in the browser that the tail grows, the trailing
status flips to `completed` exactly once, and no card is left showing a spinner. Also interrupt a
turn mid-tool and confirm the card closes as `canceled` with no tail left pinned, and run
`pi-studio agent attach` alongside to confirm no duplicate `[shell running]` lines appear. Record
in the task summary: the observed partial rate (bash self-throttles at 100 ms, the daemon at
200 ms — expect ≤ 5/s), whether the 64 KiB cap ever triggered (expected: no, bash caps at ~50 KB),
and whether any nested (`<parent>/<n>`) updates were seen if a sub-agent tool was exercised.

**3. Docs sweep.** Truthful against the shipped code, no aspirational statements:

- `docs/agent-stream-events.md`: move `tool_execution_update` **and** `compaction_start`/`_end`
  out of the ignored list; add `compaction` and the partial `tool_call` to the producer mapping
  table; fix the kind count; document `partial` in the event-kind table; add the ephemeral
  (no-`seq`, never-persisted) rule naming both ephemeral kinds (`partial` `tool_call`,
  `queue_update`) and the coalescing constants; update the consumer section for the live tail and
  the CLI suppression; update the "adding a new event kind" checklist for the ephemeral branch.
- Root `AGENTS.md` § Protocol overview: add a bullet for the ephemeral `agent_stream` pair
  (no `seq`, never persisted, daemon-owned `timestamp`, `appendStreamEvent` is the single rule
  site) and the `#tool` mock recipe.
- `packages/protocol/AGENTS.md`: the new optional field and its producer/consumer contract.
- `packages/server/AGENTS.md`: `tool-output-coalescer.ts` in the source-layout tree with its
  constants; the ephemeral branch in `appendStreamEvent`; `queue_update` now ephemeral; the mock
  provider's `#tool` recipe alongside `#ui`/`#todo`; the Pi-internals mirror list gains a note that
  snapshot-vs-delta `partialResult` semantics are tool-specific and only `bash` is verified.
- `packages/web-client/AGENTS.md`: the live-tail behavior and the tail helper module, the
  `"canceled"` row status, the terminal-output-authority rule, the turn-terminal tool-row closing.
- `packages/cli/AGENTS.md`: `agent attach` suppresses partial events (both render modes).
- `swe/features/timeline-streaming.md` § Timeline model: `queue_update`'s "carries no sequence
  number" statement is now true — leave it, but drop any hedging if present.
- `swe/features/tool-output-streaming.md`: resolve its three `TODO(verify)` items with what was
  actually found (`queue_update` alignment outcome; whether the 64 KiB cap triggered against real
  Pi output; final coalescer placement).

## Out of scope

- Any behavior change — this task is proof + prose only. A bug found here is fixed in the owning
  task's file, not patched over in the test.
- Documenting anything not shipped by tasks 001–006 (the `compaction` doc fix is an exception:
  it is already-shipped behavior the doc misstates).

## Acceptance criteria

- [ ] The server integration test asserts the three wire/persistence bullets and fails if a partial
      reaches a fetched page or carries a `seq`.
- [ ] The web-client fixture-replay test asserts live/authoritative convergence for both the
      non-empty and empty final-output recipes.
- [ ] The live Pi run is performed and its observations recorded in the task summary, including the
      observed partial rate and whether the tail cap triggered.
- [ ] `docs/agent-stream-events.md` lists neither `tool_execution_update` nor `compaction_*` as
      ignored, states the correct kind count, and documents `partial` + the ephemeral rule + the
      coalescing constants.
- [ ] Root `AGENTS.md` and the four package `AGENTS.md` files are updated for what their package
      actually gained; no contradicted invariant is left in place.
- [ ] `swe/features/tool-output-streaming.md`'s `TODO(verify)` items are each resolved with an answer
      (or explicitly re-stated as still open, with why).
- [ ] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Test / verification plan

- Build: `npm run build` succeeds (full, not per-package — this is the sprint-end gate).
- Typecheck: `npm run typecheck` succeeds. Run `npm run clean` first — task 001 changed a shared
  protocol type, and stale `.tsbuildinfo` silently hides cross-package errors.
- Lint/format: `npm run lint` and `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` (full suite) passes.
- Manual: the live Pi run above.

## Notes

- Sprint-end gate: do not mark this task done on a per-package build. The full `build` + `test` gates
  are the definition of done for the sprint.
- The convergence assertion is the one that would catch a future "optimize `mergeTool` into an
  append" change at the integration level, complementing task 005's unit lock.
