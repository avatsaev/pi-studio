# Task 001 — Make the `update-e2e` "apply handoff" test deterministic

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** done
- **Type:** test
- **Area:** packages/server (daemon tests)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
The test passes on every run, and still asserts the exact order of update states.

## Context / why
`update-e2e.test.ts` "apply: states in order, the real shutdown ran once, then exit is called" fails
in about one full `npm test` run in three: `broadcastKinds` holds an extra leading `idle`. Cause: a
session gets the update status at connect (`sendUpdateStatus` in `onSession`), and the update
service's start-up probe (`void updateService.start()` after `listen`) broadcasts once more when it
finishes. A client that connects before the probe ends gets both. The shutdown work of this sprint
runs through the same test, so it must be trustworthy first.

## Scope references
- `packages/server/src/daemon/update-e2e.test.ts` (:129-134 `broadcastKinds`, :156-203 the test)
- `packages/server/src/daemon/bootstrap.ts` (`sendUpdateStatus` near :512, `updateService.start()` :946)
- `packages/server/src/update/update-service.ts` (`start`, `probe`, `emitIfChanged`, `ready`)

## What to build
The test waits for the start-up probe to finish before it starts collecting frames (through a
readiness seam on the handle, or by asking the status until it carries the probed install kind). Do not
drop duplicates in `broadcastKinds`: a real double broadcast must still fail the test.

## Out of scope
Changing when the daemon broadcasts.

## Acceptance criteria
- [ ] With the probe slowed down artificially (a delayed read in the test's fakes) the old test fails
      every time and the new one passes.
- [ ] 30 consecutive runs of the file pass.

## Test / verification plan
- `for i in $(seq 30); do npx vitest run packages/server/src/daemon/update-e2e.test.ts || break; done`
