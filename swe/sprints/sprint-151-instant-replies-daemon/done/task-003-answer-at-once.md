# Task 003 — Create and send answer as soon as the request is accepted

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent service), tests across packages
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
`create_agent_request` and `send_agent_prompt` answer at once; the turn runs on after the answer and
reports through events.

## Context / why
Finding A7: both handlers await the whole turn, so a creating client learns the agent id only when the
turn is over, a turn longer than the client's timeout shows a false error, and a dropped socket loses
the answer. Task-002 made the timeline and the status carry every outcome; this task detaches the turn.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (points 1 to 4)
- `packages/server/src/agent/agent-service.ts` (`registerHandlers` :249-256, `handleCreate`,
  `handleSendPrompt`, `runTurn`), `agent-manager.ts` (`runExclusive` :185-193, `closeAll`,
  `archiveAgent`, `deleteAgent`)
- `packages/server/src/ws/router.ts` (`ctx.afterReply`, :27, :81-105)
- Every test that relied on the blocking answer: in `packages/server/src/agent/` (`create-run`,
  `one-turn-at-a-time`, `agent-recovery`, `session-ops`, `one-process-per-agent`,
  `seed-before-first-turn`, `timeline-eviction`, `ephemeral-stream`, `agent-stream-mode`,
  `fetch-timeline`, `compact-handler`, `slash-command-ops`, `session-operations`), in `packages/server/src/daemon/`
  (`bootstrap.test.ts` :306-500, `agent-todos-e2e`, `agent-ui-e2e`, `daemon-logs-e2e`,
  `daemon-status-e2e`, `external-fixtures-e2e`), and in `packages/cli/src/`
  (`agent-todos-sdk-e2e.test.ts`, `agent-ui-sdk-e2e.test.ts`)
- Docs: `packages/server/AGENTS.md` ("Deferred draft creation", "A Pi process that ends on its own"),
  `packages/server/docs/gateway-architecture.md` (:171-251)

## What to build
- **Handlers.** Do the synchronous checks (unknown agent, `busy`, invalid request), take the claim,
  mark the agent `running`, and return `create_agent_response {payload: {agentId}}` or
  `agent_prompt_response {payload: {agentId}}`. A refusal is an `rpc_error` as today and starts
  nothing. Everything after acceptance (spawn or resume, the turn, the settle, `autoArchive`) runs
  detached, under the same claim, which is released when the turn settles.
- **Order.** No frame of the turn (the `agent_update running`, the `user_message`, any `agent_stream`)
  is sent before the answer (`ctx.afterReply`). The `agent_update initializing` of a create may still
  precede it.
- **No stray rejections.** A failure of the detached work is recorded by task-002's path and logged;
  it never becomes an unhandled rejection.
- **A seam to wait.** `AgentService.turnSettled(agentId): Promise<void>` resolves when no prompt is in
  flight for the agent (at once when none is). Tests use it; shutdown, archive and delete keep ending a
  running turn the way M3 built it.
- **Interrupt during the start.** `SessionOperationsService.handleInterrupt`
  (`session-operations.ts` near :76) sees `running` with no session and settles `idle` while the spawn
  or resume continues (found by task-002; the window gets long once the answer is immediate). It must
  not self-heal while a turn claim is held: it cancels the pending start so the turn settles once, as
  `turn_canceled`, with no second `idle`.
- **Port the tests** listed above to `turnSettled` or to the terminal event; do not weaken what they
  assert about rows and statuses.
- Source comments and the two docs above.

## Out of scope
SDK, CLI and workbench (sprint 152): after this task the CLI's `run` and `send` return without
waiting, and the workbench composer has a short window where a second send is refused with `busy`.
Both are closed by sprint 152.

## Acceptance criteria
- [ ] Create with a prompt on a slow mock: the answer arrives before the turn's first frame and while
      the turn is still running; the same for send.
- [ ] A second send while the first runs: `rpc_error` with `busy`, no rows added.
- [ ] The socket that sent the prompt closes right after the answer: the turn completes and the
      timeline holds it.
- [ ] Pi cannot start after acceptance: the answer was a success; then `turn_failed` with the reason
      and `agent_update error`.
- [ ] No `unhandledRejection` fires in any of the above (a listener in the test).
- [ ] Interrupt sent while Pi is still starting: one `turn_canceled`, one `idle`, and the agent accepts the next send.
- [ ] `autoArchive` still archives after the turn; a deferred draft (create without a prompt) answers
      as before.
- [ ] `npx vitest run packages/server packages/cli packages/client` passes.

## Test / verification plan
- `npx vitest run packages/server packages/cli packages/client`
- `npm run build:server && npm run build:cli`

## Notes
Sprint 153 (shutdown) runs beside this sprint and edits `ws/router.ts` (refusing requests during
shutdown). Do not restructure the router here; use `afterReply` as it is.
