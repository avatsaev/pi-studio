# Task 006 — Layer B: live dev-daemon scenario, `shapeMatches`, input acceptance, coverage guard

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** test
- **Area:** packages/server (daemon test)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-004, task-005

## Goal

The daemon's real output is proven to match every fixture. That includes the types with no Zod
schema (`list_agents_response`, `interrupt_response`, `agent_timeline_reset`, health).

## Scope references

- swe/architecture/external-client-fixtures.md § The contract test › Layer B, `shapeMatches`,
  § Error handling & edge cases
- packages/server/src/test-support/daemon-test-client.ts (task-002)
- packages/server/src/daemon/dev-bootstrap.ts (`startDevDaemon`, handle `manager`)

## What to build

- `packages/server/src/daemon/external-fixtures-e2e.test.ts`:
  - one dev daemon (`port:0`, `silentLogger()`) and one scripted scenario (spec pseudo-code)
    capturing frames by type/variant predicate, never by index;
  - `GET /api/health` over HTTP.
- `shapeMatches(expected, actual, volatile)`, per the spec's rules:
  - extra keys are allowed and collected into a warning list printed once;
  - primitives must have the same JSON type, and equal values unless volatile;
  - arrays match element-wise on the fixture's representative elements;
  - `null` and absent are distinct.
- Client-input fixtures:
  - each is sent with volatile ids substituted;
  - the reply must match the paired response fixture's shape, never `rpc_error`.
- Coverage guard: every manifest entry is either matched live or carries the manifest `exception`
  marker set by task-004. A schema-less type may not be an exception.

## Acceptance criteria

- [ ] The test passes against the current dev daemon in < 10 s.
- [ ] Mutation proofs (recorded, then reverted):
  - dropping `ok` from the dev `interrupt_response` fails;
  - retyping a `list_agents_response` field fails;
  - dropping a field from the health body fails;
  - adding an extra field to any of them passes with a warning.
- [ ] Removing a scenario step makes the coverage guard name the unexercised fixture.

## Test / verification plan

- `npx vitest run packages/server/src/daemon/external-fixtures-e2e.test.ts` (run 3× to check for
  flakiness)
- `npm run build:server`; `npx oxfmt <changed files>`; `npm run lint`
