# Task 002 — macOS and Windows: run the registry section of the platform checklist

- **Sprint:** sprint-111-desktop-daemon-registry-close
- **Status:** blocked
- **Type:** test
- **Area:** desktop (installers on real machines)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The registry section of the platform checklist has a filled-in result for macOS and for Windows.

## Context / why
The local daemon is where the three platforms differ most: how an app started from the dock gets its environment (macOS), and no local daemon at all (Windows). None of it has run on either. **This task needs a person with those machines.** An implementer working only on Linux moves it to `blocked/` with that reason.

## Scope references
- `desktop/docs/platform-checks.md` (the registry section: task-001; the native-host section: sprint-106/task-001)
- `.github/workflows/desktop-release.yml` (a manual run builds installers as workflow artifacts, no release)
- `swe/features/desktop-daemon-registry.md` § Acceptance criteria (the Windows criterion; the version-manager criterion), § TODO(verify) (shell environment, WSL2, macOS and Windows)

## What to build
1. The engineer starts a manual run of the Desktop release workflow on the branch and downloads the macOS and Windows artifacts. (Starting a workflow is the engineer's decision.)
2. If sprint-106/task-002 has not been run yet, run both sections in one sitting.
3. Install each, run every item of the registry section, fill in the results table with the date and OS version.
4. On macOS note which shell was the login shell and how the CLI was installed (npm global, nvm, fnm, volta, Homebrew): the result is only meaningful with that.
5. For each failed item: what happened and what was expected, in the summary. A small, certain fix may be made with its test; anything larger is reported for planning.

## Out of scope
- Signing and notarisation (milestone 5). A local daemon on Windows.

## Acceptance criteria
- [ ] The results table has a dated row for macOS and one for Windows for the registry section.
- [ ] On macOS, "launched from the dock, CLI from a version manager" has a result naming the shell and the manager.
- [ ] On Windows, `daemon.local.start` over the control socket answers `unsupported`, and the local entry shows the explanation.
- [ ] Every failed item is recorded with what was seen.
- [ ] If code changed: `cargo xtask ci` passes and the Desktop CI run for the commit is green.

## Test / verification plan
- The checklist, on the two machines.
- `cargo xtask ci` in `desktop/` after any code change.

## Notes
- Not a dependency of task-003: the spec closes for Linux with the macOS and Windows criteria left open and pointing here.
- The installers are unsigned: macOS needs the app allowed in System Settings, Windows shows a SmartScreen warning.

## Blocker
Needs a person with a Mac and a Windows machine (see sprint-106/task-002); the registry section of `desktop/docs/platform-checks.md` (R1–R8) is ready. Run both sections in one sitting. Unblock when the table has dated rows for macOS (naming the login shell and the version manager) and Windows.
