# Task 002 — CLI: `run`, `send` and `wait` follow events

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Status:** backlog
- **Type:** feature
- **Area:** packages/cli (agent commands), docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
`pi-studio agent run` and `send` still wait for the turn, now on events, print the agent id at once,
and exit non-zero when the turn failed; `agent wait` works.

## Context / why
Both commands blocked on the RPC. After sprint 151 they return at once, which breaks scripts that run
a prompt and then read the result. `agent wait` has never worked: it sends `wait_for_agent`, and the
daemon has no such handler. `attach --until-idle` exits 0 on a failed turn.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (point 5, the **Choice** on the default)
- `packages/cli/src/agent-commands.ts` (`AGENT_RPC` :26-62, `runAgent` :128-140, `sendAgent` :171-181,
  `attachAgent` :287-320, registration :559-740), `cli-core.ts` (exit codes), `output.ts`
- `packages/cli/src/agent-commands.test.ts`, `program.test.ts`
- `packages/cli/AGENTS.md` (:143-150, :201-206), `packages/cli/README.md` (:108-115),
  `fern/pages/cli/agent.mdx`

## What to build
- `run`: create, print the agent id at once, then wait with `waitForIdle` unless `--no-wait`.
  `send`: the same after the accepted answer.
- Exit code: 0 when the agent settles `idle`; non-zero when it settles `error` or is closed. On a
  failure the last `turn_failed` reason seen on the stream goes to stderr.
- `--json`: one line at the end. `run`: `{agentId, status, error?}`; with `--no-wait` `{agentId}`.
  `send`: the same two shapes.
- `--timeout <seconds>` bounds the wait (none by default); on timeout the command exits non-zero with
  `error: "timeout"` and the turn keeps running. Ctrl-C ends the wait only, and says so on stderr.
- `agent wait <id>` uses `waitForIdle` with the same exit codes and `--timeout`; `AGENT_RPC.wait` goes.
- `attach --until-idle` exits non-zero on `turn_failed`.
- A refused send (`busy`, unknown agent) prints the daemon's message and exits non-zero, as today.
- Docs: the three files above.

## Out of scope
Printing the answer text (use `agent logs` or `attach`).

## Acceptance criteria
- [ ] `run` prints the id before the turn ends and exits after it (scripted daemon, and a dev daemon
      with the mock provider).
- [ ] A failed turn (`#stream fail` on the mock) gives a non-zero exit and the reason on stderr;
      `--json` carries `status: "error"`.
- [ ] `--no-wait` returns at once with exit 0.
- [ ] `wait` on an idle agent returns at once; on a running one it returns when the turn ends.
- [ ] `--json` prints exactly one line in every case above.

## Test / verification plan
- `npx vitest run packages/cli`
- `npm run build:cli`
