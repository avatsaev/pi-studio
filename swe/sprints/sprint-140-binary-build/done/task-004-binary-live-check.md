# Task 004 — Live check of the binary on Linux with a real Pi

- **Sprint:** sprints/sprint-140-binary-build
- **Status:** done
- **Type:** test
- **Area:** binary, Pi
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal
In a Linux container with no Node or npm, the binary daemon runs a real Pi turn, installs an extension
and leaves the user's Pi settings unchanged; the open questions on the binary are answered.

## Context / why
Acceptance of `features/single-binary-daemon.md` (the Pi rows) and its TODO(verify).

## Scope references
- `swe/features/single-binary-daemon.md` § Acceptance criteria, § TODO(verify)
- `swe/architecture/single-binary-daemon.md` § Open points

## What to build
Nothing in the source unless a defect is found (fix with a test). Run and record:
- A real agent turn with a model credential (API key in a throwaway Pi home): a shell tool call and
  the todo tool.
- `pi install npm:<extension>` through Settings → Skills or the daemon's sync with no npm; Pi's
  `settings.json` gains only the installed entry (compare before and after).
- The baseline sync does not install `pi-background-tasks`; with it installed beforehand an agent
  starts.
- Another extension made to fail (a package with a broken entry): what Pi does, whether the agent's
  error names it (P16).
- `skills` list, add and remove; an OAuth login started to its first prompt.
- The oldest glibc the linux-x64 binary runs on (try an older distribution image).

## Out of scope
macOS (the release smoke test, sprint-141).

## Acceptance criteria
- [ ] Each item above is recorded with commands and outcomes in `packages/server/docs/binary-live-results.md`.
- [ ] Any defect found is fixed with a test, or reported to the owner when it cannot be.

## Test / verification plan
- As above; the summary links the results file.

## Notes
Never put a credential in a log, the results file or a commit.
