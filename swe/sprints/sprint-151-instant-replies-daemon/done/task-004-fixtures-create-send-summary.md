# Task 004 — External fixtures and changelog for create and send — Summary

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Four external fixtures (`create_agent_request`, `create_agent_response`, `send_agent_prompt`, `agent_prompt_response`; `since` 0.0.133, `payload.agentId` pinned), signatures regenerated, a dated 2026-11-25 "Additive" CHANGELOG entry (`formatVersion` stays 2) that states the behaviour change (both answers mean "accepted"; no `status`; the outcome is the turn's rows plus one `agent_update`) and that `rpc_error.code` is an open string. Layer B sends both requests to a live dev daemon and checks the answer shape, that it precedes the first `agent_stream` frame, and that exactly one `agent_update` (`idle`/`error`) ends the turn. A guard test removes `payload.agentId` from each answer fixture and expects refusal. The stale `rpc_error` texts (fixture description, `messages.ts` comment) now list `shutting_down`.

## Files changed
`packages/protocol/fixtures/external-clients/*` (4 new, manifest, signatures, CHANGELOG, README, `rpc_error.json`), `packages/protocol/src/{external-fixtures.test,messages}.ts`, `packages/server/src/daemon/external-fixtures-e2e.test.ts`, `test-support/external-fixtures-scenario.ts`; docs: root `AGENTS.md` ("Create and send answer at acceptance"), protocol and server `AGENTS.md`, `swe/features/agent-sessions.md`, `swe/architecture/{websocket-protocol,daemon-bootstrap}.md`, `docs/agent-stream-events.md`.

## Build & test results
```
npx vitest run packages/protocol packages/server/src/daemon/external-fixtures-e2e.test.ts -> 15 files, 445 passed; build:protocol, build:server OK
Interim full-tree gate: npm run build, typecheck 0 errors; lint 0 errors; npm test 338 files, 4847 tests passed
```

## Acceptance criteria
- [x] The vitest command passes
- [x] The guard refuses a removed `payload.agentId` and accepts the committed tree
- [x] No doc says create or send answer when the turn ends

## Follow-ups / TODO(verify)
- Sprint-154 adds `too_many_requests` to `rpc_error.json`, the `messages.ts` comment and the changelog when it lands.
