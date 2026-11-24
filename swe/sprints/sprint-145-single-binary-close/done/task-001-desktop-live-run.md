# Task 001 — Live desktop run on Linux: first launch, takeover, SSH installs

- **Sprint:** sprints/sprint-145-single-binary-close
- **Status:** done
- **Type:** test
- **Area:** desktop, binary
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-143/task-005, sprint-144/task-003, sprint-142/task-003

## Goal
The acceptance criteria of both feature specs that need the app are seen in the real webview in
containers with nothing installed.

## Scope references
- `swe/features/single-binary-daemon.md` § Acceptance criteria
- `swe/features/desktop-ssh-daemon-install.md` § Acceptance criteria, § TODO(verify)
- `desktop/docs/platform-checks.md`, `desktop/docs/development.md` (the container and control-socket recipes)

## What to build
With a local server for the archives and `--daemon-pin`, record rows (new section in
`desktop/docs/platform-checks.md`):
- first launch with no Node/npm/`pi-studio`: download with progress, start, connect;
- no network; a corrupted archive; Retry;
- an npm daemon with agents running: used; Restart → the binary, agents and history there;
- a binary newer than the pin is kept;
- the command-line tool: installed, `not_on_path`, `shadowed`, `occupied`;
- SSH: a host with nothing; a host without internet; an Alpine host; a host without `uname`; a send
  cut mid-way then Retry; a `noexec` home; a host running an npm daemon then stopped; a `ForceCommand`
  host; the install's commands absent from the log;
- the Settings → Daemon skipped-version line in the browser (dev daemon script).
Screenshots of the Daemons screen states.

## Acceptance criteria
- [x] Every row recorded with outcome; defects fixed with tests.

## Test / verification plan
- As above; results linked in the summary.

## Notes
macOS: not run (D16).
