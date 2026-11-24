# Task 004 — The binaries workflow passes on all four systems in a pull request

- **Sprint:** sprints/sprint-141-binary-release
- **Status:** done
- **Type:** test
- **Area:** CI
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
A pull request run of `daemon-binaries.yml` builds and smoke-tests the four binaries, the macOS ones
included, and publishes nothing.

## Context / why
D16: on macOS the proof is that the binary starts; this run is where it is first seen. Also answers
whether the Intel runner exists and the archives' sizes.

## Scope references
- `swe/features/single-binary-daemon.md` § Acceptance criteria (release rows), § TODO(verify)

## What to build
Push the branch and open a draft pull request (the owner merges, never this task). Read the run;
fix failures with commits. Record per target: build time, archive size, smoke result.

## Out of scope
Publishing (first seen after the owner's merge, sprint-142/task-006).

## Acceptance criteria
- [ ] All four smoke tests pass in one run; no release or tag was created.
- [ ] A binary made to fail its smoke test in a throwaway commit fails its job and the publish job is
      skipped (then the commit is reverted).

## Test / verification plan
- `gh run view` of the runs; results in the summary.

## Notes
The draft pull request stays open for the rest of the milestone's first part (sprints 139–142).
