# Task 001 — `hello.agentStreams`: a session can opt out of agent streams

- **Sprint:** sprint-098-agent-stream-mode-cli-json
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (handshake, features, daemon status), packages/server (ws, agent, daemon, observability)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-097/task-002

## Goal
A client that sends `agentStreams: "none"` in `hello` receives no `agent_stream` frame, and everything else as before.

## Context / why
Every `agent_stream` frame goes to every connected session; filtering happens on the client. The desktop client's second connection only moves files and watches for "turn ended" and "needs input", so the full token stream of every agent is waste on it. Turn status does not depend on the stream: `agent_update` and `agent_ui_request` / `agent_ui_resolved` are separate broadcasts.

The field is a mode, not a boolean (spec decision D3): a later value can add per-agent subscriptions without a new field.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 2, § Agent stream mode (daemon), § Error handling & edge cases
- `packages/protocol/src/messages.ts` (`helloSchema`, next to `platform`; `daemonClientInfoSchema`)
- `packages/protocol/src/client-capabilities.ts` (`SERVER_FEATURES`, the `COMPAT` table)
- `packages/server/src/ws/session.ts` (`Session`, constructor options)
- `packages/server/src/ws/ws-server.ts` (direct `hello`), `packages/server/src/daemon/bootstrap.ts` (relay `hello`; `getActiveSessions`)
- `packages/server/src/agent/agent-service.ts` (`appendStreamEvent`: the sequenced and the ephemeral branch; the two `user_message` sites in the turn loop), `packages/server/src/agent/session-operations.ts` (the `agent_stream` site there)
- `packages/server/src/observability/daemon-status-service.ts` (client entries)
- Tests: `packages/server/src/agent/agent-service.test.ts`, `agent/create-run.test.ts`, `agent/ephemeral-stream.test.ts`, `agent/session-ops.test.ts`, `ws/ws-server.test.ts`, `observability/daemon-status-service.test.ts`, `daemon/bootstrap.test.ts` (relay), `daemon/daemon-status-e2e.test.ts`

## What to build
- `hello.agentStreams`: optional, `"all"` or `"none"`. Any other value (another string, a number, an object) is treated as `"all"` and the handshake still succeeds, the way a bad `platform` is dropped.
- `Session.agentStreams`: `"all"` or `"none"`, fixed for the life of the connection, set on both the direct and the relay `hello` path.
- Every place that sends an `agent_stream` frame sends it only to sessions whose mode is `"all"`. That covers sequenced events, ephemeral ones (partial tool output, the steer and follow-up queues) and `user_message`. The event is appended to the timeline regardless of who is listening.
- Nothing else changes for a `"none"` session: RPC replies, `agent_update`, `agent_ui_*`, `agent_timeline_reset`, `agent_todos_update`, `terminals_update`, workspace and skills pushes, per-session subscriptions and `fetch_agent_timeline_request` all still reach it.
- `daemon_status` client entries gain `agentStreams`, present only when the mode is not `"all"`.
- `SERVER_FEATURES.agentStreamsMode` with its `COMPAT` entry.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- The SDK option and the `hello.agentStreams.json` fixture (task-002).
- Per-agent stream subscriptions (parked by the spec).
- Changing the mode on a live connection.

## Acceptance criteria
- [ ] During a turn on a mock agent, a session that sent `agentStreams: "none"` receives no `agent_stream` frame of any kind, including for a turn it started itself, and does receive the `agent_update` `running` and `idle` broadcasts for that turn.
- [ ] A second session without the field receives the full stream during the same turn.
- [ ] The same holds for a relay session (unit level).
- [ ] An invalid `agentStreams` value yields a successful handshake and mode `"all"`.
- [ ] `daemon_status` lists `agentStreams: "none"` for the quiet session and omits the field for the other.
- [ ] `server_info.features.agentStreamsMode` is `true` on the production and the dev daemon.
- [ ] The timeline of the agent contains the events the quiet session did not receive (`fetch_agent_timeline_request` from that session returns them).

## Test / verification plan
- `npx vitest run packages/protocol/src packages/server/src/agent packages/server/src/ws packages/server/src/observability packages/server/src/daemon`
- `npm run build:protocol && npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- Five send sites were found at planning: both branches of `appendStreamEvent` and two sites in the turn loop in `agent-service.ts`, and one in `session-operations.ts`. Search for `"agent_stream"` again before finishing: a site added since would silently bypass the mode.
- An unknown value falls back to `"all"` so a client built for a later mode never gets less than it asked for from a daemon that predates that mode.
- Depends on sprint-097/task-002 only because both edit `client-capabilities.ts` and `daemon/bootstrap.ts`.
