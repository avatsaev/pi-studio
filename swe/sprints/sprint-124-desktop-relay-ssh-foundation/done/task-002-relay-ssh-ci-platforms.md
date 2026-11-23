# Task 002 — The new dependencies build on the macOS and Windows runners

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Status:** done
- **Type:** test
- **Area:** .github/workflows/desktop-ci.yml (read only), the branch
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Desktop CI passes on macOS (universal) and Windows with the dependencies of t001, before anything is built on them.

## Context / why
Desktop CI runs on pull requests only. If `russh` with `ring` does not build there, the SSH half stops and the owner is asked (spec § TODO(verify)).

## Scope references
- `swe/features/desktop-relay-ssh.md` § TODO(verify) (first item), § Acceptance criteria (Build)
- `.github/workflows/desktop-ci.yml`

## What to build
- Push `feat/desktop-relay-ssh` and open a draft pull request (the owner allowed it at planning), so Desktop CI runs.
- Record the run's id and result in the summary.

## Out of scope
- Merging anything.

## Acceptance criteria
- [ ] Desktop CI's Linux, macOS and Windows jobs pass on the pull request.

## Test / verification plan
- `gh pr checks` on the draft pull request

## Notes
- A failure on macOS or Windows from `russh` stops sprint 127 onward; the relay sprints go on.
