# Task 004 — After the merge: the first two publishing runs

- **Sprint:** sprints/sprint-134-desktop-update-release
- **Status:** done
- **Type:** test
- **Area:** GitHub Actions, desktop/docs/platform-checks.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Prove on the real releases: the first publishing run's self check passes on the three systems and the
manifest names it; the next release updates the build before on the three systems before the manifest
moves.

## Context / why
Spec § Acceptance criteria (Release). Needs the owner's merge to `main`: it cannot run before, and
the orchestrator never merges. It stays in the backlog (not blocked) until the owner merges.

## What to do
- Release 1 (0.3.0): `.sig` files present for `.deb` and `.rpm`; `update-check` passes; time recorded;
  `desktop-updates/latest.json` names 0.3.0; it is not the repository's latest release.
- Tell the owner: both users install 0.3.0 by hand once (P15).
- Release 2 (the next merge): P = 0.3.0 → N on the three systems, then `promote`.
- Record both in `desktop/docs/platform-checks.md`; tick the spec's Release criteria.

## Acceptance criteria
- [ ] Both runs recorded with links; the spec's Release criteria ticked or the failure reported.
