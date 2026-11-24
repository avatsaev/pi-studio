# Task 004 — The binaries workflow on a pull request — Summary

- **Sprint:** sprint-141-binary-release
- **Completed:** 2026-11-24
- **Status:** done

## What was run
Draft PR #68 (`feat/single-binary-daemon`): the `Daemon binaries` workflow ran on three pushes. It found two defects that no local run could:
1. **darwin-x64** (`macos-15-intel`): `codesign -s -` failed "is already signed" (Bun's compile signs the Intel binary). Fixed in `scripts/build-binary.mjs` (`codesign --force -s -`, found in run 1, fixed in 142/005).
2. **linux-x64**: every smoke step passed, then removing the temp home failed `ENOTEMPTY` (the daemon's boot-time extension sync left a `bun install` writing its cache). `scripts/binary-smoke.mjs` now retries the removal and warns instead of failing.

## Result (run 45407708431, commit 334a58d)
All four targets green: `linux-x64` 87 s, `linux-arm64` 82 s, `darwin-arm64` 111 s, `darwin-x64` 157 s (build, binary build, smoke test, archive upload each); the `publish` job was skipped (no `publish` input on a pull request) and nothing was published. Runner labels in use: `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel` (the Intel label exists and picks up a runner). The smoke test passed on a real macOS arm64 and Intel runner, which is the D16 bar for macOS.

## Acceptance
- [x] A pull request that changes `packages/` builds and smoke-tests the four targets and publishes nothing.

## Follow-ups
The publish path (release creation, `daemon-updates`, `latest.json`) first runs after the owner's merge (142/006). The PR's Desktop CI / Desktop release runs were still in progress when this was written.
