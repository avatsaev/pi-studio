# Task 003 — Linux live checks of the update in the real webview (test builds)

- **Sprint:** sprints/sprint-133-desktop-update-ui
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs/platform-checks.md, desktop/docs/development.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, sprint-132/task-004, sprint-131/task-003

## Goal
In the `pi-desktop-xvfb` container, two test builds A and B (overlay of sprint-131/task-001, a
throwaway key, a local HTTP server with B's files and a manifest made by `update-manifest.mjs`) show
every Linux criterion of the spec.

## Context / why
Spec § Acceptance criteria (Live, Linux). Recipes: `desktop/docs/development.md` (the earlier live
sections). Build from a clean `git worktree` with its own `CARGO_TARGET_DIR`.

## Scope references
- `swe/features/desktop-self-update.md` § Acceptance criteria (Live, Linux)
- `desktop/docs/platform-checks.md` (new "Self-update" rows U-L1…), `desktop/docs/development.md`
  (new section "The app's self-update in the real webview")

## What to build (the runs)
- AppImage A → B: indicator, no download before the click, progress, "Restart to update", version B
  after the restart, `ui.inspect.update`.
- `.deb` A → B with a polkit agent answering (or a rule, recorded); dismissed → `failed(refused)` and
  the link; `pkexec` removed → `cannot_install(no_pkexec)`, no download.
- A file with a wrong signature → nothing changes, `failed(signature)`.
- No network → nothing shown, one code logged; the menu answers with the failure.
- A transfer running at restart → the close question; Cancel keeps both.
- Setting off → no request in a day (fake clock not available live: no request at launch, recorded).
- The browser client in a browser: no indicator, unchanged.
A bug found is fixed in the main tree with a regression test.

## Acceptance criteria
- [ ] Each run recorded with evidence (versions, states, PIDs, hashes) in `platform-checks.md`.

## Test / verification plan
- The recipe written into `development.md`; clean up containers, servers, worktree.
