# Task 002 — Automated platform checks on macOS and Windows runners for milestone 2

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/apps/pistudiodesktop/scripts, .github/workflows
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The existing platform-checks workflow also shows, on a macOS and a Windows runner, that the page connects through Rust and that the keychain backend works.

## Context / why
Only Linux was checked by hand. The runners caught real platform bugs in milestone 1, and the control socket now reports connections, so a machine can check this too.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 7, § Acceptance criteria (Bridge, Secrets), § TODO(verify) (the keychain on macOS, the control socket on Windows)
- `desktop/apps/pistudiodesktop/scripts/platform-checks.mjs`, `scripts/platform-checks/macos.mjs`, `windows.mjs`, `control-client.mjs`
- .github/workflows/desktop-platform-checks.yml
- `packages/protocol/fixtures/external-clients/` (the `hello` and `status` frames)

## What to build
- macOS (control socket): after the local daemon starts, `connection.transports` shows one open transport with frames in. That also shows a window and a page exist, which the control socket alone did not.
- macOS: with `--secret-store keychain`, add and remove a direct entry with a password and look for the item with `security find-generic-password`; record whether a runner can do this unattended, and skip with the reason if it prompts.
- Windows: a small stand-in server that answers `hello` with the fixture's `status` frame, since no daemon runs on Windows; the page connects to it as a direct entry, the control socket shows the transport, and the connection bar shows connected. The Credential Manager item is checked with `cmdkey /list`.
- Both: stop the app's processes for 15 s and continue; `resumeSignals.wake` rises.
- The checklist marks these items as automated.

## Out of scope
- A real sleep (task-003).
- Signing.

## Acceptance criteria
- [ ] A run of the workflow is green on both runners with the new checks, and the job summaries print what was observed (the keychain result, the wake count).
- [ ] The script's unit tests pass; the workflow passes `actionlint`.
- [ ] A check that cannot run on a runner is skipped with its reason in the summary, never silently.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `gh workflow run desktop-platform-checks.yml --ref <branch>` (the workflow is on `main` now), then `gh run watch`.
- `cargo xtask ci` in `desktop/`

## Notes
- Pushing the branch needs the owner's word.
- Every check that touches the keychain removes what it wrote, also when it fails.
