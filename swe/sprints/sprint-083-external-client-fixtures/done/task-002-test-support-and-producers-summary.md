# Task 002 — Shared daemon test client and missing producers — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
- `test-support/daemon-test-client.ts`: `connectTestClient(port, {clientType?, appVersion?, capabilities?})` (hello → `status`), `rpc`/`rpcFrame`, `send`, polling `waitFor(pred, 4000)`, `close`, plus `listeningPort`, `messageOf`, `WireFrame`.
- `test-support/external-fixtures-scenario.ts`: the single scripted dev-daemon scenario (`runExternalFixtureScenario`, `variantKey`, `SCENARIO_MOCK_TURN_DELAY_MS`) shared by the recorder and the Layer B test (task-006).
- Mock producers (spike gaps): `#stream reasoning|fail|error|help` (`providers/mock/stream-script.ts`) and `MockAgentSession.fork(MOCK_REBIND_ENTRY_ID)` which bumps a fork generation so `describePersistence().nativeHandle` changes and `handleFork` broadcasts `agent_timeline_reset` through the real path.
- The recorder script now imports the client + scenario from `dist`.
- No permission hook on `DevBootstrapHandle`; no production code path changed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/test-support/daemon-test-client.ts` | created |
| `packages/server/src/test-support/external-fixtures-scenario.ts` | created |
| `packages/server/src/agent/providers/mock/stream-script.ts` (+`.test.ts`) | created |
| `packages/server/src/agent/providers/mock/mock-provider.ts` (+`.test.ts`) | `#stream` dispatch, fork rebind, tests |
| `packages/server/src/daemon/mock-stream-producers-e2e.test.ts` | created |
| `packages/server/scripts/record-external-fixtures.ts` | refactored onto the shared scenario |
| `packages/server/AGENTS.md`, `AGENTS.md`, `swe/notes/external-client-fixtures-spike.md` | docs |

## Build & test results
```
$ npm run build:server    # success
$ npx vitest run packages/server/src/agent/providers/mock packages/server/src/daemon
  Test Files 11 passed, Tests 180 passed, 0 failed
$ npx oxfmt <changed>; npx oxlint <changed>   # clean
$ node packages/server/scripts/record-external-fixtures.ts   # 38 variants captured, exit 0
```

## Acceptance criteria
- [x] reasoning / turn_failed / error observed as `agent_stream` frames over the helper (`mock-stream-producers-e2e.test.ts`)
- [x] `DevBootstrapHandle` has no permission hook
- [x] `#stream help` lists the recipes (`stream-script.test.ts`); existing `#ui`/`#todo`/`#tool` tests pass untouched
- [x] `packages/server/AGENTS.md` names `test-support/daemon-test-client.ts` and `#stream`

## Follow-ups / TODO(verify)
- Spike correction: `agent_ui_resolved.cancelled` has no daemon producer (Layer-A-only exception, task-004).
