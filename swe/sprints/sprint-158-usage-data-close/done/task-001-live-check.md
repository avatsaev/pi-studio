# Task 001 — Live check of usage data against a local endpoint

- **Sprint:** sprints/sprint-158-usage-data-close
- **Status:** done
- **Type:** test
- **Area:** desktop (Linux container), workbench
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-157/task-004, sprint-157/task-005

## Goal
Prove the live acceptance criteria of the spec on a real window: a **test build** (U2) compiled with a
throwaway token and `PISTUDIODESKTOP_USAGE_ENDPOINT` pointing at a local recording server.

## Context / why
Spec § Acceptance criteria, "Live". Unit tests cannot show the exit path, the window's Privacy panel
or the second-launch behaviour.

## Scope references
- `swe/features/desktop-usage-data.md` § Acceptance criteria (Live), U2, U3
- `desktop/docs/development.md` (the `pi-desktop-xvfb` recipes, `--control`, `--config-dir`,
  `--secret-store file`)

## What to build
A throwaway recording server (prints each request's headers and body; can be told to refuse or stall)
and the runs below. Nothing committed but the summary.

## Acceptance criteria
- [x] Fresh `--config-dir`: one `app_started`; body matches § 2; a second start from the same folder: same ID.
- [x] Quit: one `app_closed` with `duration_s`; with the server stalling, the quit takes ≤ 2 s longer.
- [x] Switch off in Settings → Privacy (screenshot): no request at quit or after a forced tick; on again: same ID.
- [x] `DO_NOT_TRACK=1`: no request, no `usageId` in `settings.json`, `ui.inspect.usage.blocked =
  "do_not_track"`, the panel says so (screenshot).
- [x] A second launch while running: no request.
- [x] Server refusing (401, 500, connection refused): nothing in the window; the log at
  `PISTUDIODESKTOP_LOG=debug` has the code and none of the URL, ID or token.
- [x] A normal (non-test) build from source: `blocked = "build"`, no request.
- [x] The web client in a browser shows no Privacy category and otherwise looks unchanged.
- [x] What `RunEvent::Exit` does on "Restart to update" (spec TODO(verify)), if reachable in the container.

## Test / verification plan
Commands and outputs recorded in the task's summary file.
