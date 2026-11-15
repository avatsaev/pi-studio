# Task 001 — `hello.agentStreams`: a session can opt out of agent streams — Summary

- **Sprint:** sprints/sprint-098-agent-stream-mode-cli-json
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
- `helloSchema.agentStreams`: `"all" | "none"`, optional; any other value is dropped by `.catch(undefined)` (handshake succeeds, reads as `"all"`).
- `Session.agentStreams` (default `"all"`), set from `hello` on the direct path (`ws-server.ts`) and the relay path (`daemon/bootstrap.ts`). A hoisted `agentStreamRecipients(sessions)` in `ws/session.ts` filters out `"none"` sessions (an absent mode on a test fake counts as `"all"`).
- All five `agent_stream` send sites go through it: both branches of `appendStreamEvent`, the two `user_message` sites in the turn loop (`agent-service.ts`) and the steer/follow-up optimistic row (`session-operations.ts`). A grep for `"agent_stream"` in `packages/server/src` (non-test) found no other site. Timeline appends are unchanged.
- `daemon_status` client entries gain `agentStreams` only when the mode is not `"all"` (`daemonClientInfoSchema.agentStreams`, an open string).
- `SERVER_FEATURES.agentStreamsMode` + `COMPAT` entry (0.0.119); both bootstraps advertise every `SERVER_FEATURES` key, so it is on in production and dev.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts`, `client-capabilities.ts` | schema field, client-info field, feature flag |
| `packages/server/src/ws/session.ts`, `ws-server.ts`, `daemon/bootstrap.ts` | mode on `Session`, both hello paths, recipient filter |
| `packages/server/src/agent/agent-service.ts`, `session-operations.ts` | filter at the five send sites |
| `packages/server/src/observability/daemon-status-service.ts` | `agentStreams` in client entries |
| tests: `protocol/src/messages.envelopes.test.ts`, `client-capabilities.test.ts`, `server/src/agent/agent-stream-mode.test.ts` (new), `ws/ws-server.test.ts`, `observability/daemon-status-service.test.ts`, `daemon/bootstrap.test.ts` (relay hello), `agent/compact-handler.test.ts` (identity assertion on `sessions` relaxed to equality) | |
| `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md` | docs |

## Build & test results
```
$ npm run build; npm run typecheck; npm test; npm run lint   (wave-1 gate, combined tree with task-003)
Test Files 271 passed / Tests 3781 passed; lint 0 errors
$ npx oxfmt <changed>; npx oxlint <changed>   clean
```

## Acceptance criteria
- [x] Quiet session gets no `agent_stream` (sequenced, ephemeral partials, `user_message`, steer row) during a turn it did not and did start; it still gets `agent_update` running/idle (`agent-stream-mode.test.ts`).
- [x] A session without the field receives the full stream during the same turn.
- [x] Relay: the relay `hello` path carries the mode (`bootstrap.test.ts`, real E2EE handshake; a bad value reads as `"all"` elsewhere); filtering is session-level so it is transport-independent.
- [x] Invalid value → successful handshake, mode `"all"` (`ws-server.test.ts`, schema test).
- [x] `daemon_status` lists `agentStreams: "none"` for the quiet session, omits it otherwise (unit).
- [x] `agentStreamsMode` advertised (both bootstraps use `Object.values(SERVER_FEATURES)`).
- [x] Timeline contains the events the quiet session did not receive (`agent-stream-mode.test.ts`).

## Follow-ups / TODO(verify)
- `daemon-status-e2e.test.ts` was run unchanged; the quiet-session listing is proven at unit level and in the live check (task-004).
- The existing compact test asserted `sessions` identity (`toBe(active)`); it now compares contents.
