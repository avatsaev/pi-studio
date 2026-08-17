# Task 007 — End-to-end proof + docs sweep

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** test + docs
- **Area:** packages/server, docs, AGENTS.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal

Prove the whole path start-to-finish with one offline integration test plus one live Pi run, and bring
every document that describes the event vocabulary back in line with the code.

## Context / why

Each earlier task proves its own layer. What none of them proves is the **composition**: mapper →
coalescer → ephemeral broadcast → client merge, with the ordering guarantee holding across all four.
The failure mode this catches is a partial escaping into persisted history, or a trailing partial
landing after `completed`, only when the real layers are stacked.

The docs sweep is not optional bookkeeping here: `docs/agent-stream-events.md` currently lists
`tool_execution_update` in its "Ignored Pi events (no `AgentStreamEvent` produced)" section. After
task 002 that sentence is **false**, and a stale statement about which events exist is exactly the
kind of doc error that makes the next person re-derive the mapping from scratch.

## Scope references

- `swe/features/tool-output-streaming.md` § Acceptance Criteria, § TODO(verify)
- `docs/agent-stream-events.md` — producer mapping table, ignored list, consumer tables
- `AGENTS.md` (root) § Protocol overview — the per-path push/ephemeral family note
- `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`,
  `packages/cli/AGENTS.md`
- `packages/server/src/daemon/bootstrap.test.ts` — the raw-socket in-process integration idiom
- Modify: the docs above; add the integration test

## What to build

**1. Offline in-process integration test** (mock provider, raw-socket idiom): drive a turn whose tool
call emits partials, and assert across layers in one test —

- the client-visible stream contains partial `tool_call` frames with no `seq`;
- the persisted timeline holds only the start + end rows for that call;
- `fetch_agent_timeline_request` returns no partials and one `tool_call` projected item;
- feeding the captured frames through the web-client reducer converges on the same final output as
  the end event alone (live and authoritative paths agree — `timeline-streaming.md`'s convergence
  invariant, now exercised for a streamed call and enforced by task 005's terminal-output-authority
  rule).

**2. Live Pi run** (documented steps + observed result, not automated): run the production daemon
against a real `pi`, issue a prompt whose tool call prints for ≥ 10 s (e.g. a build or a `sleep`
loop with output), and confirm in the browser that the tail grows, the badge flips to `completed`
exactly once, and no card is left showing `running`. Also interrupt a turn mid-tool and confirm the
card closes as `canceled` with no tail left pinned, and run `pi-studio agent watch` alongside to
confirm no duplicate `[… running]` lines appear. Record what was observed in the task summary —
the coalescer's timing behavior against real Pi output rates cannot be proven by fake timers.

**3. Docs sweep.** Truthful against the shipped code, no aspirational statements:

- `docs/agent-stream-events.md`: move `tool_execution_update` out of the ignored list into the
  producer mapping table; document `partial` in the event-kind table; add the ephemeral (no-`seq`,
  never-persisted) rule and the coalescing constants; update the consumer section for the live tail;
  update the "adding a new event kind" checklist if the ephemeral branch changes the steps.
- Root `AGENTS.md`: extend the protocol section's note on per-path/ephemeral push families to name the
  partial-`tool_call` + `queue_update` ephemeral pair and the no-`seq` rule.
- `packages/protocol/AGENTS.md`: the new optional field and its producer/consumer contract.
- `packages/server/AGENTS.md`: the new coalescer module in the source-layout tree, the constants, and
  the ephemeral-broadcast rule in the agent-service subscriber.
- `packages/web-client/AGENTS.md`: the live-tail behavior, the tail helper module, the `"canceled"`
  row status, and the terminal-output-authority rule.
- `packages/cli/AGENTS.md`: `agent watch`/`attach` suppress partial events (both render modes).
- `swe/features/tool-output-streaming.md`: resolve its three `TODO(verify)` items with what was
  actually found (`queue_update` alignment outcome, whether the 64 KiB cap ever triggers against real
  Pi output, final coalescer placement).

## Out of scope

- Any behavior change — this task is proof + prose only. A bug found here is fixed in the owning
  task's file, not patched over in the test.
- Documenting anything not shipped by tasks 001–006.

## Acceptance criteria

- [ ] The integration test asserts all four bullets above and fails if a partial reaches persisted
      history or a projected page.
- [ ] The live Pi run is performed and its observations recorded in the task summary, including the
      observed partial rate and whether the tail cap triggered.
- [ ] `docs/agent-stream-events.md` no longer lists `tool_execution_update` as ignored, and documents
      `partial` + the ephemeral rule + the coalescing constants.
- [ ] All five `AGENTS.md` files are updated for what their package actually gained; no contradicted
      invariant is left in place.
- [ ] `swe/features/tool-output-streaming.md`'s `TODO(verify)` items are each resolved with an answer
      (or explicitly re-stated as still open, with why).
- [ ] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Test / verification plan

- Build: `npm run build` succeeds (full, not per-package — this is the sprint-end gate).
- Typecheck: `npm run typecheck` succeeds. Run `npm run clean` first if any signature changed in this
  sprint — stale `.tsbuildinfo` silently hides cross-package errors.
- Lint/format: `npm run lint` and `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` (full suite) passes.
- Manual: the live Pi run above.

## Notes

- Sprint-end gate: do not mark this task done on a per-package build. The full `build` + `test` gates
  are the definition of done for the sprint.
- The reducer-convergence assertion is the one that would catch a future "optimize `mergeTool` into an
  append" change at the integration level, complementing task 005's unit lock.
