# Task 001 — Make the `update-e2e` "apply handoff" test deterministic — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
The test's fake `detectInstallKind` can be held behind a `probeGate`; the apply test connects while the start-up probe is pending, releases it, waits for the status reply (the probe's own broadcast arrives before it), and asserts the kinds from that point on. Nothing is deduplicated, so a real double broadcast still fails. The unused `broadcastKinds` helper was removed.

## Files changed
`packages/server/src/daemon/update-e2e.test.ts` only (no source change).

## Build & test results
```
30 consecutive runs of the file: all passed (7 tests each); oxfmt/oxlint clean
Wave gate (full tree): npm test 331 files, 4750 tests passed
```

## Acceptance criteria
- [x] 30 consecutive runs pass
- [ ] The old assertion was not re-run against the slowed probe to confirm it fails every time (the gate makes the race deterministic in the new test)
