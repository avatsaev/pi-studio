# Task 002 — Shared daemon test client and missing producers

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** feature
- **Area:** packages/server (test-support, daemon/dev-bootstrap, providers/mock)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Layer B can drive every stage 1 daemon-output type through the dev daemon, using one shared
client helper.

## Context / why

The raw-`ws` `connect`/`rpc`/`waitFor` helper is duplicated per E2E file (`agent-ui-e2e.test.ts`,
`agent-todos-e2e.test.ts`). The `agent_permission_*` family is **not** fixtured: it is being
retired (sprint-086), so no dev-handle `permissionService` hook is added.

## Scope references

- swe/architecture/external-client-fixtures.md § Files (new/changed)
- swe/notes/external-client-fixtures-spike.md (task-001's gap decisions)
- packages/server/src/daemon/dev-bootstrap.ts:55-65 (`DevBootstrapHandle`)
- packages/server/src/daemon/agent-ui-e2e.test.ts, agent-todos-e2e.test.ts (helpers to extract)
- packages/server/src/agent/providers/mock/mock-provider.ts (`#ui`/`#todo`/`#tool` recipe style)

## What to build

- `packages/server/src/test-support/daemon-test-client.ts`:
  - `connectTestClient(port, {clientType?, appVersion?})` sends `hello` and awaits `status`;
  - `rpc(type, body)` stamps `requestId` inside `{type:"session", message}` and awaits the
    correlated reply;
  - `waitFor(predicate, timeoutMs = 4000)` over the captured message log (polling, no sleeps);
  - `send(frame)` raw;
  - `close()`.
  Existing E2E tests may adopt it; this task is not required to migrate them.
- Exactly the producers task-001 found missing, in the established style. Expected: a mock
  recipe (e.g. `#stream reasoning|fail|error`) that emits the missing `AgentStreamEvent` kinds
  through the session's normal broadcast path. Also a dev-only route to `agent_timeline_reset` if
  the spike chose a hook over an exception. No production code path changes.

## Out of scope

- Fixture files, the Layer A/B tests themselves.

## Acceptance criteria

- [ ] Over the helper on a dev daemon, a test observes each kind the spike marked "missing recipe"
  as an `agent_stream` frame with the expected `event.kind`.
- [ ] `DevBootstrapHandle` gains no permission hook. The permission family is excluded from the
  fixture set (retired in sprint-086).
- [ ] The mock's `#… help` recipe text lists any new recipe. Existing `#ui`/`#todo`/`#tool` tests
  pass untouched.
- [ ] `packages/server/AGENTS.md` names `test-support/daemon-test-client.ts` and the new recipe.

## Test / verification plan

- `npx vitest run packages/server/src/agent/providers/mock packages/server/src/daemon`
- `npm run build:server`; `npx oxfmt <changed files>`; `npm run lint`
