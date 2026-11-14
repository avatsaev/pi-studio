# Task 006 — Layer B: live dev-daemon scenario, shapeMatches, input acceptance, coverage guard — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/server/src/daemon/external-fixtures-e2e.test.ts` (55 tests): one `startDevDaemon({port:0, mockTurnDelayMs:150})`, the shared `runExternalFixtureScenario`, and
- every server_to_client / http fixture compared with the first live frame of that variant via `shapeMatches` (extra daemon keys allowed and listed once in a warning; feature-flag additions are not listed); `requiresFeature` is checked against `status.server_info.features`;
- manifest `exception` fixtures must stay UNPRODUCED (fails the day a daemon path emits one, prompting removal of the exception);
- every client_to_server fixture sent with live ids substituted (`hello` verbatim over a fresh socket, `ping`, session requests with a real agent / dialog / surface) must be answered with the paired response fixture's shape and never `rpc_error`;
- coverage guard: output fixtures with no scenario key and no exception are named in the failure;
- `shapeMatches` unit tests (extras, missing, retyped, volatile, null vs absent, arrays).
Fixture touch-ups found by the live run: `fetch_agent_timeline_response` `collapsed`/`hasNewer` volatile; `agent_ui_list_request` now carries an `agentId` (volatile) so the reply is scoped to one agent.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/external-fixtures-e2e.test.ts` | created |
| `packages/protocol/fixtures/external-clients/{fetch_agent_timeline_response,agent_ui_list_request,.signatures.json}` | adjusted |

## Build & test results
```
$ npx vitest run packages/server/src/daemon/external-fixtures-e2e.test.ts packages/protocol/src/external-fixtures.test.ts   (x3)
  117 passed each run, ~3.7 s for Layer B
$ npm run build:server; npx oxfmt <changed>; npx oxlint <changed>   # clean
```
Mutation proofs (temporary edits, reverted):
- `ok` dropped from `interrupt_response` → `interrupt_response.json` and `interrupt_agent.json` fail;
- `lastActivity` retyped to a string in the dev `list_agents_response` → `list_agents_response.json` and `list_agents_request.json` fail;
- health body `{}` → `health.json` fails;
- extra `extra` field in the health body → passes, `health.json: /body/extra` printed in the warning list;
- `list_agents_request` scenario step removed → "fixtures no scenario step produces: [list_agents_response.json]".

## Acceptance criteria
- [x] Passes against the current dev daemon in < 10 s (3.7 s)
- [x] Mutation proofs (above)
- [x] Coverage guard names the unexercised fixture

## Follow-ups / TODO(verify)
- None.
