# Task 007 — Linux live checks of the engine in the real webview, and the documents

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** done
- **Type:** test
- **Area:** desktop, docs
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-005, task-006, sprint-118/task-002, sprint-119/task-003

## Goal
Every behaviour criterion of the spec is seen once in the real webview against a production daemon.

## Context / why
The parts were tested against a stand-in. This is the first run with the real daemon, the real dialogs and the workbench's lines.

## Scope references
- `swe/features/desktop-transfer-engine.md` § Acceptance criteria (Behaviour), § TODO(verify)
- `desktop/docs/development.md` (§ The transport proxy in the real webview: the `pi-desktop-xvfb` image, the control socket, `xdotool` for the save dialog), `swe/av-swe.config.json` (`liveChecks`)

## What to build
- In `pi-desktop-xvfb`, with `--secret-store file`, a scratch configuration directory and an isolated production daemon with a password: each row of the spec's Behaviour criteria, with what was observed (the daemon's `daemon_status`, `ui.inspect`'s `transfers`, the files on both sides, the lines in the explorer).
- The native open dialog driven with `xdotool`; if it cannot be driven, say how the upload was started instead.
- A command left pending while the daemon is stopped for ten minutes (the longest this run can wait): its answer still arrives.
- `desktop/docs/development.md` gains the recipe; `desktop/AGENTS.md` (where it stands, the workspace map), `desktop/docs/architecture.md` (the command table, the decisions table) and `desktop/README.md` describe what is built.
- Each spec TODO(verify) this run answers is answered there.

## Out of scope
- The 5 GiB check and its pass marks (sprint 123).
- macOS and Windows.

## Acceptance criteria
- [ ] Each Behaviour criterion is reported as seen, or as failed with a defect that is fixed (with a test) or filed in the summary.
- [ ] No run touched `~/.pi-studio`, port 6767 or a real keychain.
- [ ] `cargo xtask ci` and the root gates pass.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- `npm run build && npm run typecheck && npm run lint && npm test` at the root

## Notes
- The orchestrator runs this, not a subagent: it needs ports and the shared container.
