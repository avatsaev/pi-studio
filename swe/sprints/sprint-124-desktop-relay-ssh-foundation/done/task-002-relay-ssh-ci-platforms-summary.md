# Task 002 — The new dependencies build on the macOS and Windows runners — Summary

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Desktop CI runs on Linux only; the macOS (universal) and Windows builds are in `desktop-release.yml`, which a manual run (`workflow_dispatch`) builds without publishing. Run 45069793094 on `feat/desktop-relay-ssh` at `a432dd1` (the commit holding the `russh` + `ring`, `crypto_box` and `ssh2-config` dependencies and the two crates): Version, Bundle (windows-x64), Bundle (macos-universal) and Bundle (linux-x64) all succeeded; Release was skipped, so nothing was published.
- Draft pull request #64 is open (https://github.com/avatsaev/pi-studio/pull/64); Desktop CI (Linux gate) passed on `a432dd1`.

## Files changed
none (CI evidence only)

## Build & test results
```
gh workflow run desktop-release.yml --ref feat/desktop-relay-ssh -> run 45069793094: success (all three bundle jobs)
gh run list: Desktop CI a432dd1 success
```

## Acceptance criteria
- [x] The Linux, macOS and Windows builds pass with the dependencies of t001.

## Follow-ups
- The planned check was wrong: Desktop CI has no macOS/Windows job. The manual release run is the check; repeat it before the milestone ends (sprint 130).
